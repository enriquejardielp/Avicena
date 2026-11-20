import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import path from "node:path";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { z } from "zod";
import { VALID_TEST_NAMES } from "../shared/analysisSpec.ts";
import type {
  Cell,
  ChatMessage,
  Dataset,
  FormField,
  UserRow,
} from "../src/lib/types.ts";
import {
  emitWormAuditRecord,
  signAuditEntry,
  signElectronicAttestation,
  verifyAuditChain,
  type AuditAction,
  type SignedAuditEntry,
} from "./auditChain.ts";
import { verifyFirebaseIdToken, type VerifiedFirebaseUser } from "./firebaseAuth.ts";
import { runGeminiCopilot } from "./geminiCopilot.ts";
import { extractFormFieldsFromText, PiiBlockedError } from "./geminiFormExtractor.ts";
import { logSecurityEvent, redactSensitiveText } from "./logger.ts";
import { isLikelyIdentifierVariable, sanitizeCsvCell, scanForPii } from "./piiGuard.ts";
import {
  assertNonIdentifiableResearchId,
  computeParticipantBlindIndex,
  generateSubjectPseudoId,
  sealIdentityPayload,
  unsealIdentityPayload,
} from "./pseudonymizer.ts";
import { StatsError } from "./statsEngine.ts";
import { executeStatisticalAnalysis, VerifiedEngineUnavailableError } from "./statsWorkerClient.ts";
import { cleanCell, inferVariables, nowIso, uid } from "./store.ts";
import {
  StudyAccessError,
  verifyStudyAccess,
  type StudyPermission,
  type VerifiedStudyContext,
} from "./studyAccess.ts";

export interface AuthedRequest extends Request {
  idToken?: string;
  verifiedUser?: VerifiedFirebaseUser;
  member?: UserRow;
}

export interface ApiRouterDeps {
  verifyToken?: (token: string) => Promise<VerifiedFirebaseUser>;
  verifyStudy?: (params: {
    idToken: string;
    user: VerifiedFirebaseUser;
    projectId: string;
    permission: StudyPermission;
    datasetId?: string;
    formId?: string;
  }) => Promise<VerifiedStudyContext>;
  extractForm?: typeof extractFormFieldsFromText;
  runCopilot?: typeof runGeminiCopilot;
}

const VALID_TESTS = VALID_TEST_NAMES;

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/, "Identificador no válido.");

const cellSchema = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

const variableSchema = z.object({
  name: z.string().min(1).max(160),
  label: z.string().max(240),
  type: z.enum(["numeric", "ordinal", "categorical", "binary", "date", "text"]),
  levels: z.array(z.string().max(200)).max(200),
});

const datasetSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  name: z.string().min(1).max(200),
  source: z.enum(["upload", "form"]),
  form_id: idSchema.nullable().optional(),
  variables: z.array(variableSchema).min(1).max(300),
  n_rows: z.number().int().min(0).max(100000),
  chunk_count: z.number().int().min(0).max(1000).optional(),
  created_at: z.string().max(100),
});

const parseTabularSchema = z.object({
  projectId: idSchema,
  filename: z.string().min(1).max(200),
  contentBase64: z.string().min(4).max(14_000_000),
});

const analyzeSchema = z.object({
  projectId: idSchema,
  dataset: datasetSchema,
  rows: z.array(z.record(z.string(), cellSchema)).max(50000),
  test: z.enum(VALID_TESTS),
  params: z.record(z.string(), z.unknown()).default({}),
  options: z
    .object({
      seed: z.number().int().min(0).max(2_147_483_647).optional(),
      alpha: z.number().min(0.0001).max(0.25).optional(),
      confLevel: z.number().min(0.75).max(0.999).optional(),
      tieMethod: z.enum(["efron", "breslow"]).optional(),
    })
    .optional(),
});

const formFieldSchema = z.object({
  name: z.string().min(1).max(160),
  label: z.string().min(1).max(240),
  type: z.enum(["text", "number", "date", "select", "radio", "checkbox", "yesno", "textarea"]),
  required: z.boolean(),
  choices: z.array(z.string().max(200)).max(200),
  min: z.number().nullable(),
  max: z.number().nullable(),
  unit: z.string().max(64),
  help: z.string().max(500),
});

const formsExtractSchema = z.object({
  projectId: idSchema,
  formId: idSchema.optional(),
  formName: z.string().min(1).max(200).optional(),
  fields: z.array(formFieldSchema).min(1).max(200),
  freeText: z.string().min(5).max(15000),
  currentValues: z.record(z.string(), z.unknown()).default({}),
  deidentifiedConfirmed: z.boolean(),
});

const aiChatSchema = z.object({
  projectId: idSchema,
  dataset: datasetSchema,
  rows: z.array(z.record(z.string(), cellSchema)).max(50000),
  pastMessages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(30000),
      })
    )
    .max(30)
    .default([]),
  message: z.string().min(1).max(4000),
});

const VALID_AUDIT_ACTIONS: [AuditAction, ...AuditAction[]] = [
  "STUDY_CREATE",
  "STUDY_DELETE",
  "STUDY_STATUS_CHANGE",
  "STUDY_AMENDMENT",
  "FORM_CREATE",
  "FORM_UPDATE",
  "FORM_DELETE",
  "DATASET_UPLOAD",
  "DATASET_DELETE",
  "DATASET_SCHEMA_UPDATE",
  "RECORD_CREATE",
  "RECORD_UPDATE",
  "RECORD_STATUS_CHANGE",
  "RECORD_REOPEN",
  "QUERY_OPEN",
  "QUERY_RESPOND",
  "QUERY_CLOSE",
  "DEVIATION_LOGGED",
  "DEVIATION_UPDATED",
  "ELECTRONIC_APPROVAL",
  "EXPORT_DATA",
  "ANALYSIS_RUN",
  "ANALYSIS_SAVED",
  "ANALYSIS_UPDATED",
  "ANALYSIS_DELETED",
  "AI_EXTRACT",
  "AI_CHAT",
  "MEMBER_INVITED",
  "MEMBER_ROLE_CHANGED",
  "MEMBER_REMOVED",
  "GOVERNANCE_UPDATED",
  "CONSENT_RECORDED",
  "CONSENT_WITHDRAWN",
  "SUBJECT_PSEUDONYMIZED",
  "REIDENTIFICATION_ACCESS",
  "ACCESS_DENIED",
];

const pseudonymSealSchema = z.object({
  projectId: idSchema,
  subjectPseudoId: z.string().max(64).optional(),
  fullName: z.string().trim().min(2).max(160),
  nationalId: z.string().trim().min(4).max(40),
  nhc: z.string().trim().max(40).optional().default(""),
  birthDate: z.string().trim().max(32).optional(),
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().max(160).optional(),
});

const pseudonymUnsealSchema = z.object({
  projectId: idSchema,
  subjectPseudoId: idSchema,
  reason: z.string().trim().min(15, "Indica un motivo justificado de al menos 15 caracteres.").max(500),
  sealedPayload: z.object({
    version: z.enum(["aes-256-gcm-v1", "aes-256-gcm-v2"]),
    keyId: z.string().min(1).max(64).optional(),
    iv: z.string().min(8).max(200),
    tag: z.string().min(8).max(200),
    ciphertext: z.string().min(4).max(20000),
  }),
  prevHash: z.string().max(128).optional(),
});

const auditSignSchema = z.object({
  projectId: idSchema,
  action: z.enum(VALID_AUDIT_ACTIONS),
  resourceType: z.string().min(1).max(64),
  resourceId: z.string().min(1).max(128),
  outcome: z.enum(["SUCCESS", "DENIED", "ERROR"]),
  reason: z.string().max(500).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  prevHash: z.string().max(128).optional(),
});

const auditVerifySchema = z.object({
  projectId: idSchema,
  entries: z
    .array(
      z.object({
        projectId: z.string(),
        actorUid: z.string(),
        actorName: z.string(),
        actorRole: z.string(),
        action: z.enum(VALID_AUDIT_ACTIONS),
        resourceType: z.string(),
        resourceId: z.string(),
        outcome: z.enum(["SUCCESS", "DENIED", "ERROR"]),
        reason: z.string().optional(),
        details: z.record(z.string(), z.unknown()).optional(),
        timestampUtc: z.string(),
        prevHash: z.string(),
        entryHash: z.string(),
        keyId: z.string().optional(),
      })
    )
    .max(2000),
});

const datasetExportSchema = z.object({
  projectId: idSchema,
  dataset: datasetSchema,
  rows: z.array(z.record(z.string(), cellSchema)).max(50000),
  reason: z.string().trim().min(10, "Debes indicar el motivo clínico de la exportación (mín. 10 caracteres).").max(500),
  includeIdentifiers: z.boolean().default(false),
});

const signatureSignSchema = z.object({
  projectId: idSchema,
  targetType: z.enum(["crf_record", "study_lifecycle"]),
  targetId: idSchema,
  targetVersion: z.number().int().min(1).optional(),
  meaning: z.string().trim().min(5, "Especifica el significado de la aprobación electrónica.").max(200),
  reason: z.string().trim().min(5, "Indica el motivo de la aprobación electrónica (mín. 5 caracteres).").max(500),
  maxAuthAgeSec: z.number().int().min(30).max(300).optional(),
});

function normalizeColumnName(raw: string, idx: number, used: Set<string>): string {
  const cleaned = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  let base = cleaned || `var_${idx + 1}`;
  if (/^\d/.test(base)) base = `v_${base}`;
  let cand = base;
  let n = 2;
  while (used.has(cand)) {
    cand = `${base}_${n}`;
    n += 1;
  }
  used.add(cand);
  return cand;
}

function parseTabularFile(filename: string, base64Content: string): Record<string, Cell>[] {
  const ext = path.extname(filename).toLowerCase();
  if (![".csv", ".txt", ".xlsx", ".xls"].includes(ext)) {
    throw new Error("Extensión no soportada. Usa .csv, .xlsx o .xls.");
  }
  const buf = Buffer.from(base64Content, "base64");
  if (buf.length > 10 * 1024 * 1024) {
    throw new Error("El archivo excede el límite máximo de 10 MB.");
  }
  let rawRows: Record<string, unknown>[] = [];

  if (ext === ".xlsx" || ext === ".xls") {
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    const sheet = wb.Sheets[sheetName];
    rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  } else {
    const text = buf.toString("utf-8").replace(/^\uFEFF/, "");
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });
    rawRows = parsed.data ?? [];
  }

  if (!rawRows.length) return [];
  if (rawRows.length > 50000) {
    throw new Error("El archivo supera el máximo de 50.000 filas por base de datos.");
  }

  const origKeys = Object.keys(rawRows[0] ?? {}).slice(0, 300);
  const used = new Set<string>();
  const keyMap = origKeys.map((k, idx) => ({ orig: k, norm: normalizeColumnName(k, idx, used) }));

  return rawRows.map((row) => {
    const out: Record<string, Cell> = {};
    for (const { orig, norm } of keyMap) {
      out[norm] = cleanCell(row[orig]);
    }
    return out;
  });
}

function handleRouteError(
  res: Response,
  err: unknown,
  fallbackMessage: string,
  auditContext?: { projectId?: string; actorUid?: string; path?: string }
) {
  if (err instanceof StudyAccessError) {
    logSecurityEvent("warn", "worm_access_denied", {
      worm_audit: true,
      action: "ACCESS_DENIED",
      code: err.code,
      status: err.status,
      projectId: auditContext?.projectId ?? "unknown",
      actorUid: auditContext?.actorUid ?? "anonymous",
      path: auditContext?.path ?? "",
    });
    res.status(err.status).json({ code: err.code, detail: err.message });
    return;
  }
  if (err instanceof PiiBlockedError) {
    logSecurityEvent("warn", "worm_pii_blocked", {
      worm_audit: true,
      action: "ACCESS_DENIED",
      code: "PII_DETECTED",
      projectId: auditContext?.projectId ?? "unknown",
      actorUid: auditContext?.actorUid ?? "anonymous",
      path: auditContext?.path ?? "",
    });
    res.status(422).json({ code: "PII_DETECTED", detail: err.message });
    return;
  }
  if (err instanceof StatsError) {
    res.status(422).json({ code: "STATS_VALIDATION_ERROR", detail: err.message });
    return;
  }
  if (err instanceof VerifiedEngineUnavailableError) {
    res.status(503).json({ code: "VERIFIED_ENGINE_UNAVAILABLE", detail: err.message });
    return;
  }
  const msg = redactSensitiveText(err instanceof Error ? err.message : String(err));
  logSecurityEvent("error", "api_unhandled_error", { message: msg });
  res.status(500).json({ code: "INTERNAL_ERROR", detail: fallbackMessage });
}

export function createApiRouter(deps?: ApiRouterDeps): express.Router {
  const verifyToken = deps?.verifyToken ?? ((t: string) => verifyFirebaseIdToken(t, { checkRevoked: true }));
  const verifyStudy = deps?.verifyStudy ?? verifyStudyAccess;
  const extractForm = deps?.extractForm ?? extractFormFieldsFromText;
  const runCopilot = deps?.runCopilot ?? runGeminiCopilot;

  const api = express.Router();

  // Strictly prevent caching of any API/clinical response
  api.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  // Upload route gets dedicated 10mb JSON parser BEFORE global 2mb cap
  const largeJsonParser = express.json({ limit: "11mb" });
  const defaultJsonParser = express.json({ limit: "2mb" });
  api.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/parse-tabular") {
      largeJsonParser(req, res, next);
    } else {
      defaultJsonParser(req, res, next);
    }
  });

  const globalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: "RATE_LIMIT", detail: "Demasiadas peticiones. Espera un momento e inténtalo de nuevo." },
  });

  const clinicalOpsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 45,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: AuthedRequest) => req.member?.user_id || ipKeyGenerator(req.ip || ""),
    message: { code: "RATE_LIMIT_CLINICAL", detail: "Has superado el límite temporal de operaciones estadísticas." },
  });

  const aiOpsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: AuthedRequest) => req.member?.user_id || ipKeyGenerator(req.ip || ""),
    message: { code: "RATE_LIMIT_AI", detail: "Has superado el límite de consultas por minuto al servicio de IA." },
  });

  api.use(globalApiLimiter);

  api.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, service: "avicena", timestamp: nowIso() });
  });

  // Authentication + revocation + verified-email gate
  api.use(async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.header("authorization") ?? "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      res.status(401).json({ code: "AUTH_REQUIRED", detail: "Inicia sesión para acceder a Avicena." });
      return;
    }
    const token = match[1].trim();
    try {
      const verified = await verifyToken(token);
      req.idToken = token;
      req.verifiedUser = verified;
      req.member = {
        user_id: verified.uid,
        email: verified.email,
        name: verified.name,
        photo_url: verified.picture,
      };
      next();
    } catch (err) {
      const code = err instanceof Error ? err.message : "TOKEN_INVALID";
      logSecurityEvent("warn", "auth_rejected", { code, path: req.path });
      if (code === "EMAIL_NOT_VERIFIED") {
        res.status(403).json({
          code: "EMAIL_NOT_VERIFIED",
          detail: "Debes verificar tu dirección de correo electrónico antes de acceder a datos clínicos.",
        });
        return;
      }
      if (code === "USER_DISABLED") {
        res.status(401).json({
          code: "USER_DISABLED",
          detail: "Tu cuenta ha sido deshabilitada.",
        });
        return;
      }
      if (code === "TOKEN_REVOKED") {
        res.status(401).json({
          code: "TOKEN_REVOKED",
          detail: "Tu sesión ha sido revocada. Inicia sesión de nuevo.",
        });
        return;
      }
      if (code.startsWith("AUTH_LOOKUP_FAILED") || code.startsWith("AUTH_CERTS_FETCH_FAILED")) {
        res.status(503).json({
          code: "AUTH_UNAVAILABLE",
          detail: "No se pudo verificar el estado de la sesión con el proveedor de identidad.",
        });
        return;
      }
      res.status(401).json({
        code: "SESSION_INVALID",
        detail: "Tu sesión ha expirado o no es válida. Inicia sesión de nuevo.",
      });
    }
  });

  api.get("/me", (req: AuthedRequest, res: Response) => {
    res.json({
      ...req.member,
      email_verified: Boolean(req.verifiedUser?.email_verified),
      mfa_active: Boolean(req.verifiedUser?.mfa_second_factor),
    });
  });

  // Tabular CSV / Excel Parser for Firestore import (requires dataset.upload on study)
  api.post("/parse-tabular", clinicalOpsLimiter, async (req: AuthedRequest, res: Response) => {
    const parsedBody = parseTabularSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(422).json({
        code: "INVALID_INPUT",
        detail: "Datos de importación no válidos o estudio no especificado.",
      });
      return;
    }

    const { projectId, filename, contentBase64 } = parsedBody.data;
    try {
      const ctx = await verifyStudy({
        idToken: req.idToken!,
        user: req.verifiedUser!,
        projectId,
        permission: "dataset.upload",
      });

      const parsedRows = parseTabularFile(filename, contentBase64);
      if (!parsedRows.length) {
        res.status(422).json({ code: "EMPTY_FILE", detail: "El archivo no contiene filas válidas." });
        return;
      }
      const variables = inferVariables(parsedRows);
      const identifierColumns = variables
        .filter((v) => isLikelyIdentifierVariable(v.name, v.label))
        .map((v) => v.name);
      const piiCategoriesSet = new Set<string>();
      for (const row of parsedRows.slice(0, 60)) {
        for (const v of variables) {
          const val = row[v.name];
          if (typeof val === "string" && val.trim().length >= 4) {
            const scan = scanForPii(val);
            for (const label of scan.labels) piiCategoriesSet.add(label);
          }
        }
      }
      logSecurityEvent("info", "tabular_import_parsed", {
        worm_audit: true,
        action: "DATASET_UPLOAD",
        projectId,
        actorUid: req.verifiedUser!.uid,
        role: ctx.role,
        rowCount: parsedRows.length,
        variableCount: variables.length,
        identifierColumnCount: identifierColumns.length,
      });
      res.json({
        variables,
        rows: parsedRows,
        identifierColumns,
        piiWarnings: Array.from(piiCategoriesSet),
      });
    } catch (err) {
      if (err instanceof StudyAccessError) {
        handleRouteError(res, err, "Acceso denegado.", {
          projectId,
          actorUid: req.verifiedUser?.uid,
          path: req.path,
        });
        return;
      }
      res.status(422).json({
        code: "PARSE_ERROR",
        detail: `No se pudo leer el archivo (${err instanceof Error ? redactSensitiveText(err.message) : "formato inválido"}).`,
      });
    }
  });

  // Statistical Engine (requires analytics.run + dataset ownership in study)
  api.post("/analyze", clinicalOpsLimiter, async (req: AuthedRequest, res: Response) => {
    const parsedBody = analyzeSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(422).json({
        code: "INVALID_INPUT",
        detail: "Parámetros de análisis incompletos o con formato no válido.",
      });
      return;
    }

    const { projectId, dataset, rows, test, params, options } = parsedBody.data;
    if (dataset.project_id !== projectId) {
      res.status(403).json({
        code: "PROJECT_MISMATCH",
        detail: "La base de datos no pertenece al estudio indicado.",
      });
      return;
    }

    try {
      const ctx = await verifyStudy({
        idToken: req.idToken!,
        user: req.verifiedUser!,
        projectId,
        permission: "analytics.run",
        datasetId: dataset.id,
      });

      const envelope = await executeStatisticalAnalysis({
        test,
        rows: rows as Record<string, Cell>[],
        variables: dataset.variables,
        params,
        specOptions: options,
      });
      logSecurityEvent("info", "analysis_executed", {
        worm_audit: true,
        action: "ANALYSIS_RUN",
        projectId,
        datasetId: dataset.id,
        test,
        rowCount: rows.length,
        engine: envelope.result.provenance?.engine ?? "unknown",
        verifiedByLibrary: envelope.result.provenance?.verified_by_library ?? false,
        specHash: envelope.specHash,
        datasetSha256: envelope.datasetSha256,
        seed: envelope.spec.options.seed,
        actorUid: req.verifiedUser!.uid,
        role: ctx.role,
      });
      res.json(envelope.result);
    } catch (err) {
      handleRouteError(res, err, "Error al ejecutar la prueba estadística.", {
        projectId,
        actorUid: req.verifiedUser?.uid,
        path: req.path,
      });
    }
  });

  // AI Clinical Free-Text CRF Extraction (requires ai.extract + study AI governance + PII block)
  api.post("/forms/extract", aiOpsLimiter, async (req: AuthedRequest, res: Response) => {
    const parsedBody = formsExtractSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(422).json({
        code: "INVALID_INPUT",
        detail: "Solicitud de extracción no válida. Verifica el texto clínico y los campos del formulario.",
      });
      return;
    }

    const { projectId, formId, formName, fields, freeText, currentValues, deidentifiedConfirmed } = parsedBody.data;

    try {
      const ctx = await verifyStudy({
        idToken: req.idToken!,
        user: req.verifiedUser!,
        projectId,
        permission: "ai.extract",
        formId,
      });

      const extracted = await extractForm(
        (formName ?? "Formulario clínico").trim(),
        fields as FormField[],
        freeText.trim(),
        currentValues,
        { deidentifiedConfirmed }
      );
      logSecurityEvent("info", "ai_extract_completed", {
        worm_audit: true,
        action: "AI_EXTRACT",
        projectId,
        formId: formId ?? "custom",
        detectedCount: extracted.detectedCount,
        actorUid: req.verifiedUser!.uid,
        role: ctx.role,
      });
      res.json(extracted);
    } catch (err) {
      if (err instanceof StudyAccessError || err instanceof PiiBlockedError) {
        handleRouteError(res, err, "Envío bloqueado.", {
          projectId,
          actorUid: req.verifiedUser?.uid,
          path: req.path,
        });
        return;
      }
      const msg = redactSensitiveText(err instanceof Error ? err.message : String(err));
      if (msg.includes("GEMINI_API_KEY_MISSING")) {
        res.status(503).json({
          code: "AI_NOT_CONFIGURED",
          detail: "Falta configurar GEMINI_API_KEY en Settings > Secrets para usar la extracción con IA.",
        });
        return;
      }
      logSecurityEvent("error", "ai_extract_failed", { projectId, message: msg });
      res.status(500).json({
        code: "AI_EXTRACTION_ERROR",
        detail:
          msg.includes("503") || msg.includes("UNAVAILABLE")
            ? "El servicio de IA está con alta demanda temporal (503). Inténtalo de nuevo en unos segundos."
            : "No se pudo completar la extracción clínica de variables.",
      });
    }
  });

  // AI Copilot (requires ai.chat + dataset ownership + study AI governance + PII block)
  api.post("/ai/chat", aiOpsLimiter, async (req: AuthedRequest, res: Response) => {
    const parsedBody = aiChatSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(422).json({
        code: "INVALID_INPUT",
        detail: "Consulta no válida. Verifica el mensaje y la base de datos seleccionada.",
      });
      return;
    }

    const member = req.member!;
    const { projectId, dataset, rows, pastMessages, message } = parsedBody.data;

    if (dataset.project_id !== projectId) {
      res.status(403).json({
        code: "PROJECT_MISMATCH",
        detail: "La base de datos no pertenece al estudio indicado.",
      });
      return;
    }

    let verifiedCtx: VerifiedStudyContext;
    try {
      verifiedCtx = await verifyStudy({
        idToken: req.idToken!,
        user: req.verifiedUser!,
        projectId,
        permission: "ai.chat",
        datasetId: dataset.id,
      });
    } catch (err) {
      handleRouteError(res, err, "Acceso denegado al Asistente IA.", {
        projectId,
        actorUid: req.verifiedUser?.uid,
        path: req.path,
      });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const outcome = await runCopilot(
        dataset as Dataset,
        rows as Record<string, Cell>[],
        pastMessages as ChatMessage[],
        message.trim(),
        {
          onStatus: (text) => sendEvent("status", { text }),
          onAnalysis: (result) => sendEvent("analysis", result),
          onDelta: (text) => sendEvent("delta", { text }),
          onError: (text) => sendEvent("error", { text }),
        }
      );

      logSecurityEvent("info", "ai_copilot_completed", {
        worm_audit: true,
        action: "AI_CHAT",
        projectId,
        datasetId: dataset.id,
        hasAnalysis: Boolean(outcome.analysis),
        actorUid: req.verifiedUser!.uid,
        role: verifiedCtx.role,
      });

      const assistantMsg: ChatMessage = {
        id: uid(),
        dataset_id: dataset.id,
        user_id: member.user_id,
        role: "assistant",
        content: outcome.content,
        analysis: outcome.analysis,
        created_at: nowIso(),
      };

      sendEvent("done", assistantMsg);
      res.end();
    } catch (err) {
      const msg = redactSensitiveText(err instanceof Error ? err.message : String(err));
      logSecurityEvent("error", "ai_chat_stream_error", { projectId, message: msg });
      sendEvent("error", { text: "Error interno al procesar la consulta bioestadística." });
      res.end();
    }
  });

  // Pseudonymization & Identity Vault Seal (creates blind index + AES-256-GCM encrypted payload)
  api.post("/pseudonymize/seal", clinicalOpsLimiter, async (req: AuthedRequest, res: Response) => {
    const parsedBody = pseudonymSealSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(422).json({
        code: "INVALID_INPUT",
        detail: "Completa el nombre y el identificador civil/clínico para generar el código pseudonimizado.",
      });
      return;
    }

    const { projectId, fullName, nationalId, nhc, birthDate, phone, email } = parsedBody.data;
    const candidateId = parsedBody.data.subjectPseudoId?.trim() || generateSubjectPseudoId();
    const idCheck = assertNonIdentifiableResearchId(candidateId);
    if (!idCheck.valid) {
      res.status(422).json({ code: "IDENTIFIABLE_STUDY_ID", detail: idCheck.reason });
      return;
    }
    const normCand = candidateId.toUpperCase().replace(/[\s.-]+/g, "");
    const normNat = nationalId.toUpperCase().replace(/[\s.-]+/g, "");
    const normNhc = (nhc || "").toUpperCase().replace(/[\s.-]+/g, "");
    if (normCand === normNat || (normNhc && normCand === normNhc)) {
      res.status(422).json({
        code: "IDENTIFIABLE_STUDY_ID",
        detail: "El código pseudonimizado de investigación no puede coincidir con el DNI ni el NHC.",
      });
      return;
    }

    try {
      const ctx = await verifyStudy({
        idToken: req.idToken!,
        user: req.verifiedUser!,
        projectId,
        permission: "vault.register",
      });

      const blindIndex = computeParticipantBlindIndex(projectId, nationalId);
      const sealedPayload = sealIdentityPayload(projectId, {
        fullName,
        nationalId,
        nhc: nhc || "",
        birthDate: birthDate || "",
        phone: phone || "",
        email: email || "",
      });

      logSecurityEvent("info", "vault_subject_sealed", {
        worm_audit: true,
        action: "SUBJECT_PSEUDONYMIZED",
        projectId,
        subjectPseudoId: candidateId,
        actorUid: req.verifiedUser!.uid,
        role: ctx.role,
      });

      res.json({
        subjectPseudoId: candidateId,
        blindIndex,
        sealedPayload,
      });
    } catch (err) {
      handleRouteError(res, err, "No se pudo cifrar y pseudonimizar la identidad del participante.", {
        projectId,
        actorUid: req.verifiedUser?.uid,
        path: req.path,
      });
    }
  });

  // Restricted & Audited Re-identification (only Investigador Principal & Coordinador)
  api.post("/pseudonymize/unseal", clinicalOpsLimiter, async (req: AuthedRequest, res: Response) => {
    const parsedBody = pseudonymUnsealSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(422).json({
        code: "INVALID_INPUT",
        detail: parsedBody.error.issues[0]?.message || "Solicitud de reidentificación no válida.",
      });
      return;
    }

    const { projectId, subjectPseudoId, reason, sealedPayload, prevHash } = parsedBody.data;
    const user = req.verifiedUser!;

    try {
      const ctx = await verifyStudy({
        idToken: req.idToken!,
        user,
        projectId,
        permission: "vault.reidentify",
      });

      const identity = unsealIdentityPayload(projectId, sealedPayload);
      const auditEntry = signAuditEntry({
        projectId,
        actorUid: user.uid,
        actorName: user.name,
        actorRole: ctx.role,
        action: "REIDENTIFICATION_ACCESS",
        resourceType: "identityVault",
        resourceId: subjectPseudoId,
        outcome: "SUCCESS",
        reason,
        details: { subjectPseudoId },
        prevHash: prevHash || "GENESIS",
      });

      emitWormAuditRecord(auditEntry);

      logSecurityEvent("info", "vault_reidentification", {
        projectId,
        subjectPseudoId,
        actorUid: user.uid,
        role: ctx.role,
      });

      res.json({
        subjectPseudoId,
        identity,
        auditEntry,
      });
    } catch (err) {
      handleRouteError(res, err, "No se pudo descifrar la identidad solicitada.");
    }
  });

  // Immutable Audit Chain Signing (server-verified actor, role & UTC timestamp)
  api.post("/audit/sign", clinicalOpsLimiter, async (req: AuthedRequest, res: Response) => {
    const parsedBody = auditSignSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(422).json({
        code: "INVALID_INPUT",
        detail: "Datos de evento de auditoría no válidos.",
      });
      return;
    }

    const { projectId, action, resourceType, resourceId, outcome, reason, details, prevHash } = parsedBody.data;
    const user = req.verifiedUser!;

    try {
      const ctx = await verifyStudy({
        idToken: req.idToken!,
        user,
        projectId,
        permission: "audit.write",
      });

      const signed = signAuditEntry({
        projectId,
        actorUid: user.uid,
        actorName: user.name,
        actorRole: ctx.role,
        action,
        resourceType,
        resourceId,
        outcome,
        reason,
        details,
        prevHash: prevHash || "GENESIS",
      });

      emitWormAuditRecord(signed);
      res.json(signed);
    } catch (err) {
      handleRouteError(res, err, "No se pudo firmar el registro de auditoría.");
    }
  });

  // Immutable Audit Chain Integrity Verification
  api.post("/audit/verify", clinicalOpsLimiter, async (req: AuthedRequest, res: Response) => {
    const parsedBody = auditVerifySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(422).json({
        code: "INVALID_INPUT",
        detail: "Formato de cadena de auditoría no válido.",
      });
      return;
    }

    const { projectId, entries } = parsedBody.data;

    try {
      await verifyStudy({
        idToken: req.idToken!,
        user: req.verifiedUser!,
        projectId,
        permission: "audit.read",
      });

      const foreignIdx = entries.findIndex((e) => e.projectId !== projectId);
      if (foreignIdx !== -1) {
        res.json({
          valid: false,
          checkedCount: foreignIdx,
          brokenAtIndex: foreignIdx,
          reason: `El registro ${foreignIdx} pertenece a otro estudio.`,
        });
        return;
      }

      const verification = verifyAuditChain(entries as SignedAuditEntry[]);
      res.json(verification);
    } catch (err) {
      handleRouteError(res, err, "No se pudo verificar la cadena de auditoría.");
    }
  });

  // Controlled, Pseudonymized & Audited CSV Dataset Export
  api.post("/exports/dataset", clinicalOpsLimiter, async (req: AuthedRequest, res: Response) => {
    const parsedBody = datasetExportSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(422).json({
        code: "INVALID_INPUT",
        detail: parsedBody.error.issues[0]?.message || "Parámetros de exportación no válidos.",
      });
      return;
    }

    const { projectId, dataset, rows, reason, includeIdentifiers } = parsedBody.data;
    if (dataset.project_id !== projectId) {
      res.status(403).json({
        code: "PROJECT_MISMATCH",
        detail: "La base de datos no pertenece al estudio indicado.",
      });
      return;
    }

    const isBulk = rows.length > 500;
    const permission: StudyPermission = isBulk ? "dataset.export_bulk" : "dataset.export";

    try {
      const ctx = await verifyStudy({
        idToken: req.idToken!,
        user: req.verifiedUser!,
        projectId,
        permission,
        datasetId: dataset.id,
      });

      const allowRawIds = includeIdentifiers && (ctx.role === "admin" || ctx.role === "coordinador");
      const strippedColumns: string[] = [];
      const sampleRows = rows.slice(0, 200);
      const exportVars = dataset.variables.filter((v) => {
        if (!allowRawIds && isLikelyIdentifierVariable(v.name, v.label)) {
          strippedColumns.push(v.name);
          return false;
        }
        if (!allowRawIds) {
          const containsPiiValue = sampleRows.some((row) => {
            const val = row[v.name];
            return typeof val === "string" && val.trim().length >= 4 && scanForPii(val).hasPii;
          });
          if (containsPiiValue) {
            strippedColumns.push(v.name);
            return false;
          }
        }
        return true;
      });

      const exportCols = exportVars.map((v) => v.name);
      const exportRows = rows.map((row) => {
        const out: Record<string, Cell> = {};
        for (const col of exportCols) {
          out[col] = sanitizeCsvCell(row[col]);
        }
        return out;
      });

      const csvBody = Papa.unparse(exportRows, { columns: exportCols });
      const csvContent = "\uFEFF" + csvBody;
      const sha256 = crypto.createHash("sha256").update(csvContent, "utf8").digest("hex");
      const safeName = dataset.name.replace(/[^a-zA-Z0-9_-]+/g, "_") || "dataset";
      const suffix = allowRawIds ? "controlado" : "pseudonimizado";
      const filename = `${safeName}_${suffix}.csv`;

      logSecurityEvent("info", "dataset_exported", {
        worm_audit: true,
        projectId,
        datasetId: dataset.id,
        rowCount: exportRows.length,
        strippedColumnsCount: strippedColumns.length,
        sha256,
        actorUid: req.verifiedUser!.uid,
        role: ctx.role,
        reason,
      });

      res.setHeader("X-Avicena-Export-Sha256", sha256);
      res.json({
        filename,
        csvContent,
        sha256,
        strippedColumns,
        rowCount: exportRows.length,
        columnCount: exportCols.length,
      });
    } catch (err) {
      handleRouteError(res, err, "No se pudo completar la exportación controlada.", {
        projectId,
        actorUid: req.verifiedUser?.uid,
        path: req.path,
      });
    }
  });

  // Electronic Approval Attestation with Fresh Re-authentication Enforcement (21 CFR Part 11-aligned; non-QES)
  api.post("/signatures/sign", clinicalOpsLimiter, async (req: AuthedRequest, res: Response) => {
    const parsedBody = signatureSignSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(422).json({
        code: "INVALID_INPUT",
        detail: parsedBody.error.issues[0]?.message || "Parámetros de aprobación electrónica no válidos.",
      });
      return;
    }

    const { projectId, targetType, targetId, targetVersion, meaning, reason, maxAuthAgeSec } = parsedBody.data;
    const user = req.verifiedUser!;

    try {
      const ctx = await verifyStudy({
        idToken: req.idToken!,
        user,
        projectId,
        permission: "signature.sign",
      });

      const nowSec = Math.floor(Date.now() / 1000);
      const allowedAgeSec = maxAuthAgeSec ?? 300;
      const authAge = nowSec - Number(user.auth_time || 0);
      if (!Number.isFinite(authAge) || authAge < -30 || authAge > allowedAgeSec) {
        logSecurityEvent("warn", "worm_reauth_required", {
          worm_audit: true,
          action: "ACCESS_DENIED",
          code: "REAUTH_REQUIRED",
          projectId,
          targetType,
          targetId,
          actorUid: user.uid,
          authAgeSec: authAge,
        });
        res.status(403).json({
          code: "REAUTH_REQUIRED",
          detail:
            "La aprobación electrónica requiere reautenticación reciente (≤ 5 minutos). Confirma tu contraseña o proveedor de acceso antes de firmar.",
        });
        return;
      }

      const authTimeUtc = new Date(user.auth_time * 1000).toISOString();
      const signed = signElectronicAttestation({
        projectId,
        targetType,
        targetId,
        targetVersion,
        meaning,
        reason,
        signerUid: user.uid,
        signerName: user.name,
        signerRole: ctx.role,
        authTimeUtc,
      });

      logSecurityEvent("info", "electronic_approval_signed", {
        worm_audit: true,
        action: "ELECTRONIC_APPROVAL",
        projectId,
        targetType,
        targetId,
        targetVersion: targetVersion ?? null,
        meaning: signed.meaning,
        signerUid: user.uid,
        signerRole: ctx.role,
        signatureId: signed.id,
        attestationHash: signed.attestationHash,
        keyId: signed.keyId,
        signatureLevel: signed.signatureLevel,
      });

      res.json({
        manifest: {
          id: signed.id,
          project_id: signed.projectId,
          target_type: signed.targetType,
          target_id: signed.targetId,
          ...(signed.targetVersion !== undefined ? { target_version: signed.targetVersion } : {}),
          meaning: signed.meaning,
          reason: signed.reason,
          signer_uid: signed.signerUid,
          signer_name: signed.signerName,
          signer_role: signed.signerRole,
          auth_time_utc: signed.authTimeUtc,
          signed_at_utc: signed.signedAtUtc,
          attestation_hash: signed.attestationHash,
          key_id: signed.keyId,
          signature_level: signed.signatureLevel,
        },
      });
    } catch (err) {
      handleRouteError(res, err, "No se pudo emitir la aprobación electrónica.", {
        projectId,
        actorUid: user.uid,
        path: req.path,
      });
    }
  });

  // Centralized error handler (never exposes stack traces or PII)
  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const errObj = err as { type?: string; status?: number; message?: string };
    if (errObj?.type === "entity.too.large" || errObj?.status === 413) {
      res.status(413).json({ code: "PAYLOAD_TOO_LARGE", detail: "La solicitud excede el tamaño máximo permitido." });
      return;
    }
    if (err instanceof SyntaxError && "body" in errObj) {
      res.status(400).json({ code: "INVALID_JSON", detail: "Cuerpo JSON malformado." });
      return;
    }
    logSecurityEvent("error", "api_middleware_error", {
      message: redactSensitiveText(err instanceof Error ? err.message : String(err)),
    });
    res.status(500).json({ code: "INTERNAL_ERROR", detail: "Error interno del servidor." });
  });

  return api;
}
