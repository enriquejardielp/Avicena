import crypto from "node:crypto";
import { validateEnvironmentConfig } from "./envConfig.ts";
import { logSecurityEvent, redactSensitiveText } from "./logger.ts";

export type AuditAction =
  | "STUDY_CREATE"
  | "STUDY_DELETE"
  | "STUDY_STATUS_CHANGE"
  | "STUDY_AMENDMENT"
  | "FORM_CREATE"
  | "FORM_UPDATE"
  | "FORM_DELETE"
  | "DATASET_UPLOAD"
  | "DATASET_DELETE"
  | "DATASET_SCHEMA_UPDATE"
  | "RECORD_CREATE"
  | "RECORD_UPDATE"
  | "RECORD_STATUS_CHANGE"
  | "RECORD_REOPEN"
  | "QUERY_OPEN"
  | "QUERY_RESPOND"
  | "QUERY_CLOSE"
  | "DEVIATION_LOGGED"
  | "DEVIATION_UPDATED"
  | "ELECTRONIC_APPROVAL"
  | "EXPORT_DATA"
  | "ANALYSIS_RUN"
  | "ANALYSIS_SAVED"
  | "ANALYSIS_DELETED"
  | "AI_EXTRACT"
  | "AI_CHAT"
  | "MEMBER_INVITED"
  | "MEMBER_ROLE_CHANGED"
  | "MEMBER_REMOVED"
  | "GOVERNANCE_UPDATED"
  | "CONSENT_RECORDED"
  | "CONSENT_WITHDRAWN"
  | "SUBJECT_PSEUDONYMIZED"
  | "REIDENTIFICATION_ACCESS"
  | "ACCESS_DENIED";

export interface AuditChainEntryInput {
  projectId: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  outcome: "SUCCESS" | "DENIED" | "ERROR";
  reason?: string;
  details?: Record<string, unknown>;
  timestampUtc: string;
  prevHash: string;
  keyId?: string;
}

export interface SignedAuditEntry extends AuditChainEntryInput {
  entryHash: string;
}

function canonicalAuditString(input: AuditChainEntryInput): string {
  const base: Record<string, unknown> = {
    projectId: input.projectId,
    actorUid: input.actorUid,
    actorName: input.actorName,
    actorRole: input.actorRole,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: input.outcome,
    reason: redactSensitiveText(input.reason ?? "").slice(0, 500),
    details: input.details ?? {},
    timestampUtc: input.timestampUtc,
    prevHash: input.prevHash,
  };
  if (input.keyId) {
    base.keyId = input.keyId;
  }
  return JSON.stringify(base);
}

export function signAuditEntry(
  input: Omit<AuditChainEntryInput, "timestampUtc"> & { timestampUtc?: string },
  secretOverride?: string,
  keyIdOverride?: string
): SignedAuditEntry {
  const cfg = validateEnvironmentConfig();
  const secret = secretOverride || cfg.auditHmacSecret;
  const keyId = keyIdOverride || input.keyId || cfg.auditHmacKeyId;
  const full: AuditChainEntryInput = {
    ...input,
    reason: input.reason ? redactSensitiveText(input.reason).slice(0, 500) : "",
    timestampUtc: input.timestampUtc || new Date().toISOString(),
    prevHash: input.prevHash || "GENESIS",
    keyId,
  };
  const entryHash = crypto
    .createHmac("sha256", secret)
    .update(canonicalAuditString(full))
    .digest("hex");

  return {
    ...full,
    entryHash,
  };
}

export function emitWormAuditRecord(entry: SignedAuditEntry): void {
  const cfg = validateEnvironmentConfig();
  if (!cfg.wormAuditStreamEnabled) return;
  logSecurityEvent("info", "worm_audit_event", {
    worm_audit: true,
    projectId: entry.projectId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    actorUid: entry.actorUid,
    actorRole: entry.actorRole,
    outcome: entry.outcome,
    keyId: entry.keyId ?? "legacy",
    timestampUtc: entry.timestampUtc,
    prevHash: entry.prevHash,
    entryHash: entry.entryHash,
  });
}

function candidateSecretsForEntry(
  entry: AuditChainEntryInput,
  secretOverride?: string
): string[] {
  if (secretOverride) return [secretOverride];
  const cfg = validateEnvironmentConfig();
  const ordered: string[] = [];
  if (entry.keyId && entry.keyId === cfg.auditHmacKeyId) {
    ordered.push(cfg.auditHmacSecret);
  } else if (entry.keyId && cfg.auditHmacPreviousSecrets[entry.keyId]) {
    ordered.push(cfg.auditHmacPreviousSecrets[entry.keyId]);
  }
  ordered.push(cfg.auditHmacSecret, ...Object.values(cfg.auditHmacPreviousSecrets));
  return Array.from(new Set(ordered.filter(Boolean)));
}

export function verifyAuditChain(
  entries: SignedAuditEntry[],
  secretOverride?: string
): {
  valid: boolean;
  checkedCount: number;
  brokenAtIndex: number | null;
  reason?: string;
} {
  let expectedPrev = "GENESIS";

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.prevHash !== expectedPrev) {
      return {
        valid: false,
        checkedCount: i,
        brokenAtIndex: i,
        reason: `Cadena rota en el índice ${i}: prevHash no coincide con el hash anterior.`,
      };
    }

    const candidates = candidateSecretsForEntry(entry, secretOverride);
    const actualBuf = Buffer.from(entry.entryHash || "", "utf8");
    let matched = false;
    for (const secret of candidates) {
      const recomputed = crypto
        .createHmac("sha256", secret)
        .update(canonicalAuditString(entry))
        .digest("hex");
      const expectedBuf = Buffer.from(recomputed, "utf8");
      if (actualBuf.length === expectedBuf.length && crypto.timingSafeEqual(actualBuf, expectedBuf)) {
        matched = true;
        break;
      }
    }

    if (!matched) {
      return {
        valid: false,
        checkedCount: i,
        brokenAtIndex: i,
        reason: `Firma HMAC inválida en el registro ${i} (posible alteración o clave no reconocida).`,
      };
    }
    expectedPrev = entry.entryHash;
  }

  return {
    valid: true,
    checkedCount: entries.length,
    brokenAtIndex: null,
  };
}

export interface ElectronicAttestationInput {
  projectId: string;
  targetType: "crf_record" | "study_lifecycle";
  targetId: string;
  targetVersion?: number;
  meaning: string;
  reason: string;
  signerUid: string;
  signerName: string;
  signerRole: string;
  authTimeUtc: string;
  signedAtUtc?: string;
}

export interface SignedElectronicAttestation extends ElectronicAttestationInput {
  id: string;
  signedAtUtc: string;
  attestationHash: string;
  keyId: string;
  signatureLevel: "reauthenticated_hmac_attestation";
}

function canonicalAttestationString(
  a: ElectronicAttestationInput & { id: string; signedAtUtc: string; keyId: string }
): string {
  return JSON.stringify({
    id: a.id,
    projectId: a.projectId,
    targetType: a.targetType,
    targetId: a.targetId,
    targetVersion: a.targetVersion ?? null,
    meaning: redactSensitiveText(a.meaning).slice(0, 200),
    reason: redactSensitiveText(a.reason).slice(0, 500),
    signerUid: a.signerUid,
    signerName: a.signerName,
    signerRole: a.signerRole,
    authTimeUtc: a.authTimeUtc,
    signedAtUtc: a.signedAtUtc,
    keyId: a.keyId,
    signatureLevel: "reauthenticated_hmac_attestation",
  });
}

export function signElectronicAttestation(
  input: ElectronicAttestationInput,
  secretOverride?: string,
  keyIdOverride?: string
): SignedElectronicAttestation {
  const cfg = validateEnvironmentConfig();
  const secret = secretOverride || cfg.auditHmacSecret;
  const keyId = keyIdOverride || cfg.auditHmacKeyId;
  const id = `sig_${crypto.randomBytes(8).toString("hex")}`;
  const signedAtUtc = input.signedAtUtc || new Date().toISOString();
  const payload = {
    ...input,
    id,
    meaning: redactSensitiveText(input.meaning).slice(0, 200),
    reason: redactSensitiveText(input.reason).slice(0, 500),
    signedAtUtc,
    keyId,
  };
  const attestationHash = crypto
    .createHmac("sha256", secret)
    .update(canonicalAttestationString(payload))
    .digest("hex");

  return {
    ...payload,
    attestationHash,
    signatureLevel: "reauthenticated_hmac_attestation",
  };
}

export function verifyElectronicAttestation(
  attestation: SignedElectronicAttestation,
  secretOverride?: string
): boolean {
  const cfg = validateEnvironmentConfig();
  const candidates = secretOverride
    ? [secretOverride]
    : [
        ...(attestation.keyId === cfg.auditHmacKeyId
          ? [cfg.auditHmacSecret]
          : cfg.auditHmacPreviousSecrets[attestation.keyId]
            ? [cfg.auditHmacPreviousSecrets[attestation.keyId]]
            : []),
        cfg.auditHmacSecret,
        ...Object.values(cfg.auditHmacPreviousSecrets),
      ].filter(Boolean);

  const actual = Buffer.from(attestation.attestationHash || "", "utf8");
  for (const s of Array.from(new Set(candidates))) {
    const recomputed = crypto
      .createHmac("sha256", s)
      .update(canonicalAttestationString(attestation))
      .digest("hex");
    const expected = Buffer.from(recomputed, "utf8");
    if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) {
      return true;
    }
  }
  return false;
}
