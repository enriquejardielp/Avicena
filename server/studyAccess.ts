import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };
import type { Role } from "../src/lib/types.ts";
import type { VerifiedFirebaseUser } from "./firebaseAuth.ts";

export type StudyPermission =
  | "dataset.upload"
  | "dataset.export"
  | "dataset.export_bulk"
  | "analytics.run"
  | "ai.extract"
  | "ai.chat"
  | "vault.register"
  | "vault.reidentify"
  | "audit.read"
  | "audit.write"
  | "signature.sign";

export interface StudyGovernancePolicy {
  aiEnabled: boolean;
  aiAllowClinicalText: boolean;
  aiAllowDatasetContext: boolean;
  aiDpaConfirmed: boolean;
  requireMfa: boolean;
  requireActiveConsent: boolean;
}

export const DEFAULT_STUDY_GOVERNANCE: StudyGovernancePolicy = {
  aiEnabled: false,
  aiAllowClinicalText: false,
  aiAllowDatasetContext: false,
  aiDpaConfirmed: false,
  requireMfa: false,
  requireActiveConsent: false,
};

export interface VerifiedStudyContext {
  projectId: string;
  role: Role;
  isOwner: boolean;
  governance: StudyGovernancePolicy;
}

export class StudyAccessError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "StudyAccessError";
    this.status = status;
    this.code = code;
  }
}

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

function decodeFirestoreValue(val: FirestoreValue | undefined): unknown {
  if (!val) return undefined;
  if ("stringValue" in val) return val.stringValue;
  if ("booleanValue" in val) return val.booleanValue;
  if ("integerValue" in val) return Number(val.integerValue);
  if ("doubleValue" in val) return val.doubleValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("nullValue" in val) return null;
  if ("arrayValue" in val) return (val.arrayValue.values ?? []).map(decodeFirestoreValue);
  if ("mapValue" in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields ?? {})) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

async function fetchFirestoreDoc(
  docPath: string,
  idToken: string
): Promise<Record<string, unknown> | null> {
  const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;
  const databaseId = process.env.FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || "(default)";
  const encodedPath = docPath
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodedPath}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    throw new StudyAccessError(403, "FORBIDDEN_STUDY_RESOURCE", "No tienes autorización sobre este estudio o recurso.");
  }
  if (!res.ok) {
    throw new StudyAccessError(503, "FIRESTORE_ACCESS_CHECK_FAILED", "No se pudo verificar la autorización del estudio.");
  }

  const raw = (await res.json()) as { fields?: Record<string, FirestoreValue> };
  const decoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw.fields ?? {})) {
    decoded[k] = decodeFirestoreValue(v);
  }
  return decoded;
}

const VALID_ROLES = new Set<string>([
  "admin",
  "coordinador",
  "investigador",
  "monitor_clinico",
  "estadistico",
  "admin_tecnico",
  "capturador",
]);

export function roleAllowsPermission(role: Role, perm: StudyPermission): boolean {
  // admin_tecnico is administrative/audit-only: strictly excluded from clinical data, vault & AI
  if (role === "admin_tecnico") {
    return perm === "audit.read" || perm === "audit.write";
  }

  switch (perm) {
    case "dataset.upload":
      return role === "admin" || role === "coordinador" || role === "investigador";
    case "dataset.export":
      return role === "admin" || role === "coordinador" || role === "investigador" || role === "estadistico";
    case "dataset.export_bulk":
      return role === "admin" || role === "coordinador";
    case "analytics.run":
      return role === "admin" || role === "coordinador" || role === "investigador" || role === "estadistico";
    case "ai.chat":
      return role === "admin" || role === "coordinador" || role === "investigador" || role === "estadistico";
    case "ai.extract":
      return role === "admin" || role === "coordinador" || role === "investigador" || role === "capturador";
    case "vault.register":
      return role === "admin" || role === "coordinador" || role === "investigador" || role === "capturador";
    case "vault.reidentify":
      return role === "admin" || role === "coordinador";
    case "audit.read":
      return role === "admin" || role === "coordinador" || role === "monitor_clinico";
    case "audit.write":
      return true;
    case "signature.sign":
      return role === "admin" || role === "coordinador" || role === "investigador" || role === "monitor_clinico";
    default:
      return false;
  }
}

export async function verifyStudyAccess(params: {
  idToken: string;
  user: VerifiedFirebaseUser;
  projectId: string;
  permission: StudyPermission;
  datasetId?: string;
  formId?: string;
}): Promise<VerifiedStudyContext> {
  const { idToken, user, projectId, permission, datasetId, formId } = params;

  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
    throw new StudyAccessError(422, "INVALID_PROJECT_ID", "Identificador de estudio no válido.");
  }

  const projectDoc = await fetchFirestoreDoc(`projects/${projectId}`, idToken);
  if (!projectDoc) {
    throw new StudyAccessError(403, "STUDY_NOT_FOUND_OR_FORBIDDEN", "Estudio no encontrado o sin acceso.");
  }

  const isOwner = projectDoc.ownerId === user.uid;
  const memberDoc = await fetchFirestoreDoc(`projects/${projectId}/members/${user.uid}`, idToken);

  if (!isOwner && !memberDoc) {
    throw new StudyAccessError(403, "NOT_STUDY_MEMBER", "No eres miembro activo de este estudio.");
  }

  if (memberDoc && memberDoc.status && memberDoc.status !== "active") {
    throw new StudyAccessError(403, "MEMBERSHIP_INACTIVE", "Tu membresía en este estudio ha sido suspendida o revocada.");
  }

  let role: Role = "capturador";
  if (isOwner) {
    role = "admin";
  } else if (memberDoc && typeof memberDoc.role === "string" && VALID_ROLES.has(memberDoc.role)) {
    role = memberDoc.role as Role;
  } else {
    throw new StudyAccessError(403, "INVALID_MEMBER_ROLE", "No se pudo validar tu rol en el estudio.");
  }

  if (!roleAllowsPermission(role, permission)) {
    throw new StudyAccessError(
      403,
      "ROLE_FORBIDDEN",
      `Tu rol (${role}) no tiene permiso para ejecutar esta operación.`
    );
  }

  const govDoc = await fetchFirestoreDoc(`projects/${projectId}/governance/settings`, idToken).catch(() => null);
  const governance: StudyGovernancePolicy = govDoc
    ? {
        aiEnabled: Boolean(govDoc.aiEnabled),
        aiAllowClinicalText: Boolean(govDoc.aiAllowClinicalText),
        aiAllowDatasetContext: Boolean(govDoc.aiAllowDatasetContext),
        aiDpaConfirmed: Boolean(govDoc.aiDpaConfirmed),
        requireMfa: Boolean(govDoc.requireMfa),
        requireActiveConsent: Boolean(govDoc.requireActiveConsent),
      }
    : { ...DEFAULT_STUDY_GOVERNANCE };

  if (governance.requireMfa && !user.mfa_second_factor) {
    throw new StudyAccessError(
      403,
      "MFA_REQUIRED_BY_STUDY",
      "Este estudio exige autenticación multifactor (MFA) activa para acceder a esta función."
    );
  }

  if (permission === "ai.extract") {
    if (!governance.aiEnabled || !governance.aiAllowClinicalText || !governance.aiDpaConfirmed) {
      throw new StudyAccessError(
        403,
        "AI_DISABLED_BY_STUDY_POLICY",
        "El envío de texto clínico a modelos de IA externos está desactivado por defecto en este estudio. Un administrador del estudio debe habilitarlo explícitamente en Gobernanza."
      );
    }
  }

  if (permission === "ai.chat") {
    if (!governance.aiEnabled || !governance.aiAllowDatasetContext || !governance.aiDpaConfirmed) {
      throw new StudyAccessError(
        403,
        "AI_DISABLED_BY_STUDY_POLICY",
        "El Asistente IA externo está desactivado por defecto en este estudio. Un administrador del estudio debe habilitarlo explícitamente en Gobernanza."
      );
    }
  }

  if (datasetId) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(datasetId)) {
      throw new StudyAccessError(422, "INVALID_DATASET_ID", "Identificador de base de datos no válido.");
    }
    const dsDoc = await fetchFirestoreDoc(`projects/${projectId}/datasets/${datasetId}`, idToken);
    if (!dsDoc || dsDoc.projectId !== projectId) {
      throw new StudyAccessError(403, "DATASET_NOT_IN_STUDY", "La base de datos no pertenece al estudio indicado.");
    }
  }

  if (formId) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(formId)) {
      throw new StudyAccessError(422, "INVALID_FORM_ID", "Identificador de formulario no válido.");
    }
    const formDoc = await fetchFirestoreDoc(`projects/${projectId}/forms/${formId}`, idToken);
    if (!formDoc || formDoc.projectId !== projectId) {
      throw new StudyAccessError(403, "FORM_NOT_IN_STUDY", "El formulario no pertenece al estudio indicado.");
    }
    if (datasetId && formDoc.datasetId !== datasetId) {
      throw new StudyAccessError(403, "FORM_DATASET_MISMATCH", "El formulario no corresponde a la base de datos indicada.");
    }
  }

  return {
    projectId,
    role,
    isOwner,
    governance,
  };
}
