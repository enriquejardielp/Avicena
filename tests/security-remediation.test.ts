import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import * as XLSX from "xlsx";
import { runBackupVerificationDrill } from "../scripts/backup-verify.ts";
import { createExpressApp } from "../server.ts";
import {
  signAuditEntry,
  signElectronicAttestation,
  verifyAuditChain,
  verifyElectronicAttestation,
} from "../server/auditChain.ts";
import { validateEnvironmentConfig } from "../server/envConfig.ts";
import type { VerifiedFirebaseUser } from "../server/firebaseAuth.ts";
import { runGeminiCopilot } from "../server/geminiCopilot.ts";
import { extractFormFieldsFromText, PiiBlockedError } from "../server/geminiFormExtractor.ts";
import {
  isLikelyIdentifierVariable,
  redactPii,
  scanDatasetMetadataForPii,
  scanForPii,
  scanFormMetadataForPii,
} from "../server/piiGuard.ts";
import {
  assertNonIdentifiableResearchId,
  computeParticipantBlindIndex,
  sealIdentityPayload,
  unsealIdentityPayload,
} from "../server/pseudonymizer.ts";
import { runStatTest } from "../server/statsEngine.ts";
import {
  DEFAULT_STUDY_GOVERNANCE,
  roleAllowsPermission,
  StudyAccessError,
  type StudyPermission,
} from "../server/studyAccess.ts";
import type { Dataset, FormField, Role } from "../src/lib/types.ts";

// Synthetic test identities & tokens (never real patient or user data)
const ROLE_TOKENS: Record<
  string,
  { role: Role; verified: boolean; revoked?: boolean; disabled?: boolean; mfa?: string | null; staleAuth?: boolean }
> = {
  "tok-admin": { role: "admin", verified: true, mfa: "totp" },
  "tok-coordinador": { role: "coordinador", verified: true, mfa: "totp" },
  "tok-investigador": { role: "investigador", verified: true, mfa: "totp" },
  "tok-investigador-nomfa": { role: "investigador", verified: true, mfa: null },
  "tok-monitor": { role: "monitor_clinico", verified: true, mfa: "totp" },
  "tok-monitor-stale": { role: "monitor_clinico", verified: true, mfa: "totp", staleAuth: true },
  "tok-estadistico": { role: "estadistico", verified: true, mfa: "totp" },
  "tok-admin-tecnico": { role: "admin_tecnico", verified: true, mfa: "totp" },
  "tok-capturador": { role: "capturador", verified: true, mfa: "totp" },
  "tok-unverified": { role: "investigador", verified: false, mfa: null },
  "tok-revoked": { role: "investigador", verified: true, revoked: true, mfa: null },
  "tok-disabled": { role: "investigador", verified: true, disabled: true, mfa: null },
};

const SYNTH_DATASET: Dataset = {
  id: "ds_synth_01",
  project_id: "proj_synth_01",
  name: "Cohorte Sintética",
  source: "upload",
  form_id: null,
  variables: [
    { name: "nombre", label: "Nombre del paciente", type: "text", levels: [] },
    { name: "dni", label: "DNI", type: "text", levels: [] },
    { name: "contacto_libre", label: "Observación libre", type: "text", levels: [] },
    { name: "grupo", label: "Grupo", type: "categorical", levels: ["Control", "Tratamiento"] },
    { name: "pas", label: "PAS", type: "numeric", levels: [] },
  ],
  n_rows: 6,
  chunk_count: 1,
  created_at: "2026-01-01T00:00:00.000Z",
};

const SYNTH_ROWS = [
  { nombre: "Sujeto Uno", dni: "12345678Z", contacto_libre: "12345678Z", grupo: "Control", pas: 142 },
  { nombre: "Sujeto Dos", dni: "00000000T", contacto_libre: "00000000T", grupo: "Control", pas: 146 },
  { nombre: "Sujeto Tres", dni: "11111111H", contacto_libre: "11111111H", grupo: "Control", pas: 140 },
  { nombre: "Sujeto Cuatro", dni: "22222222J", contacto_libre: "22222222J", grupo: "Tratamiento", pas: 122 },
  { nombre: "Sujeto Cinco", dni: "33333333P", contacto_libre: "33333333P", grupo: "Tratamiento", pas: 125 },
  { nombre: "Sujeto Seis", dni: "44444444A", contacto_libre: "44444444A", grupo: "Tratamiento", pas: 120 },
];

const SYNTH_FIELDS: FormField[] = [
  {
    name: "edad",
    label: "Edad",
    type: "number",
    required: true,
    choices: [],
    min: 18,
    max: 110,
    unit: "años",
    help: "",
  },
  {
    name: "hta",
    label: "Hipertensión arterial",
    type: "yesno",
    required: false,
    choices: [],
    min: null,
    max: null,
    unit: "",
    help: "",
  },
];

let server: http.Server;
let baseUrl = "";

async function requestJson(
  method: string,
  urlPath: string,
  options?: { token?: string; body?: unknown; headers?: Record<string, string> }
): Promise<{ status: number; headers: Headers; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options?.headers ?? {}),
    },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, headers: res.headers, json };
}

describe("Avicena — Suite integral de seguridad, privacidad, RBAC y bioestadística (2ª Auditoría)", () => {
  before(async () => {
    process.env.APP_ENV = "testing";
    process.env.AUDIT_HMAC_SECRET = "aud-k2-secret-0123456789abcdef0123456789abcdef";
    process.env.AUDIT_HMAC_KEY_ID = "aud-k2";
    process.env.AUDIT_HMAC_PREVIOUS_SECRETS = "aud-k1:aud-k1-legacy-secret-0123456789abcdef0123";
    process.env.VAULT_ENCRYPTION_SECRET = "vault-k2-secret-abcdef0123456789abcdef0123456789";
    process.env.VAULT_ENCRYPTION_KEY_ID = "vault-k2";
    process.env.VAULT_PREVIOUS_SECRETS = "vault-k1:vault-k1-legacy-secret-abcdef0123456789";

    const app = createExpressApp({
      verifyToken: async (token: string): Promise<VerifiedFirebaseUser> => {
        const spec = ROLE_TOKENS[token];
        if (!spec) throw new Error("TOKEN_INVALID");
        if (spec.disabled) throw new Error("USER_DISABLED");
        if (spec.revoked) throw new Error("TOKEN_REVOKED");
        if (!spec.verified) throw new Error("EMAIL_NOT_VERIFIED");
        return {
          uid: `uid_${spec.role}`,
          email: `${spec.role}@synth.avicena.local`,
          name: `Synth ${spec.role}`,
          email_verified: true,
          picture: null,
          auth_time: spec.staleAuth
            ? Math.floor(Date.now() / 1000) - 900
            : Math.floor(Date.now() / 1000),
          mfa_second_factor: spec.mfa ?? null,
        };
      },
      verifyStudy: async ({ user, projectId, permission, datasetId }) => {
        const isMfaStudy = projectId === "proj_mfa_01";
        if (projectId !== "proj_synth_01" && !isMfaStudy) {
          throw new StudyAccessError(403, "NOT_STUDY_MEMBER", "No eres miembro activo de este estudio.");
        }
        const role = user.uid.replace("uid_", "") as Role;
        if (!roleAllowsPermission(role, permission)) {
          throw new StudyAccessError(403, "ROLE_FORBIDDEN", `Rol ${role} sin permiso ${permission}`);
        }
        if (isMfaStudy && !user.mfa_second_factor) {
          throw new StudyAccessError(
            403,
            "MFA_REQUIRED_BY_STUDY",
            "Este estudio exige autenticación multifactor (MFA) activa para acceder a esta función."
          );
        }
        if (datasetId && datasetId !== SYNTH_DATASET.id) {
          throw new StudyAccessError(403, "DATASET_NOT_IN_STUDY", "Dataset ajeno al estudio.");
        }
        return {
          projectId,
          role,
          isOwner: role === "admin",
          governance: {
            ...DEFAULT_STUDY_GOVERNANCE,
            aiEnabled: true,
            aiAllowClinicalText: true,
            aiAllowDatasetContext: true,
            aiDpaConfirmed: true,
            requireMfa: isMfaStudy,
          },
        };
      },
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("1. Bloquea peticiones sin sesión, correo no verificado, token revocado y cuenta deshabilitada", async () => {
    const unauth = await requestJson("GET", "/api/me");
    assert.equal(unauth.status, 401);
    assert.equal(unauth.json.code, "AUTH_REQUIRED");

    const unverified = await requestJson("GET", "/api/me", { token: "tok-unverified" });
    assert.equal(unverified.status, 403);
    assert.equal(unverified.json.code, "EMAIL_NOT_VERIFIED");

    const revoked = await requestJson("GET", "/api/me", { token: "tok-revoked" });
    assert.equal(revoked.status, 401);
    assert.equal(revoked.json.code, "TOKEN_REVOKED");

    const disabled = await requestJson("GET", "/api/me", { token: "tok-disabled" });
    assert.equal(disabled.status, 401);
    assert.equal(disabled.json.code, "USER_DISABLED");
  });

  it("2. Exigencia efectiva de MFA cuando el estudio activa requireMfa (bloquea 1FA y permite 2FA TOTP)", async () => {
    const meNoMfa = await requestJson("GET", "/api/me", { token: "tok-investigador-nomfa" });
    assert.equal(meNoMfa.status, 200);
    assert.equal(meNoMfa.json.mfa_active, false);

    const deniedNoMfa = await requestJson("POST", "/api/analyze", {
      token: "tok-investigador-nomfa",
      body: {
        projectId: "proj_mfa_01",
        dataset: { ...SYNTH_DATASET, project_id: "proj_mfa_01" },
        rows: SYNTH_ROWS,
        test: "ttest",
        params: { outcome: "pas", group: "grupo" },
      },
    });
    assert.equal(deniedNoMfa.status, 403);
    assert.equal(deniedNoMfa.json.code, "MFA_REQUIRED_BY_STUDY");

    const allowedWithMfa = await requestJson("POST", "/api/analyze", {
      token: "tok-investigador",
      body: {
        projectId: "proj_mfa_01",
        dataset: { ...SYNTH_DATASET, project_id: "proj_mfa_01" },
        rows: SYNTH_ROWS,
        test: "ttest",
        params: { outcome: "pas", group: "grupo" },
      },
    });
    assert.equal(allowedWithMfa.status, 200);
  });

  it("3. Matriz RBAC de 7 roles, aislamiento de admin_tecnico y protección IDOR entre estudios", async () => {
    assert.equal(roleAllowsPermission("admin_tecnico", "audit.read"), true);
    assert.equal(roleAllowsPermission("admin_tecnico", "audit.write"), true);
    assert.equal(roleAllowsPermission("admin_tecnico", "analytics.run"), false);
    assert.equal(roleAllowsPermission("admin_tecnico", "vault.register"), false);
    assert.equal(roleAllowsPermission("admin_tecnico", "vault.reidentify"), false);
    assert.equal(roleAllowsPermission("admin_tecnico", "dataset.upload"), false);
    assert.equal(roleAllowsPermission("admin_tecnico", "dataset.export"), false);
    assert.equal(roleAllowsPermission("admin_tecnico", "ai.extract"), false);
    assert.equal(roleAllowsPermission("admin_tecnico", "ai.chat"), false);

    const techAnalyze = await requestJson("POST", "/api/analyze", {
      token: "tok-admin-tecnico",
      body: {
        projectId: "proj_synth_01",
        dataset: SYNTH_DATASET,
        rows: SYNTH_ROWS,
        test: "ttest",
        params: { outcome: "pas", group: "grupo" },
      },
    });
    assert.equal(techAnalyze.status, 403);
    assert.equal(techAnalyze.json.code, "ROLE_FORBIDDEN");

    const techAuditSign = await requestJson("POST", "/api/audit/sign", {
      token: "tok-admin-tecnico",
      body: {
        projectId: "proj_synth_01",
        action: "MEMBER_ROLE_CHANGED",
        resourceType: "member",
        resourceId: "uid_test",
        outcome: "SUCCESS",
      },
    });
    assert.equal(techAuditSign.status, 200);

    const capAnalyze = await requestJson("POST", "/api/analyze", {
      token: "tok-capturador",
      body: {
        projectId: "proj_synth_01",
        dataset: SYNTH_DATASET,
        rows: SYNTH_ROWS,
        test: "ttest",
        params: { outcome: "pas", group: "grupo" },
      },
    });
    assert.equal(capAnalyze.status, 403);

    const sealedRes = await requestJson("POST", "/api/pseudonymize/seal", {
      token: "tok-capturador",
      body: {
        projectId: "proj_synth_01",
        fullName: "Participante Sintetico",
        nationalId: "12345678Z",
        nhc: "NHC9001",
      },
    });
    assert.equal(sealedRes.status, 200);

    for (const tok of ["tok-estadistico", "tok-monitor", "tok-capturador", "tok-admin-tecnico"]) {
      const deniedUnseal = await requestJson("POST", "/api/pseudonymize/unseal", {
        token: tok,
        body: {
          projectId: "proj_synth_01",
          subjectPseudoId: sealedRes.json.subjectPseudoId,
          reason: "Intento no autorizado de reidentificación en prueba",
          sealedPayload: sealedRes.json.sealedPayload,
        },
      });
      assert.equal(deniedUnseal.status, 403, `Esperado 403 para ${tok}`);
    }

    const idorAnalyze = await requestJson("POST", "/api/analyze", {
      token: "tok-admin",
      body: {
        projectId: "proj_synth_01",
        dataset: { ...SYNTH_DATASET, project_id: "proj_otro_estudio" },
        rows: SYNTH_ROWS,
        test: "ttest",
        params: { outcome: "pas", group: "grupo" },
      },
    });
    assert.equal(idorAnalyze.status, 403);
    assert.equal(idorAnalyze.json.code, "PROJECT_MISMATCH");
  });

  it("4. Detector conservador de PII (nombres sin etiqueta, fechas con punto, tel 2 dígitos, HC/SIP, calles) sin falsos positivos clínicos", () => {
    const syntheticPii =
      "Acude Juan Pérez García, HC 998877, F.N. 12.03.1975, tel 91 555 44 33, correo synth@example.org, domicilio C/ Mayor 14, DNI 12345678Z.";
    const scan = scanForPii(syntheticPii);
    assert.equal(scan.hasPii, true);
    assert.ok(scan.categories.includes("dni_nie"));
    assert.ok(scan.categories.includes("nhc_historia"));
    assert.ok(scan.categories.includes("email"));
    assert.ok(scan.categories.includes("telefono"));
    assert.ok(scan.categories.includes("fecha_nacimiento"));
    assert.ok(scan.categories.includes("direccion_postal"));
    assert.ok(scan.categories.includes("nombre_propio"));

    // Nombre sin etiqueta de 3 palabras en español
    assert.equal(scanForPii("Ingreso programado de María López Serrano por disnea.").hasPii, true);
    // Teléfono fijo 2 dígitos
    assert.equal(scanForPii("Llamar al 93 412 88 90 para cita.").categories.includes("telefono"), true);
    // Fecha nacimiento redactada con mes en texto
    assert.equal(scanForPii("Nacido el 14 de marzo de 1968.").categories.includes("fecha_nacimiento"), true);

    const redacted = redactPii(syntheticPii);
    assert.equal(redacted.redactedText.includes("12345678Z"), false);
    assert.equal(redacted.redactedText.includes("Juan Pérez García"), false);
    assert.equal(redacted.redactedText.includes("synth@example.org"), false);

    // Control negativo: texto clínico desidentificado válido no debe generar falso positivo
    const cleanClinical =
      "Varón de 64 años con Hipertensión Arterial y Diabetes Mellitus tipo 2. Ingreso en Cardiología con PAS 138 mmHg, creatinina 1.1 mg/dL y HbA1c 7.2%.";
    assert.equal(scanForPii(cleanClinical).hasPii, false);

    assert.equal(assertNonIdentifiableResearchId("12345678Z").valid, false);
    assert.equal(assertNonIdentifiableResearchId("98765432").valid, false);
    assert.equal(assertNonIdentifiableResearchId("SUBJ-A1B2C3D4").valid, true);
    assert.equal(isLikelyIdentifierVariable("nhc"), true);
    assert.equal(isLikelyIdentifierVariable("pas"), false);
  });

  it("5. Bloqueo previo a Gemini por PII en texto libre, metadatos de formulario y metadatos de dataset", async () => {
    const blockedAi = await requestJson("POST", "/api/forms/extract", {
      token: "tok-investigador",
      body: {
        projectId: "proj_synth_01",
        formName: "CRF Basal",
        fields: SYNTH_FIELDS,
        freeText: "Paciente Juan Pérez García de 65 años con diagnóstico de HTA.",
        currentValues: {},
        deidentifiedConfirmed: true,
      },
    });
    assert.equal(blockedAi.status, 422);
    assert.equal(blockedAi.json.code, "PII_DETECTED");

    // Bloqueo de metadatos de formulario con PII sin llamar a Gemini
    await assert.rejects(
      () =>
        extractFormFieldsFromText(
          "Seguimiento de Juan Pérez García (DNI 12345678Z)",
          SYNTH_FIELDS,
          "Varón de 60 años con HTA.",
          {},
          { deidentifiedConfirmed: true }
        ),
      PiiBlockedError
    );
    assert.equal(
      scanFormMetadataForPii("CRF Limpio", [
        { ...SYNTH_FIELDS[0], help: "Contacto urgencias synth@example.org" },
      ]).hasPii,
      true
    );

    // Bloqueo de metadatos de dataset en Copiloto antes de instanciar cliente Gemini
    const piiDataset: Dataset = {
      ...SYNTH_DATASET,
      name: "Cohorte Paciente Juan Pérez García 12345678Z",
    };
    assert.equal(scanDatasetMetadataForPii(piiDataset).hasPii, true);
    const errors: string[] = [];
    const copilotRes = await runGeminiCopilot(
      piiDataset,
      SYNTH_ROWS,
      [],
      "Calcula la media de PAS por grupo.",
      {
        onStatus: () => {},
        onAnalysis: () => {},
        onDelta: () => {},
        onError: (t) => errors.push(t),
      }
    );
    assert.equal(copilotRes.analysis, null);
    assert.match(copilotRes.content, /bloqueada por protección de datos/i);
    assert.equal(errors.length, 1);
  });

  it("6. Bóveda AES-256-GCM v2, claves separadas de auditoría y rotación con soporte histórico v1/k1", async () => {
    const idxA1 = computeParticipantBlindIndex("proj_synth_01", "12345678-Z");
    const idxA2 = computeParticipantBlindIndex("proj_synth_01", "12345678Z");
    const idxOther = computeParticipantBlindIndex("proj_otro_02", "12345678Z");
    assert.equal(idxA1, idxA2);
    assert.notEqual(idxA1, idxOther);

    // Sellado v2 con clave actual vault-k2
    const sealedV2 = sealIdentityPayload("proj_synth_01", {
      fullName: "Sujeto Prueba Boveda",
      nationalId: "12345678Z",
      nhc: "NHC-SYNTH-1",
    });
    assert.equal(sealedV2.version, "aes-256-gcm-v2");
    assert.equal(sealedV2.keyId, "vault-k2");
    assert.equal(unsealIdentityPayload("proj_synth_01", sealedV2).nationalId, "12345678Z");

    // AAD impide descifrar bajo otro estudio
    assert.throws(() => unsealIdentityPayload("proj_otro_02", sealedV2));

    // Unseal de payload sellado con clave previa vault-k1 tras rotación a vault-k2
    const sealedPrev = sealIdentityPayload(
      "proj_synth_01",
      { fullName: "Sujeto Rotado", nationalId: "11111111H", nhc: "NHC-K1" },
      "vault-k1-legacy-secret-abcdef0123456789",
      "vault-k1"
    );
    assert.equal(sealedPrev.keyId, "vault-k1");
    assert.equal(unsealIdentityPayload("proj_synth_01", sealedPrev).nationalId, "11111111H");

    // Compatibilidad de descifrado con versión legacy aes-256-gcm-v1
    const legacyKey = crypto
      .createHmac("sha256", "vault-k1-legacy-secret-abcdef0123456789")
      .update("identity-vault-key:v1:proj_synth_01")
      .digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", legacyKey, iv);
    cipher.setAAD(Buffer.from("proj_synth_01", "utf8"));
    const enc = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify({ fullName: "Legacy", nationalId: "22222222J", nhc: "L1" }))),
      cipher.final(),
    ]);
    const legacyPayload = {
      version: "aes-256-gcm-v1" as const,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: enc.toString("base64"),
    };
    assert.equal(unsealIdentityPayload("proj_synth_01", legacyPayload).nationalId, "22222222J");

    // API rechazando código igual a DNI y ejecutando unseal auditado
    const rejectSameId = await requestJson("POST", "/api/pseudonymize/seal", {
      token: "tok-coordinador",
      body: {
        projectId: "proj_synth_01",
        subjectPseudoId: "12345678Z",
        fullName: "Sujeto Prueba",
        nationalId: "12345678Z",
      },
    });
    assert.equal(rejectSameId.status, 422);
    assert.equal(rejectSameId.json.code, "IDENTIFIABLE_STUDY_ID");

    const okSeal = await requestJson("POST", "/api/pseudonymize/seal", {
      token: "tok-coordinador",
      body: {
        projectId: "proj_synth_01",
        fullName: "Sujeto Prueba Boveda",
        nationalId: "12345678Z",
        nhc: "NHC001",
      },
    });
    assert.equal(okSeal.status, 200);

    const okUnseal = await requestJson("POST", "/api/pseudonymize/unseal", {
      token: "tok-coordinador",
      body: {
        projectId: "proj_synth_01",
        subjectPseudoId: okSeal.json.subjectPseudoId,
        reason: "Verificación regulatoria ante evento adverso serio",
        sealedPayload: okSeal.json.sealedPayload,
      },
    });
    assert.equal(okUnseal.status, 200);
    const aud = okUnseal.json.auditEntry as { action: string; actorRole: string; entryHash: string; keyId?: string };
    assert.equal(aud.action, "REIDENTIFICATION_ACCESS");
    assert.equal(aud.actorRole, "coordinador");
    assert.equal(aud.keyId, "aud-k2");
    assert.equal(aud.entryHash.length, 64);
  });

  it("7. Cadena de auditoría HMAC con rotación multi-clave (aud-k1 -> aud-k2) detecta manipulaciones y borrados", async () => {
    const e0Legacy = signAuditEntry(
      {
        projectId: "proj_synth_01",
        actorUid: "uid_admin",
        actorName: "IP Prueba",
        actorRole: "admin",
        action: "RECORD_CREATE",
        resourceType: "crfRecord",
        resourceId: "rec_1",
        outcome: "SUCCESS",
        prevHash: "GENESIS",
      },
      "aud-k1-legacy-secret-0123456789abcdef0123",
      "aud-k1"
    );
    const e1Current = signAuditEntry({
      projectId: "proj_synth_01",
      actorUid: "uid_monitor_clinico",
      actorName: "Monitor Prueba",
      actorRole: "monitor_clinico",
      action: "RECORD_STATUS_CHANGE",
      resourceType: "crfRecord",
      resourceId: "rec_1",
      outcome: "SUCCESS",
      reason: "Verificado contra historia",
      prevHash: e0Legacy.entryHash,
    });

    const validRes = await requestJson("POST", "/api/audit/verify", {
      token: "tok-monitor",
      body: { projectId: "proj_synth_01", entries: [e0Legacy, e1Current] },
    });
    assert.equal(validRes.status, 200);
    assert.equal(validRes.json.valid, true);
    assert.equal(validRes.json.checkedCount, 2);

    const checkTamper = verifyAuditChain([e0Legacy, { ...e1Current, reason: "Motivo falsificado" }]);
    assert.equal(checkTamper.valid, false);
    assert.equal(checkTamper.brokenAtIndex, 1);

    const e2 = signAuditEntry({
      projectId: "proj_synth_01",
      actorUid: "uid_coordinador",
      actorName: "Coord",
      actorRole: "coordinador",
      action: "EXPORT_DATA",
      resourceType: "dataset",
      resourceId: "ds_1",
      outcome: "SUCCESS",
      reason: "Análisis intermedio",
      prevHash: e1Current.entryHash,
    });
    const checkDeleted = verifyAuditChain([e0Legacy, e2]);
    assert.equal(checkDeleted.valid, false);
    assert.equal(checkDeleted.brokenAtIndex, 1);

    const foreignRes = await requestJson("POST", "/api/audit/verify", {
      token: "tok-admin",
      body: {
        projectId: "proj_synth_01",
        entries: [e0Legacy, { ...e1Current, projectId: "proj_ajeno" }],
      },
    });
    assert.equal(foreignRes.status, 200);
    assert.equal(foreignRes.json.valid, false);
    assert.equal(foreignRes.json.brokenAtIndex, 1);
  });

  it("8. Exportación CSV: neutraliza formula injection (=,+,-,@), elimina columnas con PII por contenido y firma SHA-256", async () => {
    const noReason = await requestJson("POST", "/api/exports/dataset", {
      token: "tok-estadistico",
      body: {
        projectId: "proj_synth_01",
        dataset: SYNTH_DATASET,
        rows: SYNTH_ROWS,
        reason: "corto",
        includeIdentifiers: false,
      },
    });
    assert.equal(noReason.status, 422);

    const rowsWithFormula = SYNTH_ROWS.map((r, i) =>
      i === 0 ? { ...r, grupo: "=CMD|' /C calc'!A0" } : r
    );

    const cleanExport = await requestJson("POST", "/api/exports/dataset", {
      token: "tok-estadistico",
      body: {
        projectId: "proj_synth_01",
        dataset: SYNTH_DATASET,
        rows: rowsWithFormula,
        reason: "Análisis descriptivo del comité científico",
        includeIdentifiers: true,
      },
    });
    assert.equal(cleanExport.status, 200);
    const csv = String(cleanExport.json.csvContent ?? "");
    const expectedSha = crypto.createHash("sha256").update(csv, "utf8").digest("hex");
    assert.equal(cleanExport.json.sha256, expectedSha);
    assert.equal(cleanExport.headers.get("x-avicena-export-sha256"), expectedSha);
    // Eliminó nombre, dni Y contacto_libre (escaneada por contenido aunque tenga nombre genérico)
    assert.deepEqual(cleanExport.json.strippedColumns, ["nombre", "dni", "contacto_libre"]);
    assert.equal(csv.includes("12345678Z"), false);
    assert.equal(csv.includes("'=CMD"), true);
    assert.equal(csv.includes("pas"), true);

    const bulkRows = Array.from({ length: 501 }, (_, i) => ({
      nombre: `Sujeto ${i}`,
      dni: "00000000T",
      contacto_libre: "sin datos",
      grupo: i % 2 === 0 ? "Control" : "Tratamiento",
      pas: 120 + (i % 20),
    }));

    const deniedBulk = await requestJson("POST", "/api/exports/dataset", {
      token: "tok-estadistico",
      body: {
        projectId: "proj_synth_01",
        dataset: SYNTH_DATASET,
        rows: bulkRows,
        reason: "Intento de exportación masiva completa",
        includeIdentifiers: false,
      },
    });
    assert.equal(deniedBulk.status, 403);

    const allowedBulk = await requestJson("POST", "/api/exports/dataset", {
      token: "tok-coordinador",
      body: {
        projectId: "proj_synth_01",
        dataset: SYNTH_DATASET,
        rows: bulkRows,
        reason: "Exportación regulatoria completa aprobada por coordinación",
        includeIdentifiers: false,
      },
    });
    assert.equal(allowedBulk.status, 200);
    assert.equal(allowedBulk.json.rowCount, 501);
  });

  it("9. Configuración de producción exige secretos separados, CSP estricto y simulacro backup-verify v2", async () => {
    assert.throws(
      () => validateEnvironmentConfig({ APP_ENV: "production" }),
      /PRODUCTION_CONFIG_ERROR/
    );
    assert.throws(
      () =>
        validateEnvironmentConfig({
          APP_ENV: "production",
          ALLOWED_ORIGINS: "https://avicena.hospital-ejemplo.org",
          AUDIT_HMAC_SECRET: "0123456789abcdef0123456789abcdef",
        }),
      /VAULT_ENCRYPTION_SECRET/
    );
    assert.throws(
      () =>
        validateEnvironmentConfig({
          APP_ENV: "production",
          ALLOWED_ORIGINS: "https://avicena.hospital-ejemplo.org",
          AUDIT_HMAC_SECRET: "0123456789abcdef0123456789abcdef",
          VAULT_ENCRYPTION_SECRET: "0123456789abcdef0123456789abcdef",
        }),
      /distinto/
    );

    const prodCfg = validateEnvironmentConfig({
      APP_ENV: "production",
      ALLOWED_ORIGINS: "https://avicena.hospital-ejemplo.org",
      AUDIT_HMAC_SECRET: "audit-prod-secret-0123456789abcdef01234567",
      VAULT_ENCRYPTION_SECRET: "vault-prod-secret-fedcba9876543210fedcba98",
    });
    assert.equal(prodCfg.isProduction, true);
    assert.equal(prodCfg.hasExplicitAuditSecret, true);
    assert.equal(prodCfg.hasExplicitVaultSecret, true);

    // Verificar CSP de producción sin 'unsafe-inline' en script-src
    const prevEnv = { ...process.env };
    try {
      process.env.APP_ENV = "production";
      process.env.ALLOWED_ORIGINS = "https://avicena.hospital-ejemplo.org";
      process.env.AUDIT_HMAC_SECRET = "audit-prod-secret-0123456789abcdef01234567";
      process.env.VAULT_ENCRYPTION_SECRET = "vault-prod-secret-fedcba9876543210fedcba98";
      const prodApp = createExpressApp();
      const prodServer = await new Promise<http.Server>((resolve) => {
        const s = prodApp.listen(0, "127.0.0.1", () => resolve(s));
      });
      try {
        const addr = prodServer.address();
        const port = addr && typeof addr === "object" ? addr.port : 0;
        const r = await fetch(`http://127.0.0.1:${port}/api/health`);
        const csp = r.headers.get("content-security-policy") ?? "";
        const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
        assert.equal(scriptSrc.includes("unsafe-inline"), false);
      } finally {
        await new Promise<void>((res) => prodServer.close(() => res()));
      }
    } finally {
      process.env = prevEnv;
    }

    const backupDrill = runBackupVerificationDrill();
    assert.equal(backupDrill.ok, true);
    assert.equal(backupDrill.auditValid, true);
    assert.equal(backupDrill.separatedSecrets, true);
    assert.equal(backupDrill.restoredCount, 2);
  });

  it("10. Cabeceras de seguridad, CORS estricto, límite de payload y regresión completa de las 21 pruebas bioestadísticas", async () => {
    const meRes = await requestJson("GET", "/api/me", { token: "tok-investigador" });
    assert.equal(meRes.status, 200);
    assert.match(meRes.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(meRes.headers.get("x-content-type-options"), "nosniff");
    assert.equal(meRes.headers.get("x-powered-by"), null);

    const corsRes = await requestJson("GET", "/api/me", {
      token: "tok-investigador",
      headers: { Origin: "https://origen-no-autorizado.invalid" },
    });
    assert.equal(corsRes.status, 403);
    assert.equal(corsRes.json.code, "CORS_FORBIDDEN");

    // Límite de tamaño de payload (>2MB en /api/analyze -> 413)
    const hugePadding = "x".repeat(2_300_000);
    const largeRes = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer tok-investigador",
      },
      body: JSON.stringify({ pad: hugePadding }),
    });
    assert.equal(largeRes.status, 413);

    // Regresión exhaustiva de las 21 pruebas bioestadísticas en statsEngine
    const bioVars: Dataset["variables"] = [
      { name: "grupo", label: "Grupo", type: "categorical", levels: ["Control", "Activo"] },
      { name: "brazo3", label: "Brazo", type: "categorical", levels: ["A", "B", "C"] },
      { name: "pas_base", label: "PAS basal", type: "numeric", levels: [] },
      { name: "pas_6m", label: "PAS 6m", type: "numeric", levels: [] },
      { name: "pas_12m", label: "PAS 12m", type: "numeric", levels: [] },
      { name: "biomarcador", label: "Biomarcador", type: "numeric", levels: [] },
      { name: "evento", label: "Evento", type: "binary", levels: ["0", "1"] },
      { name: "exposicion", label: "Exposición", type: "binary", levels: ["0", "1"] },
      { name: "test_idx", label: "Test rápido", type: "binary", levels: ["0", "1"] },
      { name: "eval2", label: "Evaluador 2", type: "binary", levels: ["0", "1"] },
      { name: "tiempo", label: "Tiempo (meses)", type: "numeric", levels: [] },
      { name: "edad", label: "Edad", type: "numeric", levels: [] },
      { name: "conteo", label: "Visitas urgencias", type: "numeric", levels: [] },
    ];

    const bioRows = Array.from({ length: 30 }, (_, i) => {
      const grp = i < 15 ? "Control" : "Activo";
      const trt = i >= 15 ? 1 : 0;
      const base = 132 + (i % 7) * 3 + trt * 2;
      const m6 = base - (trt ? 14 : 3) + (i % 3);
      const m12 = m6 - (trt ? 6 : 1);
      const marker = trt ? 6.5 + (i % 5) * 0.7 : 3.2 + (i % 5) * 0.6;
      const ev = i % (trt ? 4 : 2) === 0 ? 1 : 0;
      return {
        grupo: grp,
        brazo3: i < 10 ? "A" : i < 20 ? "B" : "C",
        pas_base: base,
        pas_6m: m6,
        pas_12m: m12,
        biomarcador: marker,
        evento: ev,
        exposicion: trt,
        test_idx: ev === 1 ? (i % 5 === 0 ? 0 : 1) : i % 6 === 0 ? 1 : 0,
        eval2: ev === 1 ? (i % 7 === 0 ? 0 : 1) : i % 5 === 0 ? 1 : 0,
        tiempo: 6 + (i % 18) + trt * 5,
        edad: 48 + (i % 25),
        conteo: trt ? 1 + (i % 2) : 2 + (i % 4),
      };
    });

    const cases: Array<{ test: Parameters<typeof runStatTest>[0]; params: Record<string, unknown> }> = [
      { test: "descriptives", params: { vars: ["pas_base", "pas_6m", "edad"] } },
      { test: "frequencies", params: { var: "brazo3" } },
      { test: "table1", params: { group: "grupo", vars: ["edad", "pas_base", "evento"] } },
      { test: "ttest", params: { outcome: "pas_6m", group: "grupo" } },
      { test: "paired_ttest", params: { var1: "pas_base", var2: "pas_6m" } },
      { test: "mannwhitney", params: { outcome: "pas_6m", group: "grupo" } },
      { test: "anova", params: { outcome: "pas_6m", group: "brazo3" } },
      { test: "friedman", params: { vars: ["pas_base", "pas_6m", "pas_12m"] } },
      { test: "chi2", params: { row: "grupo", col: "evento" } },
      { test: "mcnemar", params: { var1: "evento", var2: "test_idx" } },
      { test: "epidemiology_2x2", params: { exposure: "exposicion", outcome: "evento" } },
      { test: "kappa_agreement", params: { var1: "test_idx", var2: "eval2" } },
      { test: "diagnostic_test", params: { test_var: "test_idx", gold_standard: "evento" } },
      { test: "roc_auc", params: { marker: "biomarcador", outcome: "evento" } },
      { test: "correlation", params: { vars: ["pas_base", "pas_6m", "edad"], method: "pearson" } },
      { test: "linreg", params: { outcome: "pas_6m", predictors: ["pas_base", "edad"] } },
      { test: "logreg", params: { outcome: "evento", predictors: ["biomarcador", "edad"] } },
      { test: "poisson_reg", params: { outcome: "conteo", predictors: ["exposicion", "edad"] } },
      { test: "kaplan_meier", params: { time: "tiempo", event: "evento", group: "grupo" } },
      { test: "cox_ph", params: { time: "tiempo", event: "evento", predictors: ["exposicion", "edad"] } },
      {
        test: "sample_size",
        params: { design: "two_proportions", alpha: 0.05, power: 0.8, p1: 0.35, p2: 0.15, ratio: 1 },
      },
    ];

    assert.equal(cases.length, 21);
    for (const c of cases) {
      const res = runStatTest(c.test, bioRows, bioVars, c.params);
      assert.equal(res.test, c.test);
      assert.ok(res.tables.length >= 1, `Esperadas tablas en ${c.test}`);
      assert.ok(res.summary.length > 5, `Esperado resumen en ${c.test}`);
    }
  });

  it("11. Aprobación electrónica reautenticada (/api/signatures/sign): exige auth_time reciente, RBAC estricto y rotación HMAC", async () => {
    assert.equal(roleAllowsPermission("monitor_clinico", "signature.sign"), true);
    assert.equal(roleAllowsPermission("coordinador", "signature.sign"), true);
    assert.equal(roleAllowsPermission("admin", "signature.sign"), true);
    assert.equal(roleAllowsPermission("estadistico", "signature.sign"), false);
    assert.equal(roleAllowsPermission("admin_tecnico", "signature.sign"), false);
    assert.equal(roleAllowsPermission("capturador", "signature.sign"), false);

    // Usuario sin permiso (estadístico o capturador) -> 403 ROLE_FORBIDDEN
    const statDenied = await requestJson("POST", "/api/signatures/sign", {
      token: "tok-estadistico",
      body: {
        projectId: "proj_synth_01",
        targetType: "crf_record",
        targetId: "rec_synth_01",
        targetVersion: 2,
        meaning: "Verificación SDV",
        reason: "Revisión de fuente completada",
      },
    });
    assert.equal(statDenied.status, 403);
    assert.equal(statDenied.json.code, "ROLE_FORBIDDEN");

    // Monitor con sesión antigua (>300s) -> 403 REAUTH_REQUIRED
    const staleDenied = await requestJson("POST", "/api/signatures/sign", {
      token: "tok-monitor-stale",
      body: {
        projectId: "proj_synth_01",
        targetType: "crf_record",
        targetId: "rec_synth_01",
        targetVersion: 2,
        meaning: "Verificación SDV",
        reason: "Revisión de fuente completada",
      },
    });
    assert.equal(staleDenied.status, 403);
    assert.equal(staleDenied.json.code, "REAUTH_REQUIRED");

    // Monitor recién reautenticado -> 200 con manifiesto HMAC verificable
    const okRes = await requestJson("POST", "/api/signatures/sign", {
      token: "tok-monitor",
      body: {
        projectId: "proj_synth_01",
        targetType: "crf_record",
        targetId: "rec_synth_01",
        targetVersion: 2,
        meaning: "Verificación SDV",
        reason: "Revisión de fuente completada sin discrepancias",
      },
    });
    assert.equal(okRes.status, 200);
    const m = okRes.json.manifest as Record<string, unknown>;
    assert.equal(m.signature_level, "reauthenticated_hmac_attestation");
    assert.equal(m.key_id, "aud-k2");
    assert.equal(m.signer_role, "monitor_clinico");

    const verification = verifyElectronicAttestation({
      id: String(m.id),
      projectId: String(m.project_id),
      targetType: m.target_type as "crf_record" | "study_lifecycle",
      targetId: String(m.target_id),
      targetVersion: Number(m.target_version),
      meaning: String(m.meaning),
      reason: String(m.reason),
      signerUid: String(m.signer_uid),
      signerName: String(m.signer_name),
      signerRole: String(m.signer_role),
      authTimeUtc: String(m.auth_time_utc),
      signedAtUtc: String(m.signed_at_utc),
      attestationHash: String(m.attestation_hash),
      keyId: String(m.key_id),
      signatureLevel: "reauthenticated_hmac_attestation",
    });
    assert.equal(verification, true);

    // Manipulación del motivo invalida la atestación
    const tampered = verifyElectronicAttestation({
      id: String(m.id),
      projectId: String(m.project_id),
      targetType: "crf_record",
      targetId: String(m.target_id),
      targetVersion: Number(m.target_version),
      meaning: String(m.meaning),
      reason: "Motivo alterado posteriormente",
      signerUid: String(m.signer_uid),
      signerName: String(m.signer_name),
      signerRole: String(m.signer_role),
      authTimeUtc: String(m.auth_time_utc),
      signedAtUtc: String(m.signed_at_utc),
      attestationHash: String(m.attestation_hash),
      keyId: String(m.key_id),
      signatureLevel: "reauthenticated_hmac_attestation",
    });
    assert.equal(tampered, false);

    // Firma histórica bajo clave previa aud-k1 sigue siendo verificable con AUDIT_HMAC_PREVIOUS_SECRETS
    const prevKeySigned = signElectronicAttestation(
      {
        projectId: "proj_synth_01",
        targetType: "study_lifecycle",
        targetId: "proj_synth_01",
        meaning: "Database Lock",
        reason: "Bloqueo histórico bajo clave anterior",
        signerUid: "uid_coordinador",
        signerName: "Synth coordinador",
        signerRole: "coordinador",
        authTimeUtc: new Date().toISOString(),
      },
      "aud-k1-legacy-secret-0123456789abcdef0123",
      "aud-k1"
    );
    assert.equal(verifyElectronicAttestation(prevKeySigned), true);
  });

  it("12. Ingesta tabular CSV y Excel (.xlsx) para generación automática de variables y detección de columnas identificativas", async () => {
    const synthSheetRows = [
      { codigo_sujeto: "SUBJ-001", dni: "12345678Z", edad: 62, grupo: "Control", pas: 140 },
      { codigo_sujeto: "SUBJ-002", dni: "00000000T", edad: 58, grupo: "Activo A", pas: 124 },
      { codigo_sujeto: "SUBJ-003", dni: "11111111H", edad: 71, grupo: "Activo B", pas: 128 },
    ];
    const ws = XLSX.utils.json_to_sheet(synthSheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cohorte");
    const xlsxBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const xlsxRes = await requestJson("POST", "/api/parse-tabular", {
      token: "tok-investigador",
      body: {
        projectId: "proj_synth_01",
        filename: "cohorte_sintetica.xlsx",
        contentBase64: xlsxBuf.toString("base64"),
      },
    });
    assert.equal(xlsxRes.status, 200);
    const vars = xlsxRes.json.variables as Array<{ name: string; type: string }>;
    const idCols = xlsxRes.json.identifierColumns as string[];
    const piiWarnings = xlsxRes.json.piiWarnings as string[];
    assert.ok(vars.some((v) => v.name === "edad" && v.type === "numeric"));
    assert.ok(vars.some((v) => v.name === "grupo" && v.type === "categorical"));
    assert.ok(idCols.includes("dni"));
    assert.ok(piiWarnings.some((w) => w.includes("DNI")));

    // Capturador y admin_tecnico no pueden importar bases masivas
    const techDenied = await requestJson("POST", "/api/parse-tabular", {
      token: "tok-admin-tecnico",
      body: {
        projectId: "proj_synth_01",
        filename: "cohorte_sintetica.csv",
        contentBase64: Buffer.from("edad,pas\n55,130\n", "utf8").toString("base64"),
      },
    });
    assert.equal(techDenied.status, 403);
    assert.equal(techDenied.json.code, "ROLE_FORBIDDEN");
  });

  it("13. Pruebas adversarias adicionales de PII en metadatos de formulario, niveles de dataset y redacción de logs", () => {
    const formMetaCheck = scanFormMetadataForPii("Seguimiento", [
      {
        name: "centro",
        label: "Centro",
        type: "select",
        required: false,
        choices: ["Hospital Norte", "Contacto: coord@hospital-ejemplo.es"],
        min: null,
        max: null,
        unit: "",
        help: "",
      },
    ]);
    assert.equal(formMetaCheck.hasPii, true);

    const dsMetaCheck = scanDatasetMetadataForPii({
      ...SYNTH_DATASET,
      variables: [
        { name: "grupo", label: "Grupo", type: "categorical", levels: ["Control", "DNI 12345678Z"] },
      ],
    });
    assert.equal(dsMetaCheck.hasPii, true);

    const spacedDni = scanForPii("Documento observado: 12 345 678 Z en nota clínica");
    assert.equal(spacedDni.hasPii, true);

    const redacted = redactPii("Paciente Elena García, teléfono 612345678, correo elena@ejemplo.es");
    assert.ok(!redacted.redactedText.includes("612345678"));
    assert.ok(!redacted.redactedText.includes("elena@ejemplo.es"));
  });
});

