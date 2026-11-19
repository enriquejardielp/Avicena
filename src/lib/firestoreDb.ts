import type { User } from "firebase/auth";
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase.ts";
import { apiPost } from "./api.ts";
import type {
  AnalysisResult,
  AuditLogEntry,
  Cell,
  ChatMessage,
  ClinicalQuery,
  ConsentMethod,
  ConsentRecord,
  ConsentStatus,
  CrfRecordStatus,
  CrfVersionEntry,
  Dataset,
  DatasetRowItem,
  DeviationSeverity,
  DeviationStatus,
  ElectronicSignatureManifest,
  FieldType,
  Form,
  FormField,
  FormIn,
  Project,
  ProjectMember,
  ProtocolDeviation,
  QueryMessageEntry,
  QueryStatus,
  RecordOut,
  ResultTable,
  Role,
  SavedAnalysis,
  SealedIdentityPayload,
  StudyAmendment,
  StudyGovernance,
  StudyLifecycle,
  StudyStatus,
  UserRow,
  Variable,
  VarType,
  VaultSubjectSummary,
} from "./types.ts";

const CHUNK_SIZE = 100;

function makeId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 14)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function safeDocKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80);
}

function tsToIso(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (val && typeof val === "object" && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function") {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === "string" && val) return val;
  return new Date().toISOString();
}

function ensureVerifiedUser(user: User): void {
  if (!user.emailVerified) {
    throw new Error(
      "Verifica tu correo electrónico (bandeja de entrada) y recarga la página para crear o modificar datos en la nube."
    );
  }
}

const FIELD_TO_VAR_TYPE: Record<FieldType, VarType> = {
  number: "numeric",
  yesno: "binary",
  select: "categorical",
  radio: "categorical",
  date: "date",
  text: "text",
  textarea: "text",
  checkbox: "text",
};

function humanizeVarLabel(name: string): string {
  const clean = name.replace(/[_-]+/g, " ").trim();
  if (!clean) return name;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function buildFormFieldsFromVariables(
  variables: Variable[],
  sampleRows?: Record<string, Cell>[]
): FormField[] {
  return variables.slice(0, 200).map((v) => {
    const label = v.label && v.label.trim() ? v.label.trim().slice(0, 160) : humanizeVarLabel(v.name).slice(0, 160);
    const nonNullSample = (sampleRows ?? [])
      .map((r) => r[v.name])
      .filter((val) => val !== null && val !== undefined && String(val).trim() !== "")
      .map((val) => String(val).trim());

    let levels = Array.isArray(v.levels)
      ? v.levels.map((l) => String(l).trim()).filter(Boolean)
      : [];

    if (!levels.length && nonNullSample.length && (v.type === "binary" || v.type === "categorical")) {
      levels = Array.from(new Set(nonNullSample)).sort().slice(0, 50);
    }

    const hasLongText = nonNullSample.some((s) => s.length > 120);
    const looksLikeIdOrFreeTextName =
      /(^|_)(id|codigo|cod|nhc|historia|paciente|dni|nif|nombre|apellidos|nota|notas|observacion|observaciones|comentario|comentarios|texto|diagnostico_libre)($|_)/i.test(
        v.name
      );
    const looksLikeDate =
      levels.length > 0 && levels.every((l) => /^\d{4}-\d{2}-\d{2}/.test(l));
    const allUniqueStrings =
      nonNullSample.length >= 4 && new Set(nonNullSample).size === nonNullSample.length && levels.length > 2;

    let type: FieldType = "text";
    let choices: string[] = [];

    if (v.type === "numeric") {
      type = "number";
    } else if (v.type === "date" || (v.type === "categorical" && looksLikeDate)) {
      type = "date";
    } else if (v.type === "binary") {
      const isZeroOne = levels.length === 0 || levels.every((l) => l === "0" || l === "1");
      if (isZeroOne) {
        type = "yesno";
      } else {
        type = "radio";
        choices = levels.slice(0, 50);
      }
    } else if (v.type === "categorical") {
      if (looksLikeIdOrFreeTextName || allUniqueStrings) {
        type = hasLongText ? "textarea" : "text";
      } else if (levels.length === 0) {
        type = "text";
      } else if (levels.length <= 4) {
        type = "radio";
        choices = levels.slice(0, 50);
      } else {
        type = "select";
        choices = levels.slice(0, 50);
      }
    } else {
      type = hasLongText ? "textarea" : "text";
    }

    return {
      name: v.name,
      label,
      type,
      required: false,
      choices,
      min: null,
      max: null,
      unit: "",
      help: "",
    };
  });
}

export function buildFormVariables(fields: FormField[]): Variable[] {
  return fields.map((f) => ({
    name: f.name,
    label: f.label,
    type: FIELD_TO_VAR_TYPE[f.type] ?? "text",
    levels: f.type === "yesno" ? ["0", "1"] : f.choices?.length ? f.choices.slice(0, 50) : [],
  }));
}

export function recomputeVarLevels(variables: Variable[], rows: Record<string, Cell>[]): Variable[] {
  return variables.map((v) => {
    if (v.type === "categorical" || v.type === "binary") {
      const levels = Array.from(
        new Set(
          rows
            .map((r) => r[v.name])
            .filter((val) => val !== null && val !== undefined && val !== "")
            .map((val) => String(val))
        )
      )
        .sort()
        .slice(0, 50);
      return { ...v, levels };
    }
    return { ...v, levels: [] };
  });
}

function serializeTables(tables: ResultTable[]): Array<{ title: string; columns: string[]; rows: Array<{ cells: Cell[] }>; note: string }> {
  return tables.slice(0, 20).map((t) => ({
    title: String(t.title ?? ""),
    columns: Array.isArray(t.columns) ? t.columns.map(String) : [],
    rows: Array.isArray(t.rows) ? t.rows.map((r) => ({ cells: Array.isArray(r) ? r : [] })) : [],
    note: String(t.note ?? ""),
  }));
}

function deserializeTables(rawTables: unknown): ResultTable[] {
  if (!Array.isArray(rawTables)) return [];
  return rawTables.map((t) => {
    const obj = (t ?? {}) as { title?: string; columns?: unknown[]; rows?: unknown[]; note?: string };
    const rows: Cell[][] = Array.isArray(obj.rows)
      ? obj.rows.map((r) => {
          if (Array.isArray(r)) return r as Cell[];
          if (r && typeof r === "object" && "cells" in r && Array.isArray((r as { cells: unknown[] }).cells)) {
            return (r as { cells: Cell[] }).cells;
          }
          return [];
        })
      : [];
    return {
      title: String(obj.title ?? ""),
      columns: Array.isArray(obj.columns) ? obj.columns.map(String) : [],
      rows,
      note: String(obj.note ?? ""),
    };
  });
}

function serializeAnalysis(a: AnalysisResult): Record<string, unknown> {
  return {
    test: String(a.test ?? ""),
    title: String(a.title ?? "").slice(0, 240),
    summary: String(a.summary ?? "").slice(0, 4000),
    tables: serializeTables(a.tables ?? []),
    charts: Array.isArray(a.charts) ? a.charts.slice(0, 10) : [],
  };
}

function deserializeAnalysis(raw: unknown): AnalysisResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as {
    test?: string;
    title?: string;
    summary?: string;
    tables?: unknown;
    charts?: AnalysisResult["charts"];
  };
  return {
    test: String(obj.test ?? ""),
    title: String(obj.title ?? ""),
    summary: String(obj.summary ?? ""),
    tables: deserializeTables(obj.tables),
    charts: Array.isArray(obj.charts) ? obj.charts : [],
  };
}

export function cleanRecordInput(fields: FormField[], inputData: Record<string, unknown>): Record<string, Cell> {
  const cleanedRecord: Record<string, Cell> = {};
  for (const field of fields) {
    const raw = inputData[field.name];
    const isEmpty =
      raw === null ||
      raw === undefined ||
      (typeof raw === "string" && raw.trim() === "") ||
      (Array.isArray(raw) && raw.length === 0);

    if (field.required && isEmpty) {
      throw new Error(`El campo obligatorio «${field.label}» está vacío.`);
    }
    if (isEmpty) {
      cleanedRecord[field.name] = null;
      continue;
    }

    if (field.type === "number") {
      const num = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
      if (!Number.isFinite(num)) {
        throw new Error(`«${field.label}» debe ser un valor numérico válido.`);
      }
      if (field.min !== null && num < field.min) {
        throw new Error(`«${field.label}» (${num}) es menor que el mínimo clínico permitido (${field.min}).`);
      }
      if (field.max !== null && num > field.max) {
        throw new Error(`«${field.label}» (${num}) supera el máximo clínico permitido (${field.max}).`);
      }
      cleanedRecord[field.name] = Math.round(num * 10000) / 10000;
    } else if (field.type === "yesno") {
      const low = String(raw).toLowerCase().trim();
      cleanedRecord[field.name] =
        raw === true || raw === 1 || low === "1" || low === "sí" || low === "si" ? 1 : 0;
    } else if (field.type === "checkbox") {
      cleanedRecord[field.name] = Array.isArray(raw) ? raw.map(String).join(", ") : String(raw).trim();
    } else {
      cleanedRecord[field.name] = String(raw).trim();
    }
  }
  return cleanedRecord;
}

const SHARD_MAX_SIZE = 500;
type ShardedIndexKind =
  | "crfRecordIds"
  | "crfVersionIds"
  | "auditLogIds"
  | "vaultIds"
  | "consentIds"
  | "queryIds"
  | "deviationIds"
  | "signatureIds";
const ALL_SHARD_KINDS: ShardedIndexKind[] = [
  "crfRecordIds",
  "crfVersionIds",
  "auditLogIds",
  "vaultIds",
  "consentIds",
  "queryIds",
  "deviationIds",
  "signatureIds",
];

function shardDocId(kind: ShardedIndexKind, shardIndex: number): string {
  return `shard_${kind}_${shardIndex}`;
}

interface MetaIndexData {
  projectId: string;
  memberIds: string[];
  datasetIds: string[];
  formIds: string[];
  inviteIds: string[];
  crfRecordIds: string[];
  crfVersionIds: string[];
  vaultIds: string[];
  consentIds: string[];
  auditLogIds: string[];
  queryIds: string[];
  deviationIds: string[];
  signatureIds: string[];
  lastAuditHash: string;
  analysisIds: string[];
  shardCounts: Partial<Record<ShardedIndexKind, number>>;
}

function dedupePreserveOrder(base: string[], extra: string[]): string[] {
  if (!extra.length) return base;
  const seen = new Set(base);
  const out = [...base];
  for (const id of extra) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

async function getMetaIndex(projectId: string): Promise<MetaIndexData> {
  const path = `projects/${projectId}/meta/index`;
  try {
    const snap = await getDoc(doc(db, "projects", projectId, "meta", "index"));
    if (!snap.exists()) {
      return {
        projectId,
        memberIds: [],
        datasetIds: [],
        formIds: [],
        inviteIds: [],
        crfRecordIds: [],
        crfVersionIds: [],
        vaultIds: [],
        consentIds: [],
        auditLogIds: [],
        queryIds: [],
        deviationIds: [],
        signatureIds: [],
        lastAuditHash: "GENESIS",
        analysisIds: [],
        shardCounts: {},
      };
    }
    const d = snap.data() as Partial<MetaIndexData>;
    const shardCounts: Partial<Record<ShardedIndexKind, number>> =
      d.shardCounts && typeof d.shardCounts === "object" ? { ...d.shardCounts } : {};

    const shardFetches: Array<{ kind: ShardedIndexKind; idx: number; promise: Promise<string[]> }> = [];
    for (const kind of ALL_SHARD_KINDS) {
      const count = Number(shardCounts[kind] ?? 0);
      for (let i = 0; i < count; i++) {
        shardFetches.push({
          kind,
          idx: i,
          promise: getDoc(doc(db, "projects", projectId, "meta", shardDocId(kind, i)))
            .then((s) => (s.exists() ? ((s.data() as { ids?: string[] }).ids ?? []) : []))
            .catch(() => []),
        });
      }
    }

    const resolved = await Promise.all(shardFetches.map((f) => f.promise));
    const shardedByKind: Record<ShardedIndexKind, string[]> = {
      crfRecordIds: [],
      crfVersionIds: [],
      auditLogIds: [],
      vaultIds: [],
      consentIds: [],
      queryIds: [],
      deviationIds: [],
      signatureIds: [],
    };
    shardFetches.forEach((f, pos) => {
      shardedByKind[f.kind].push(...resolved[pos]);
    });

    return {
      projectId,
      memberIds: Array.isArray(d.memberIds) ? d.memberIds : [],
      datasetIds: Array.isArray(d.datasetIds) ? d.datasetIds : [],
      formIds: Array.isArray(d.formIds) ? d.formIds : [],
      inviteIds: Array.isArray(d.inviteIds) ? d.inviteIds : [],
      crfRecordIds: dedupePreserveOrder(
        Array.isArray(d.crfRecordIds) ? d.crfRecordIds : [],
        shardedByKind.crfRecordIds
      ),
      crfVersionIds: dedupePreserveOrder(
        Array.isArray(d.crfVersionIds) ? d.crfVersionIds : [],
        shardedByKind.crfVersionIds
      ),
      vaultIds: dedupePreserveOrder(Array.isArray(d.vaultIds) ? d.vaultIds : [], shardedByKind.vaultIds),
      consentIds: dedupePreserveOrder(Array.isArray(d.consentIds) ? d.consentIds : [], shardedByKind.consentIds),
      auditLogIds: dedupePreserveOrder(
        Array.isArray(d.auditLogIds) ? d.auditLogIds : [],
        shardedByKind.auditLogIds
      ),
      queryIds: shardedByKind.queryIds,
      deviationIds: shardedByKind.deviationIds,
      signatureIds: shardedByKind.signatureIds,
      lastAuditHash: typeof d.lastAuditHash === "string" && d.lastAuditHash ? d.lastAuditHash : "GENESIS",
      analysisIds: Array.isArray(d.analysisIds) ? d.analysisIds : [],
      shardCounts,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

async function appendIdsToMetaShards(
  projectId: string,
  entries: Partial<Record<ShardedIndexKind, string>>,
  metaPatch?: Record<string, unknown>
): Promise<void> {
  const kindEntries = (Object.entries(entries) as Array<[ShardedIndexKind, string | undefined]>).filter(
    (pair): pair is [ShardedIndexKind, string] => Boolean(pair[1])
  );
  if (!kindEntries.length && (!metaPatch || !Object.keys(metaPatch).length)) return;

  const metaRef = doc(db, "projects", projectId, "meta", "index");
  await runTransaction(db, async (tx) => {
    const metaSnap = await tx.get(metaRef);
    const metaData = metaSnap.exists() ? (metaSnap.data() as Partial<MetaIndexData>) : {};
    const shardCounts: Partial<Record<ShardedIndexKind, number>> = {
      ...(metaData.shardCounts && typeof metaData.shardCounts === "object" ? metaData.shardCounts : {}),
    };

    const tailReads = await Promise.all(
      kindEntries.map(async ([kind, idToAdd]) => {
        const count = Number(shardCounts[kind] ?? 0);
        if (count <= 0) {
          return { kind, idToAdd, count, exists: false, currIds: [] as string[] };
        }
        const tailRef = doc(db, "projects", projectId, "meta", shardDocId(kind, count - 1));
        const tailSnap = await tx.get(tailRef);
        const currIds = tailSnap.exists() ? ((tailSnap.data() as { ids?: string[] }).ids ?? []) : [];
        return { kind, idToAdd, count, exists: tailSnap.exists(), currIds };
      })
    );

    let shardCountsChanged = false;
    for (const item of tailReads) {
      if (item.exists && item.currIds.includes(item.idToAdd)) continue;
      if (!item.exists || item.currIds.length >= SHARD_MAX_SIZE) {
        const nextIdx = item.count;
        const nextRef = doc(db, "projects", projectId, "meta", shardDocId(item.kind, nextIdx));
        tx.set(nextRef, {
          projectId,
          kind: item.kind,
          shardIndex: nextIdx,
          ids: [item.idToAdd],
          updatedAt: serverTimestamp(),
        });
        shardCounts[item.kind] = nextIdx + 1;
        shardCountsChanged = true;
      } else {
        const tailRef = doc(db, "projects", projectId, "meta", shardDocId(item.kind, item.count - 1));
        tx.update(tailRef, {
          ids: [...item.currIds, item.idToAdd],
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (shardCountsChanged || (metaPatch && Object.keys(metaPatch).length > 0)) {
      tx.update(metaRef, {
        ...(metaPatch ?? {}),
        ...(shardCountsChanged ? { shardCounts } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  });
}

async function removeIdsFromMetaShards(
  projectId: string,
  kind: ShardedIndexKind,
  removeIds: string[],
  metaPatch?: Record<string, unknown>
): Promise<void> {
  const removeSet = new Set(removeIds);
  const metaRef = doc(db, "projects", projectId, "meta", "index");
  const metaSnap = await getDoc(metaRef);
  if (!metaSnap.exists()) return;
  const metaData = metaSnap.data() as Partial<MetaIndexData>;
  const legacyList = Array.isArray(metaData[kind]) ? (metaData[kind] as string[]) : [];
  const legacyRemoved = legacyList.filter((id) => removeSet.has(id));
  const count = Number(metaData.shardCounts?.[kind] ?? 0);

  if (count > 0 && removeSet.size > 0) {
    const shardSnaps = await Promise.all(
      Array.from({ length: count }, (_, i) => getDoc(doc(db, "projects", projectId, "meta", shardDocId(kind, i))))
    );
    await Promise.all(
      shardSnaps.map(async (s) => {
        if (!s.exists()) return;
        const ids = (s.data() as { ids?: string[] }).ids ?? [];
        const nextIds = ids.filter((id) => !removeSet.has(id));
        if (nextIds.length !== ids.length) {
          await updateDoc(s.ref, { ids: nextIds, updatedAt: serverTimestamp() });
        }
      })
    );
  }

  if (legacyRemoved.length > 0 || (metaPatch && Object.keys(metaPatch).length > 0)) {
    await updateDoc(metaRef, {
      ...(metaPatch ?? {}),
      ...(legacyRemoved.length > 0 ? { [kind]: arrayRemove(...legacyRemoved) } : {}),
      updatedAt: serverTimestamp(),
    });
  }
}

export function buildProjectRoleFlags(myRole: Role) {
  return {
    can_edit: myRole === "admin" || myRole === "coordinador" || myRole === "investigador",
    can_manage_team: myRole === "admin",
    can_access_clinical: myRole !== "admin_tecnico",
    can_analyze: myRole === "admin" || myRole === "coordinador" || myRole === "investigador" || myRole === "estadistico",
    can_access_identity_vault: myRole === "admin" || myRole === "coordinador",
    can_export_data: myRole === "admin" || myRole === "coordinador" || myRole === "investigador" || myRole === "estadistico",
    can_verify_crf: myRole === "admin" || myRole === "coordinador" || myRole === "monitor_clinico",
    can_view_audit:
      myRole === "admin" || myRole === "coordinador" || myRole === "monitor_clinico" || myRole === "admin_tecnico",
  };
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_STUDY_GOVERNANCE: Omit<StudyGovernance, "project_id"> = {
  ai_enabled: false,
  ai_allow_clinical_text: false,
  ai_allow_dataset_context: false,
  ai_dpa_confirmed: false,
  require_mfa: false,
  require_active_consent: false,
};

export async function getStudyGovernance(projectId: string): Promise<StudyGovernance> {
  const path = `projects/${projectId}/governance/settings`;
  try {
    const snap = await getDoc(doc(db, "projects", projectId, "governance", "settings"));
    if (!snap.exists()) {
      return { project_id: projectId, ...DEFAULT_STUDY_GOVERNANCE };
    }
    const d = snap.data() as {
      aiEnabled?: boolean;
      aiAllowClinicalText?: boolean;
      aiAllowDatasetContext?: boolean;
      aiDpaConfirmed?: boolean;
      requireMfa?: boolean;
      requireActiveConsent?: boolean;
      updatedBy?: string;
      updatedAt?: unknown;
    };
    return {
      project_id: projectId,
      ai_enabled: Boolean(d.aiEnabled),
      ai_allow_clinical_text: Boolean(d.aiAllowClinicalText),
      ai_allow_dataset_context: Boolean(d.aiAllowDatasetContext),
      ai_dpa_confirmed: Boolean(d.aiDpaConfirmed),
      require_mfa: Boolean(d.requireMfa),
      require_active_consent: Boolean(d.requireActiveConsent),
      updated_by: d.updatedBy,
      updated_at: d.updatedAt ? tsToIso(d.updatedAt) : undefined,
    };
  } catch {
    return { project_id: projectId, ...DEFAULT_STUDY_GOVERNANCE };
  }
}

export async function updateStudyGovernance(
  projectId: string,
  patch: Partial<Omit<StudyGovernance, "project_id" | "updated_by" | "updated_at">>,
  user: User
): Promise<StudyGovernance> {
  ensureVerifiedUser(user);
  const path = `projects/${projectId}/governance/settings`;
  try {
    const curr = await getStudyGovernance(projectId);
    const next: StudyGovernance = {
      project_id: projectId,
      ai_enabled: patch.ai_enabled !== undefined ? Boolean(patch.ai_enabled) : curr.ai_enabled,
      ai_allow_clinical_text:
        patch.ai_allow_clinical_text !== undefined ? Boolean(patch.ai_allow_clinical_text) : curr.ai_allow_clinical_text,
      ai_allow_dataset_context:
        patch.ai_allow_dataset_context !== undefined
          ? Boolean(patch.ai_allow_dataset_context)
          : curr.ai_allow_dataset_context,
      ai_dpa_confirmed: patch.ai_dpa_confirmed !== undefined ? Boolean(patch.ai_dpa_confirmed) : curr.ai_dpa_confirmed,
      require_mfa: patch.require_mfa !== undefined ? Boolean(patch.require_mfa) : curr.require_mfa,
      require_active_consent:
        patch.require_active_consent !== undefined
          ? Boolean(patch.require_active_consent)
          : Boolean(curr.require_active_consent),
    };
    await setDoc(doc(db, "projects", projectId, "governance", "settings"), {
      projectId,
      aiEnabled: next.ai_enabled,
      aiAllowClinicalText: next.ai_allow_clinical_text,
      aiAllowDatasetContext: next.ai_allow_dataset_context,
      aiDpaConfirmed: next.ai_dpa_confirmed,
      requireMfa: next.require_mfa,
      requireActiveConsent: Boolean(next.require_active_consent),
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    await appendAuditLog(
      projectId,
      {
        action: "GOVERNANCE_UPDATED",
        resourceType: "governance",
        resourceId: "settings",
        outcome: "SUCCESS",
        details: {
          ai_enabled: next.ai_enabled,
          require_mfa: next.require_mfa,
          require_active_consent: Boolean(next.require_active_consent),
        },
      },
      { strict: true }
    );
    return { ...next, updated_by: user.uid, updated_at: new Date().toISOString() };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export interface SignedAuditResponse {
  projectId: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: "SUCCESS" | "DENIED" | "ERROR";
  reason: string;
  details: Record<string, unknown>;
  timestampUtc: string;
  prevHash: string;
  entryHash: string;
  keyId?: string;
}

export async function appendAuditLog(
  projectId: string,
  input: {
    action: string;
    resourceType: string;
    resourceId: string;
    outcome: "SUCCESS" | "DENIED" | "ERROR";
    reason?: string;
    details?: Record<string, unknown>;
  },
  options?: { strict?: boolean }
): Promise<AuditLogEntry | null> {
  try {
    const metaRef = doc(db, "projects", projectId, "meta", "index");
    return await runTransaction(db, async (tx) => {
      const metaSnap = await tx.get(metaRef);
      const metaData = metaSnap.exists() ? (metaSnap.data() as Partial<MetaIndexData>) : {};
      const prevHash =
        typeof metaData.lastAuditHash === "string" && metaData.lastAuditHash ? metaData.lastAuditHash : "GENESIS";
      const shardCounts: Partial<Record<ShardedIndexKind, number>> = {
        ...(metaData.shardCounts && typeof metaData.shardCounts === "object" ? metaData.shardCounts : {}),
      };
      const count = Number(shardCounts.auditLogIds ?? 0);
      let tailSnapIds: string[] = [];
      let creatingNewShard = count <= 0;
      let targetIdx = count > 0 ? count - 1 : 0;

      if (count > 0) {
        const tailSnap = await tx.get(doc(db, "projects", projectId, "meta", shardDocId("auditLogIds", count - 1)));
        if (!tailSnap.exists()) {
          creatingNewShard = true;
          targetIdx = count;
        } else {
          tailSnapIds = (tailSnap.data() as { ids?: string[] }).ids ?? [];
          if (tailSnapIds.length >= SHARD_MAX_SIZE) {
            creatingNewShard = true;
            targetIdx = count;
          }
        }
      }

      const signed = await apiPost<SignedAuditResponse>("/audit/sign", {
        projectId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        outcome: input.outcome,
        reason: input.reason ?? "",
        details: input.details ?? {},
        prevHash,
      });

      const auditId = makeId("aud");
      tx.set(doc(db, "projects", projectId, "auditLogs", auditId), signed);
      if (creatingNewShard) {
        tx.set(doc(db, "projects", projectId, "meta", shardDocId("auditLogIds", targetIdx)), {
          projectId,
          kind: "auditLogIds",
          shardIndex: targetIdx,
          ids: [auditId],
          updatedAt: serverTimestamp(),
        });
        shardCounts.auditLogIds = targetIdx + 1;
      } else {
        tx.update(doc(db, "projects", projectId, "meta", shardDocId("auditLogIds", targetIdx)), {
          ids: [...tailSnapIds, auditId],
          updatedAt: serverTimestamp(),
        });
      }

      tx.update(metaRef, {
        lastAuditHash: signed.entryHash,
        ...(creatingNewShard ? { shardCounts } : {}),
        updatedAt: serverTimestamp(),
      });

      return {
        id: auditId,
        project_id: signed.projectId,
        actor_uid: signed.actorUid,
        actor_name: signed.actorName,
        actor_role: signed.actorRole,
        action: signed.action,
        resource_type: signed.resourceType,
        resource_id: signed.resourceId,
        outcome: signed.outcome,
        reason: signed.reason ?? "",
        details: signed.details ?? {},
        timestamp_utc: signed.timestampUtc,
        prev_hash: signed.prevHash,
        entry_hash: signed.entryHash,
        key_id: signed.keyId,
      };
    });
  } catch (err) {
    if (options?.strict) {
      throw err instanceof Error ? err : new Error("No se pudo registrar el evento en la pista de auditoría.");
    }
    console.warn("Audit log append warning:", input.action);
    return null;
  }
}

export async function listAuditLogs(projectId: string): Promise<AuditLogEntry[]> {
  const path = `projects/${projectId}/auditLogs`;
  try {
    const meta = await getMetaIndex(projectId);
    if (!meta.auditLogIds.length) return [];
    const snaps = await Promise.all(
      meta.auditLogIds.map((id) => getDoc(doc(db, "projects", projectId, "auditLogs", id)).catch(() => null))
    );
    const entries: AuditLogEntry[] = [];
    for (const s of snaps) {
      if (!s || !s.exists()) continue;
      const d = s.data() as SignedAuditResponse;
      entries.push({
        id: s.id,
        project_id: d.projectId,
        actor_uid: d.actorUid,
        actor_name: d.actorName,
        actor_role: d.actorRole,
        action: d.action,
        resource_type: d.resourceType,
        resource_id: d.resourceId,
        outcome: d.outcome,
        reason: d.reason ?? "",
        details: d.details ?? {},
        timestamp_utc: d.timestampUtc,
        prev_hash: d.prevHash,
        entry_hash: d.entryHash,
        key_id: d.keyId,
      });
    }
    entries.sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));
    return entries;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function verifyProjectAuditTrail(
  projectId: string,
  entries: AuditLogEntry[]
): Promise<{ valid: boolean; checkedCount: number; brokenAtIndex: number | null; reason?: string }> {
  return apiPost<{ valid: boolean; checkedCount: number; brokenAtIndex: number | null; reason?: string }>(
    "/audit/verify",
    {
      projectId,
      entries: entries.map((e) => ({
        projectId: e.project_id,
        actorUid: e.actor_uid,
        actorName: e.actor_name,
        actorRole: e.actor_role,
        action: e.action,
        resourceType: e.resource_type,
        resourceId: e.resource_id,
        outcome: e.outcome,
        reason: e.reason,
        details: e.details,
        timestampUtc: e.timestamp_utc,
        prevHash: e.prev_hash,
        entryHash: e.entry_hash,
        ...(e.key_id ? { keyId: e.key_id } : {}),
      })),
    }
  );
}

async function appendToMemberIndex(
  projectId: string,
  userId: string,
  entry: { crfRecordId?: string; chatMessageId?: string }
): Promise<void> {
  const ref = doc(db, "projects", projectId, "memberIndexes", userId);
  const snap = await getDoc(ref).catch(() => null);
  if (!snap || !snap.exists()) {
    await setDoc(ref, {
      projectId,
      userId,
      crfRecordIds: entry.crfRecordId ? [entry.crfRecordId] : [],
      chatMessageIds: entry.chatMessageId ? [entry.chatMessageId] : [],
      updatedAt: serverTimestamp(),
    });
  } else {
    const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (entry.crfRecordId) updates.crfRecordIds = arrayUnion(entry.crfRecordId);
    if (entry.chatMessageId) updates.chatMessageIds = arrayUnion(entry.chatMessageId);
    await updateDoc(ref, updates);
  }
}

async function claimPendingInvites(user: User): Promise<void> {
  if (!user.emailVerified || !user.email) return;
  const email = user.email.trim().toLowerCase();
  try {
    const q = query(collection(db, "projectInvites"), where("email", "==", email));
    const snap = await getDocs(q);
    for (const invDoc of snap.docs) {
      const inv = invDoc.data() as {
        projectId: string;
        projectName: string;
        projectOwnerId: string;
        role: Role;
        status: string;
        expiresAt?: unknown;
        createdAt?: unknown;
      };
      if (inv.status !== "pending") continue;
      if (inv.expiresAt) {
        const expMs = Date.parse(tsToIso(inv.expiresAt));
        if (Number.isFinite(expMs) && expMs <= Date.now()) continue;
      } else if (inv.createdAt) {
        const createdMs = Date.parse(tsToIso(inv.createdAt));
        if (Number.isFinite(createdMs) && createdMs + INVITE_TTL_MS <= Date.now()) continue;
      }

      const memberRef = doc(db, "projects", inv.projectId, "members", user.uid);
      const memberSnap = await getDoc(memberRef);
      if (!memberSnap.exists()) {
        await setDoc(memberRef, {
          projectId: inv.projectId,
          projectOwnerId: inv.projectOwnerId,
          userId: user.uid,
          email,
          name: (user.displayName || email.split("@")[0] || "Investigador").slice(0, 120),
          role: inv.role,
          status: "active",
          inviteId: invDoc.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const projSnap = await getDoc(doc(db, "projects", inv.projectId));
      const pData = projSnap.exists()
        ? (projSnap.data() as { name: string; description: string; ownerId: string })
        : { name: inv.projectName, description: "", ownerId: inv.projectOwnerId };

      const batch = writeBatch(db);
      batch.update(doc(db, "projects", inv.projectId, "meta", "index"), {
        memberIds: arrayUnion(user.uid),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, "userProjects", user.uid, "items", inv.projectId), {
        projectId: inv.projectId,
        name: pData.name.slice(0, 160),
        description: (pData.description ?? "").slice(0, 1000),
        ownerId: pData.ownerId,
        role: inv.role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, "projectInvites", invDoc.id), {
        status: "accepted",
        acceptedUid: user.uid,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    }
  } catch {
    // Non-fatal if invite was already claimed, expired, or project removed
  }
}

export async function listProjects(user: User): Promise<Project[]> {
  await claimPendingInvites(user);
  const path = `userProjects/${user.uid}/items`;
  try {
    const snap = await getDocs(collection(db, "userProjects", user.uid, "items"));
    const results: Project[] = [];

    await Promise.all(
      snap.docs.map(async (itemDoc) => {
        const refData = itemDoc.data() as {
          projectId: string;
          name: string;
          description: string;
          ownerId: string;
          role: Role;
          createdAt: unknown;
        };
        const projectId = refData.projectId;
        try {
          const [projSnap, memberSnap] = await Promise.all([
            getDoc(doc(db, "projects", projectId)),
            getDoc(doc(db, "projects", projectId, "members", user.uid)),
          ]);
          const memberData = memberSnap.data() as { role?: Role; status?: string } | undefined;
          if (!projSnap.exists() || (!memberSnap.exists() && refData.ownerId !== user.uid) || memberData?.status === "suspended") {
            await deleteDoc(doc(db, "userProjects", user.uid, "items", projectId)).catch(() => {});
            return;
          }
          const pData = projSnap.data() as { name: string; description: string; ownerId: string; createdAt: unknown };
          const myRole: Role =
            pData.ownerId === user.uid
              ? "admin"
              : (memberData?.role ?? refData.role);
          const meta = await getMetaIndex(projectId);

          const flags = buildProjectRoleFlags(myRole);
          results.push({
            id: projectId,
            name: pData.name,
            description: pData.description ?? "",
            owner_id: pData.ownerId,
            members: [],
            my_role: myRole,
            created_at: tsToIso(pData.createdAt),
            dataset_count: myRole === "admin_tecnico" ? 0 : meta.datasetIds.length,
            form_count: myRole === "admin_tecnico" ? 0 : meta.formIds.length,
            record_count: myRole === "admin_tecnico" ? 0 : meta.crfRecordIds.length,
            analysis_count: myRole === "admin_tecnico" ? 0 : meta.analysisIds.length,
            ...flags,
          });
        } catch {
          // Skip inaccessible project
        }
      })
    );

    results.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return results;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createProject(name: string, description: string, user: User): Promise<Project> {
  ensureVerifiedUser(user);
  const projectId = makeId("proj");
  const cleanName = name.trim().slice(0, 160);
  const cleanDesc = description.trim().slice(0, 1000);
  if (!cleanName) throw new Error("El nombre del estudio es obligatorio.");
  const displayName = (user.displayName || user.email?.split("@")[0] || "Investigador").slice(0, 120);
  const email = (user.email || "").toLowerCase().slice(0, 200);

  try {
    await setDoc(doc(db, "projects", projectId), {
      name: cleanName,
      description: cleanDesc,
      ownerId: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const batch = writeBatch(db);
    batch.set(doc(db, "projects", projectId, "members", user.uid), {
      projectId,
      projectOwnerId: user.uid,
      userId: user.uid,
      email,
      name: displayName,
      role: "admin" satisfies Role,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "projects", projectId, "meta", "index"), {
      projectId,
      memberIds: [user.uid],
      datasetIds: [],
      formIds: [],
      inviteIds: [],
      crfRecordIds: [],
      crfVersionIds: [],
      vaultIds: [],
      consentIds: [],
      auditLogIds: [],
      lastAuditHash: "GENESIS",
      analysisIds: [],
      shardCounts: {},
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "userProjects", user.uid, "items", projectId), {
      projectId,
      name: cleanName,
      description: cleanDesc,
      ownerId: user.uid,
      role: "admin" satisfies Role,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    await appendAuditLog(projectId, {
      action: "STUDY_CREATE",
      resourceType: "project",
      resourceId: projectId,
      outcome: "SUCCESS",
      details: { name: cleanName },
    });

    return {
      id: projectId,
      name: cleanName,
      description: cleanDesc,
      owner_id: user.uid,
      members: [
        {
          user_id: user.uid,
          email,
          name: displayName,
          role: "admin",
          invited_at: new Date().toISOString(),
        },
      ],
      my_role: "admin",
      created_at: new Date().toISOString(),
      dataset_count: 0,
      form_count: 0,
      record_count: 0,
      analysis_count: 0,
      ...buildProjectRoleFlags("admin"),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `projects/${projectId}`);
  }
}

export async function getProject(projectId: string, user: User): Promise<Project> {
  const path = `projects/${projectId}`;
  try {
    const [projSnap, memberSnap, meta] = await Promise.all([
      getDoc(doc(db, "projects", projectId)),
      getDoc(doc(db, "projects", projectId, "members", user.uid)),
      getMetaIndex(projectId),
    ]);
    if (!projSnap.exists()) {
      throw new Error("Estudio no encontrado o sin acceso.");
    }
    const pData = projSnap.data() as { name: string; description: string; ownerId: string; createdAt: unknown };
    const memberData = memberSnap.data() as { role?: Role; status?: string } | undefined;
    const isOwner = pData.ownerId === user.uid;
    if (!isOwner && (!memberSnap.exists() || memberData?.status === "suspended")) {
      throw new Error("No tienes acceso a este estudio.");
    }
    const myRole: Role = isOwner
      ? "admin"
      : (memberData?.role ?? "capturador");

    return {
      id: projectId,
      name: pData.name,
      description: pData.description ?? "",
      owner_id: pData.ownerId,
      members: [],
      my_role: myRole,
      created_at: tsToIso(pData.createdAt),
      dataset_count: myRole === "admin_tecnico" ? 0 : meta.datasetIds.length,
      form_count: myRole === "admin_tecnico" ? 0 : meta.formIds.length,
      record_count: myRole === "admin_tecnico" ? 0 : meta.crfRecordIds.length,
      analysis_count: myRole === "admin_tecnico" ? 0 : meta.analysisIds.length,
      ...buildProjectRoleFlags(myRole),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function deleteProject(projectId: string, user: User): Promise<void> {
  ensureVerifiedUser(user);
  const path = `projects/${projectId}`;
  try {
    const meta = await getMetaIndex(projectId);
    const dsDocs = await Promise.all(meta.datasetIds.map((id) => getDoc(doc(db, "projects", projectId, "datasets", id))));
    for (const dsSnap of dsDocs) {
      if (!dsSnap.exists()) continue;
      const chunkCount = Number((dsSnap.data() as { chunkCount?: number }).chunkCount ?? 0);
      for (let i = 0; i < chunkCount; i++) {
        await deleteDoc(doc(db, "projects", projectId, "datasetChunks", `${dsSnap.id}_${i}`)).catch(() => {});
      }
      await deleteDoc(doc(db, "projects", projectId, "datasets", dsSnap.id)).catch(() => {});
    }
    const vaultSnaps = await Promise.all(
      meta.vaultIds.map((id) => getDoc(doc(db, "projects", projectId, "identityVault", id)).catch(() => null))
    );
    const blindHashes = vaultSnaps
      .filter((s): s is NonNullable<typeof s> => Boolean(s && s.exists()))
      .map((s) => (s.data() as { blindIndex?: string }).blindIndex)
      .filter((h): h is string => Boolean(h));

    const shardDeletes: Promise<void>[] = [];
    for (const kind of ALL_SHARD_KINDS) {
      const count = Number(meta.shardCounts[kind] ?? 0);
      for (let i = 0; i < count; i++) {
        shardDeletes.push(deleteDoc(doc(db, "projects", projectId, "meta", shardDocId(kind, i))).catch(() => {}));
      }
    }

    await Promise.all([
      ...meta.formIds.map((id) => deleteDoc(doc(db, "projects", projectId, "forms", id)).catch(() => {})),
      ...meta.crfRecordIds.map((id) => deleteDoc(doc(db, "projects", projectId, "crfRecords", id)).catch(() => {})),
      ...meta.vaultIds.map((id) => deleteDoc(doc(db, "projects", projectId, "identityVault", id)).catch(() => {})),
      ...meta.vaultIds.map((id) => deleteDoc(doc(db, "projects", projectId, "consentStates", id)).catch(() => {})),
      ...blindHashes.map((h) => deleteDoc(doc(db, "projects", projectId, "blindIndexes", h)).catch(() => {})),
      ...meta.consentIds.map((id) => deleteDoc(doc(db, "projects", projectId, "consentRecords", id)).catch(() => {})),
      ...meta.queryIds.map((id) => deleteDoc(doc(db, "projects", projectId, "queries", id)).catch(() => {})),
      ...meta.deviationIds.map((id) => deleteDoc(doc(db, "projects", projectId, "deviations", id)).catch(() => {})),
      ...meta.signatureIds.map((id) => deleteDoc(doc(db, "projects", projectId, "electronicSignatures", id)).catch(() => {})),
      ...meta.analysisIds.map((id) => deleteDoc(doc(db, "projects", projectId, "savedAnalyses", id)).catch(() => {})),
      ...meta.memberIds.map((id) => deleteDoc(doc(db, "projects", projectId, "memberIndexes", id)).catch(() => {})),
      ...meta.memberIds.map((id) => deleteDoc(doc(db, "projects", projectId, "members", id)).catch(() => {})),
      ...meta.inviteIds.map((id) => deleteDoc(doc(db, "projectInvites", id)).catch(() => {})),
      ...shardDeletes,
    ]);

    try {
      const invSnap = await getDocs(query(collection(db, "projectInvites"), where("projectOwnerId", "==", user.uid)));
      for (const d of invSnap.docs) {
        if ((d.data() as { projectId?: string }).projectId === projectId) {
          await deleteDoc(d.ref).catch(() => {});
        }
      }
    } catch {
      // ignore invite cleanup error
    }

    await deleteDoc(doc(db, "projects", projectId, "governance", "settings")).catch(() => {});
    await deleteDoc(doc(db, "projects", projectId, "governance", "lifecycle")).catch(() => {});
    await deleteDoc(doc(db, "projects", projectId, "meta", "index")).catch(() => {});
    await deleteDoc(doc(db, "projects", projectId));
    await deleteDoc(doc(db, "userProjects", user.uid, "items", projectId)).catch(() => {});
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function listProjectMembers(
  projectId: string,
  user: User
): Promise<{ owner_id: string; my_role: Role; members: ProjectMember[]; registered_users: UserRow[] }> {
  const path = `projects/${projectId}/members`;
  try {
    const [projSnap, meta] = await Promise.all([
      getDoc(doc(db, "projects", projectId)),
      getMetaIndex(projectId),
    ]);
    if (!projSnap.exists()) throw new Error("Estudio no encontrado.");
    const projData = projSnap.data() as { ownerId: string; name: string };
    const memberSnaps = await Promise.all(
      meta.memberIds.map((uid) => getDoc(doc(db, "projects", projectId, "members", uid)))
    );

    const members: ProjectMember[] = [];
    const activeEmails = new Set<string>();
    let myRole: Role = projData.ownerId === user.uid ? "admin" : "capturador";

    for (const s of memberSnaps) {
      if (!s.exists()) continue;
      const d = s.data() as { userId: string; email: string; name: string; role: Role; createdAt: unknown };
      activeEmails.add(d.email.toLowerCase());
      if (d.userId === user.uid) myRole = d.role;
      members.push({
        user_id: d.userId,
        email: d.email,
        name: d.name,
        role: d.role,
        invited_at: tsToIso(d.createdAt),
        pending: false,
      });
    }

    if (myRole === "admin") {
      try {
        const seenInviteIds = new Set<string>();
        const pushInviteDoc = (
          invId: string,
          inv: {
            projectId: string;
            email: string;
            name: string;
            role: Role;
            status: string;
            createdAt: unknown;
          }
        ) => {
          if (seenInviteIds.has(invId)) return;
          seenInviteIds.add(invId);
          if (inv.projectId !== projectId || inv.status !== "pending") return;
          if (activeEmails.has(inv.email.toLowerCase())) return;
          members.push({
            user_id: null,
            email: inv.email,
            name: inv.name,
            role: inv.role,
            invited_at: tsToIso(inv.createdAt),
            pending: true,
            invite_id: invId,
          });
        };

        if (meta.inviteIds.length > 0) {
          const invDocSnaps = await Promise.all(
            meta.inviteIds.map((id) => getDoc(doc(db, "projectInvites", id)).catch(() => null))
          );
          for (const s of invDocSnaps) {
            if (!s || !s.exists()) continue;
            pushInviteDoc(s.id, s.data() as Parameters<typeof pushInviteDoc>[1]);
          }
        }

        if (projData.ownerId === user.uid) {
          const invSnap = await getDocs(
            query(collection(db, "projectInvites"), where("projectOwnerId", "==", user.uid))
          );
          for (const d of invSnap.docs) {
            pushInviteDoc(d.id, d.data() as Parameters<typeof pushInviteDoc>[1]);
          }
        }
      } catch {
        // ignore if no invites
      }
    }

    return {
      owner_id: projData.ownerId,
      my_role: myRole,
      members,
      registered_users: [],
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function inviteProjectMember(
  projectId: string,
  email: string,
  role: Role,
  user: User
): Promise<ProjectMember> {
  ensureVerifiedUser(user);
  const cleanEmail = email.trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error("Introduce un correo electrónico válido.");
  }
  const inviteId = `${projectId}_${safeDocKey(cleanEmail)}`.slice(0, 128);
  const path = `projectInvites/${inviteId}`;
  try {
    const projSnap = await getDoc(doc(db, "projects", projectId));
    if (!projSnap.exists()) throw new Error("Estudio no encontrado.");
    const pData = projSnap.data() as { name: string; ownerId: string };
    const existingInvite = await getDoc(doc(db, "projectInvites", inviteId));
    const displayName = cleanEmail.split("@")[0].slice(0, 120);

    const expiresAt = Timestamp.fromDate(new Date(Date.now() + INVITE_TTL_MS));
    if (existingInvite.exists()) {
      await updateDoc(doc(db, "projectInvites", inviteId), {
        role,
        name: displayName,
        projectName: pData.name.slice(0, 160),
        expiresAt,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, "projectInvites", inviteId), {
        projectId,
        projectName: pData.name.slice(0, 160),
        projectOwnerId: pData.ownerId,
        invitedByUid: user.uid,
        email: cleanEmail,
        name: displayName,
        role,
        status: "pending",
        expiresAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await updateDoc(doc(db, "projects", projectId, "meta", "index"), {
      inviteIds: arrayUnion(inviteId),
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    await appendAuditLog(
      projectId,
      {
        action: "MEMBER_INVITED",
        resourceType: "invite",
        resourceId: inviteId,
        outcome: "SUCCESS",
        details: { email: cleanEmail, role },
      },
      { strict: true }
    );

    return {
      user_id: null,
      email: cleanEmail,
      name: displayName,
      role,
      invited_at: new Date().toISOString(),
      pending: true,
      invite_id: inviteId,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateMemberRole(
  projectId: string,
  member: ProjectMember,
  nextRole: Role,
  user: User
): Promise<ProjectMember> {
  ensureVerifiedUser(user);
  if (member.user_id) {
    const path = `projects/${projectId}/members/${member.user_id}`;
    try {
      await updateDoc(doc(db, "projects", projectId, "members", member.user_id), {
        role: nextRole,
        name: member.name.slice(0, 120),
        updatedAt: serverTimestamp(),
      });
      await appendAuditLog(
        projectId,
        {
          action: "MEMBER_ROLE_CHANGED",
          resourceType: "member",
          resourceId: member.user_id,
          outcome: "SUCCESS",
          details: { previousRole: member.role, nextRole },
        },
        { strict: true }
      );
      return { ...member, role: nextRole };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else if (member.invite_id) {
    const path = `projectInvites/${member.invite_id}`;
    try {
      await updateDoc(doc(db, "projectInvites", member.invite_id), {
        role: nextRole,
        updatedAt: serverTimestamp(),
      });
      return { ...member, role: nextRole };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
  throw new Error("Miembro no encontrado.");
}

export async function removeProjectMember(projectId: string, member: ProjectMember, user: User): Promise<void> {
  ensureVerifiedUser(user);
  if (member.user_id) {
    const path = `projects/${projectId}/members/${member.user_id}`;
    try {
      const invId = member.invite_id || `${projectId}_${safeDocKey(member.email)}`.slice(0, 128);
      await deleteDoc(doc(db, "projects", projectId, "members", member.user_id));
      await deleteDoc(doc(db, "projects", projectId, "memberIndexes", member.user_id)).catch(() => {});
      await updateDoc(doc(db, "projects", projectId, "meta", "index"), {
        memberIds: arrayRemove(member.user_id),
        inviteIds: arrayRemove(invId),
        updatedAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, "projectInvites", invId)).catch(() => {});
      await appendAuditLog(
        projectId,
        {
          action: "MEMBER_REMOVED",
          resourceType: "member",
          resourceId: member.user_id,
          outcome: "SUCCESS",
        },
        { strict: true }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
    return;
  }
  if (member.invite_id) {
    const path = `projectInvites/${member.invite_id}`;
    try {
      await deleteDoc(doc(db, "projectInvites", member.invite_id));
      await updateDoc(doc(db, "projects", projectId, "meta", "index"), {
        inviteIds: arrayRemove(member.invite_id),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }
}

export async function listDatasets(projectId: string): Promise<Dataset[]> {
  const path = `projects/${projectId}/datasets`;
  try {
    const meta = await getMetaIndex(projectId);
    const [dsSnaps, crfSnaps] = await Promise.all([
      Promise.all(meta.datasetIds.map((id) => getDoc(doc(db, "projects", projectId, "datasets", id)))),
      Promise.all(meta.crfRecordIds.map((id) => getDoc(doc(db, "projects", projectId, "crfRecords", id)))),
    ]);

    const crfCounts = new Map<string, number>();
    for (const r of crfSnaps) {
      if (!r.exists()) continue;
      const dsId = (r.data() as { datasetId: string }).datasetId;
      crfCounts.set(dsId, (crfCounts.get(dsId) ?? 0) + 1);
    }

    const list: Dataset[] = [];
    for (const s of dsSnaps) {
      if (!s.exists()) continue;
      const d = s.data() as {
        projectId: string;
        name: string;
        source: "upload" | "form";
        formId?: string | null;
        variables: Variable[];
        nRows: number;
        chunkCount: number;
        createdAt: unknown;
      };
      const crfCount = crfCounts.get(s.id) ?? 0;
      let nRows = d.nRows ?? 0;
      if (d.source === "form") {
        nRows = d.formId ? crfCount : (d.nRows ?? 0);
      } else if ((d.chunkCount ?? 0) > 0 && (crfCount > 0 || d.formId)) {
        const chunkSnaps = await Promise.all(
          Array.from({ length: d.chunkCount ?? 0 }, (_, i) =>
            getDoc(doc(db, "projects", projectId, "datasetChunks", `${s.id}_${i}`)).catch(() => null)
          )
        );
        let chunkRowsTotal = 0;
        for (const cs of chunkSnaps) {
          if (cs && cs.exists()) {
            chunkRowsTotal += ((cs.data() as { rows?: unknown[] }).rows ?? []).length;
          }
        }
        nRows = chunkRowsTotal + crfCount;
      }

      list.push({
        id: s.id,
        project_id: d.projectId,
        name: d.name,
        source: d.source,
        form_id: d.formId ?? null,
        variables: Array.isArray(d.variables) ? d.variables : [],
        n_rows: nRows,
        chunk_count: d.chunkCount ?? 0,
        created_at: tsToIso(d.createdAt),
      });
    }
    list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getDatasetSummary(projectId: string, datasetId: string): Promise<Dataset | null> {
  const path = `projects/${projectId}/datasets/${datasetId}`;
  try {
    const snap = await getDoc(doc(db, "projects", projectId, "datasets", datasetId));
    if (!snap.exists()) return null;
    const d = snap.data() as {
      projectId: string;
      name: string;
      source: "upload" | "form";
      formId?: string | null;
      variables: Variable[];
      nRows: number;
      chunkCount: number;
      createdAt: unknown;
    };
    return {
      id: snap.id,
      project_id: d.projectId,
      name: d.name,
      source: d.source,
      form_id: d.formId ?? null,
      variables: Array.isArray(d.variables) ? d.variables : [],
      n_rows: d.nRows ?? 0,
      chunk_count: d.chunkCount ?? 0,
      created_at: tsToIso(d.createdAt),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function uploadDataset(
  projectId: string,
  projectOwnerId: string,
  filename: string,
  contentBase64: string,
  user: User
): Promise<Dataset & { auto_form?: Form; identifier_columns?: string[]; pii_warnings?: string[] }> {
  ensureVerifiedUser(user);
  const parsed = await apiPost<{
    variables: Variable[];
    rows: Record<string, Cell>[];
    identifierColumns?: string[];
    piiWarnings?: string[];
  }>("/parse-tabular", {
    projectId,
    filename,
    contentBase64,
  });

  const datasetId = makeId("ds");
  const cleanName = filename.replace(/\.(csv|xlsx|xls|txt)$/i, "").slice(0, 160) || "Base de datos";
  const chunkCount = Math.ceil(parsed.rows.length / CHUNK_SIZE);
  const fields = buildFormFieldsFromVariables(parsed.variables, parsed.rows);
  const formId = fields.length > 0 ? makeId("frm") : null;
  const formDescription = `Formulario generado automáticamente al importar «${filename.slice(0, 120)}» (${parsed.rows.length} registros iniciales).`.slice(0, 1000);
  const path = `projects/${projectId}/datasets/${datasetId}`;

  try {
    await setDoc(doc(db, "projects", projectId, "datasets", datasetId), {
      projectId,
      projectOwnerId,
      name: cleanName,
      source: "upload",
      formId,
      variables: parsed.variables,
      nRows: parsed.rows.length,
      chunkCount,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (let i = 0; i < chunkCount; i++) {
      const slice = parsed.rows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await setDoc(doc(db, "projects", projectId, "datasetChunks", `${datasetId}_${i}`), {
        projectId,
        datasetId,
        chunkIndex: i,
        rows: slice,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
    }

    let autoForm: Form | undefined;
    if (formId) {
      await setDoc(doc(db, "projects", projectId, "forms", formId), {
        projectId,
        projectOwnerId,
        datasetId,
        name: cleanName,
        description: formDescription,
        fields,
        formVersion: 1,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      autoForm = {
        id: formId,
        project_id: projectId,
        dataset_id: datasetId,
        name: cleanName,
        description: formDescription,
        fields,
        form_version: 1,
        created_at: new Date().toISOString(),
        record_count: 0,
      };
    }

    await updateDoc(doc(db, "projects", projectId, "meta", "index"), {
      datasetIds: arrayUnion(datasetId),
      ...(formId ? { formIds: arrayUnion(formId) } : {}),
      updatedAt: serverTimestamp(),
    });

    await appendAuditLog(
      projectId,
      {
        action: "DATASET_UPLOAD",
        resourceType: "dataset",
        resourceId: datasetId,
        outcome: "SUCCESS",
        details: {
          name: cleanName,
          rowCount: parsed.rows.length,
          variableCount: parsed.variables.length,
          autoFormId: formId,
        },
      },
      { strict: true }
    );

    return {
      id: datasetId,
      project_id: projectId,
      name: cleanName,
      source: "upload",
      form_id: formId,
      variables: parsed.variables,
      n_rows: parsed.rows.length,
      chunk_count: chunkCount,
      created_at: new Date().toISOString(),
      auto_form: autoForm,
      identifier_columns: parsed.identifierColumns ?? [],
      pii_warnings: parsed.piiWarnings ?? [],
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createFormFromDataset(
  projectId: string,
  projectOwnerId: string,
  dataset: Dataset,
  user: User
): Promise<Form> {
  ensureVerifiedUser(user);
  if (dataset.form_id) {
    return getForm(projectId, dataset.form_id);
  }
  const path = `projects/${projectId}/forms`;
  try {
    const full = await getDatasetWithRows(projectId, dataset);
    const fields = buildFormFieldsFromVariables(full.dataset.variables, full.rows);
    if (!fields.length) {
      throw new Error("Esta base de datos no contiene columnas válidas para crear un formulario.");
    }
    const formId = makeId("frm");
    const name = dataset.name.trim().slice(0, 160) || "Formulario de cohorte";
    const description = `Formulario generado automáticamente desde «${name}» (${full.rows.length} registros iniciales).`.slice(0, 1000);

    let ownerId = projectOwnerId;
    if (!ownerId) {
      const projSnap = await getDoc(doc(db, "projects", projectId));
      if (!projSnap.exists()) throw new Error("Estudio no encontrado.");
      ownerId = (projSnap.data() as { ownerId: string }).ownerId;
    }

    const batch = writeBatch(db);
    batch.set(doc(db, "projects", projectId, "forms", formId), {
      projectId,
      projectOwnerId: ownerId,
      datasetId: dataset.id,
      name,
      description,
      fields,
      formVersion: 1,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "projects", projectId, "datasets", dataset.id), {
      formId,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "projects", projectId, "meta", "index"), {
      formIds: arrayUnion(formId),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    await appendAuditLog(
      projectId,
      {
        action: "FORM_CREATE",
        resourceType: "form",
        resourceId: formId,
        outcome: "SUCCESS",
        details: { datasetId: dataset.id, fieldCount: fields.length, origin: "from_dataset" },
      },
      { strict: true }
    );

    return {
      id: formId,
      project_id: projectId,
      dataset_id: dataset.id,
      name,
      description,
      fields,
      form_version: 1,
      created_at: new Date().toISOString(),
      record_count: 0,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getDatasetWithRows(
  projectId: string,
  dataset: Dataset
): Promise<{ dataset: Dataset; rows: Record<string, Cell>[]; rowItems: DatasetRowItem[] }> {
  const path = `projects/${projectId}/datasets/${dataset.id}`;
  try {
    const [dsSnap, meta] = await Promise.all([
      getDoc(doc(db, "projects", projectId, "datasets", dataset.id)),
      getMetaIndex(projectId),
    ]);
    const chunkCount = dsSnap.exists()
      ? Number((dsSnap.data() as { chunkCount?: number }).chunkCount ?? dataset.chunk_count ?? 0)
      : Number(dataset.chunk_count ?? 0);

    const items: DatasetRowItem[] = [];
    let seq = 0;

    if (chunkCount > 0) {
      const chunkSnaps = await Promise.all(
        Array.from({ length: chunkCount }, (_, i) =>
          getDoc(doc(db, "projects", projectId, "datasetChunks", `${dataset.id}_${i}`))
        )
      );
      chunkSnaps.forEach((snap, chunkIdx) => {
        if (!snap.exists()) return;
        const chunkRows = (snap.data() as { rows?: Record<string, Cell>[] }).rows ?? [];
        chunkRows.forEach((r, idxInChunk) => {
          items.push({
            row_id: `${chunkIdx}:${idxInChunk}`,
            seq: seq++,
            data: r,
            source: "chunk",
          });
        });
      });
    }

    if (meta.crfRecordIds.length > 0 && (dataset.form_id || dataset.source === "upload" || chunkCount === 0)) {
      const recSnaps = await Promise.all(
        meta.crfRecordIds.map((id) => getDoc(doc(db, "projects", projectId, "crfRecords", id)).catch(() => null))
      );
      const crfEntries: Array<{
        id: string;
        rawSeq: number;
        status?: CrfRecordStatus;
        subjectPseudoId?: string | null;
        data: Record<string, Cell>;
        createdBy: string;
        createdAt: string;
      }> = [];
      for (const s of recSnaps) {
        if (!s || !s.exists()) continue;
        const d = s.data() as {
          datasetId: string;
          seq: number;
          status?: CrfRecordStatus;
          subjectPseudoId?: string | null;
          data: Record<string, Cell>;
          createdBy: string;
          createdAt: unknown;
        };
        if (d.datasetId !== dataset.id) continue;
        crfEntries.push({
          id: s.id,
          rawSeq: d.seq ?? 0,
          status: d.status ?? "borrador",
          subjectPseudoId: d.subjectPseudoId ?? null,
          data: d.data ?? {},
          createdBy: d.createdBy,
          createdAt: tsToIso(d.createdAt),
        });
      }
      crfEntries.sort((a, b) => a.rawSeq - b.rawSeq || a.createdAt.localeCompare(b.createdAt));
      for (const entry of crfEntries) {
        items.push({
          row_id: entry.id,
          seq: seq++,
          data: entry.data,
          source: "crf",
          status: entry.status,
          subject_pseudo_id: entry.subjectPseudoId,
          created_by: entry.createdBy,
          created_at: entry.createdAt,
        });
      }
    }

    const rows = items.map((it) => it.data);
    const hasCrfRows = Boolean(dataset.form_id) || items.some((it) => it.source === "crf");
    const refreshedVars = hasCrfRows ? recomputeVarLevels(dataset.variables, rows) : dataset.variables;
    return {
      dataset: {
        ...dataset,
        n_rows: rows.length,
        chunk_count: chunkCount,
        variables: refreshedVars,
      },
      rows,
      rowItems: items,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function updateDatasetVariableType(
  projectId: string,
  dataset: Dataset,
  varName: string,
  newType: VarType,
  user: User
): Promise<Dataset> {
  ensureVerifiedUser(user);
  const path = `projects/${projectId}/datasets/${dataset.id}`;
  try {
    const { rows } = await getDatasetWithRows(projectId, dataset);
    const updatedVars = recomputeVarLevels(
      dataset.variables.map((v) => (v.name === varName ? { ...v, type: newType } : v)),
      rows
    );
    await updateDoc(doc(db, "projects", projectId, "datasets", dataset.id), {
      variables: updatedVars,
      updatedAt: serverTimestamp(),
    });
    await appendAuditLog(
      projectId,
      {
        action: "DATASET_SCHEMA_UPDATE",
        resourceType: "dataset",
        resourceId: dataset.id,
        outcome: "SUCCESS",
        details: { varName, newType },
      },
      { strict: true }
    );
    return { ...dataset, variables: updatedVars };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateDatasetRow(
  projectId: string,
  dataset: Dataset,
  rowItem: DatasetRowItem,
  nextData: Record<string, Cell>,
  user: User,
  reason = "Corrección desde matriz de datos"
): Promise<void> {
  ensureVerifiedUser(user);
  const cleanReason = reason.trim();
  if (cleanReason.length < 5) {
    throw new Error("Indica un motivo de modificación (mínimo 5 caracteres) para conservar la trazabilidad.");
  }
  await assertStudyOpenForCapture(projectId);

  if (rowItem.source === "crf") {
    const path = `projects/${projectId}/crfRecords/${rowItem.row_id}`;
    try {
      const recSnap = await getDoc(doc(db, "projects", projectId, "crfRecords", rowItem.row_id));
      if (!recSnap.exists()) throw new Error("Registro CRF no encontrado.");
      const prevDoc = recSnap.data() as {
        status?: CrfRecordStatus;
        version?: number;
        formVersion?: number;
        data?: Record<string, Cell>;
      };
      const currStatus: CrfRecordStatus = prevDoc.status ?? "borrador";
      if (currStatus === "verificado" || currStatus === "bloqueado") {
        throw new Error(
          `Este registro está en estado «${currStatus}» y no puede editarse directamente. Un coordinador o IP debe reabrirlo primero con motivo.`
        );
      }
      const nextVersion = Number(prevDoc.version ?? 1) + 1;
      const versionId = makeId("ver");
      const actorName = (user.displayName || user.email?.split("@")[0] || "Usuario").slice(0, 120);

      const batch = writeBatch(db);
      batch.update(doc(db, "projects", projectId, "crfRecords", rowItem.row_id), {
        data: nextData,
        version: nextVersion,
        lastChangeReason: cleanReason.slice(0, 500),
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, "projects", projectId, "crfVersions", versionId), {
        projectId,
        recordId: rowItem.row_id,
        version: nextVersion,
        ...(prevDoc.formVersion ? { formVersion: prevDoc.formVersion } : {}),
        previousStatus: currStatus,
        newStatus: currStatus,
        previousData: prevDoc.data ?? {},
        newData: nextData,
        changedBy: user.uid,
        changedByName: actorName,
        changedAt: serverTimestamp(),
        reason: cleanReason.slice(0, 500),
      });
      await batch.commit();
      await appendIdsToMetaShards(projectId, { crfVersionIds: versionId });

      await appendAuditLog(
        projectId,
        {
          action: "RECORD_UPDATE",
          resourceType: "crfRecord",
          resourceId: rowItem.row_id,
          outcome: "SUCCESS",
          reason: cleanReason,
          details: { version: nextVersion, via: "data_table" },
        },
        { strict: true }
      );

      const { rows } = await getDatasetWithRows(projectId, dataset);
      const updatedVars = recomputeVarLevels(dataset.variables, rows);
      await updateDoc(doc(db, "projects", projectId, "datasets", dataset.id), {
        variables: updatedVars,
        nRows: rows.length,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
    return;
  }

  const [chunkStr, idxStr] = rowItem.row_id.split(":");
  const chunkIdx = Number(chunkStr);
  const idxInChunk = Number(idxStr);
  const chunkId = `${dataset.id}_${chunkIdx}`;
  const path = `projects/${projectId}/datasetChunks/${chunkId}`;
  try {
    const snap = await getDoc(doc(db, "projects", projectId, "datasetChunks", chunkId));
    if (!snap.exists()) throw new Error("Bloque de datos no encontrado.");
    const rows = [...((snap.data() as { rows?: Record<string, Cell>[] }).rows ?? [])];
    const previousData = rows[idxInChunk] ?? {};
    rows[idxInChunk] = nextData;
    await updateDoc(doc(db, "projects", projectId, "datasetChunks", chunkId), {
      rows,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    await appendAuditLog(
      projectId,
      {
        action: "RECORD_UPDATE",
        resourceType: "datasetChunkRow",
        resourceId: `${dataset.id}:${rowItem.row_id}`,
        outcome: "SUCCESS",
        reason: cleanReason,
        details: {
          datasetId: dataset.id,
          rowId: rowItem.row_id,
          previousData,
          newData: nextData,
        },
      },
      { strict: true }
    );
    const all = await getDatasetWithRows(projectId, dataset);
    const updatedVars = recomputeVarLevels(dataset.variables, all.rows);
    await updateDoc(doc(db, "projects", projectId, "datasets", dataset.id), {
      variables: updatedVars,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function exportDatasetControlled(
  projectId: string,
  dataset: Dataset,
  rows: Record<string, Cell>[],
  reason: string,
  includeIdentifiers = false
): Promise<{
  filename: string;
  csvContent: string;
  sha256: string;
  strippedColumns: string[];
  rowCount: number;
  columnCount: number;
}> {
  const res = await apiPost<{
    filename: string;
    csvContent: string;
    sha256: string;
    strippedColumns: string[];
    rowCount: number;
    columnCount: number;
  }>("/exports/dataset", {
    projectId,
    dataset,
    rows,
    reason,
    includeIdentifiers,
  });

  await appendAuditLog(
    projectId,
    {
      action: "EXPORT_DATA",
      resourceType: "dataset",
      resourceId: dataset.id,
      outcome: "SUCCESS",
      reason,
      details: {
        rowCount: res.rowCount,
        strippedColumns: res.strippedColumns,
        sha256: res.sha256,
      },
    },
    { strict: true }
  );

  return res;
}

export async function deleteDataset(projectId: string, dataset: Dataset, user: User): Promise<void> {
  ensureVerifiedUser(user);
  if (dataset.form_id) {
    throw new Error("Esta base está vinculada a un formulario CRF; elimina primero el formulario para retirarla.");
  }
  const path = `projects/${projectId}/datasets/${dataset.id}`;
  try {
    const chunkCount = Number(dataset.chunk_count ?? 0);
    for (let i = 0; i < chunkCount; i++) {
      await deleteDoc(doc(db, "projects", projectId, "datasetChunks", `${dataset.id}_${i}`)).catch(() => {});
    }

    const meta = await getMetaIndex(projectId);
    const toRemoveRecIds: string[] = [];
    if (meta.crfRecordIds.length > 0) {
      const recSnaps = await Promise.all(
        meta.crfRecordIds.map((id) => getDoc(doc(db, "projects", projectId, "crfRecords", id)).catch(() => null))
      );
      for (const rs of recSnaps) {
        if (rs && rs.exists() && (rs.data() as { datasetId?: string }).datasetId === dataset.id) {
          toRemoveRecIds.push(rs.id);
          await deleteDoc(rs.ref).catch(() => {});
        }
      }
    }

    await deleteDoc(doc(db, "projects", projectId, "datasets", dataset.id));
    await removeIdsFromMetaShards(projectId, "crfRecordIds", toRemoveRecIds, {
      datasetIds: arrayRemove(dataset.id),
    });
    await appendAuditLog(
      projectId,
      {
        action: "DATASET_DELETE",
        resourceType: "dataset",
        resourceId: dataset.id,
        outcome: "SUCCESS",
        details: { name: dataset.name },
      },
      { strict: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function listForms(projectId: string): Promise<Form[]> {
  const path = `projects/${projectId}/forms`;
  try {
    const meta = await getMetaIndex(projectId);
    const [formSnaps, recSnaps] = await Promise.all([
      Promise.all(meta.formIds.map((id) => getDoc(doc(db, "projects", projectId, "forms", id)))),
      Promise.all(meta.crfRecordIds.map((id) => getDoc(doc(db, "projects", projectId, "crfRecords", id)))).catch(() => []),
    ]);

    const counts = new Map<string, number>();
    for (const rs of recSnaps) {
      if (!rs.exists()) continue;
      const fid = (rs.data() as { formId: string }).formId;
      counts.set(fid, (counts.get(fid) ?? 0) + 1);
    }

    const forms: Form[] = [];
    for (const s of formSnaps) {
      if (!s.exists()) continue;
      const d = s.data() as {
        projectId: string;
        datasetId: string;
        name: string;
        description: string;
        fields: FormField[];
        formVersion?: number;
        createdAt: unknown;
      };
      forms.push({
        id: s.id,
        project_id: d.projectId,
        dataset_id: d.datasetId,
        name: d.name,
        description: d.description ?? "",
        fields: Array.isArray(d.fields) ? d.fields : [],
        form_version: Number(d.formVersion ?? 1),
        created_at: tsToIso(d.createdAt),
        record_count: counts.get(s.id) ?? 0,
      });
    }
    forms.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return forms;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function findFormProjectId(formId: string, user: User): Promise<string | null> {
  const snap = await getDocs(collection(db, "userProjects", user.uid, "items"));
  for (const item of snap.docs) {
    const pid = item.id;
    try {
      const fSnap = await getDoc(doc(db, "projects", pid, "forms", formId));
      if (fSnap.exists()) return pid;
    } catch {
      // continue searching
    }
  }
  return null;
}

export async function getForm(projectId: string, formId: string): Promise<Form> {
  const path = `projects/${projectId}/forms/${formId}`;
  try {
    const [fSnap, meta] = await Promise.all([
      getDoc(doc(db, "projects", projectId, "forms", formId)),
      getMetaIndex(projectId),
    ]);
    if (!fSnap.exists()) throw new Error("Formulario CRF no encontrado.");
    const d = fSnap.data() as {
      projectId: string;
      datasetId: string;
      name: string;
      description: string;
      fields: FormField[];
      formVersion?: number;
      createdAt: unknown;
    };
    let count = 0;
    const recSnaps = await Promise.all(
      meta.crfRecordIds.map((id) => getDoc(doc(db, "projects", projectId, "crfRecords", id)).catch(() => null))
    );
    for (const rs of recSnaps) {
      if (rs && rs.exists() && (rs.data() as { formId: string }).formId === formId) {
        count += 1;
      }
    }
    return {
      id: fSnap.id,
      project_id: d.projectId,
      dataset_id: d.datasetId,
      name: d.name,
      description: d.description ?? "",
      fields: Array.isArray(d.fields) ? d.fields : [],
      form_version: Number(d.formVersion ?? 1),
      created_at: tsToIso(d.createdAt),
      record_count: count,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function createForm(projectId: string, input: FormIn, user: User): Promise<Form> {
  ensureVerifiedUser(user);
  const name = input.name.trim().slice(0, 160);
  const description = input.description.trim().slice(0, 1000);
  if (!name || !input.fields.length) {
    throw new Error("El formulario requiere un título y al menos un campo clínico.");
  }

  const formId = makeId("frm");
  const datasetId = makeId("ds");
  const path = `projects/${projectId}/forms/${formId}`;

  try {
    const projSnap = await getDoc(doc(db, "projects", projectId));
    if (!projSnap.exists()) throw new Error("Estudio no encontrado.");
    const ownerId = (projSnap.data() as { ownerId: string }).ownerId;
    const vars = buildFormVariables(input.fields);

    // Create dataset first so firestore.rules exists(datasets/$(datasetId)) passes for the linked form
    await setDoc(doc(db, "projects", projectId, "datasets", datasetId), {
      projectId,
      projectOwnerId: ownerId,
      name: `Formulario · ${name}`.slice(0, 160),
      source: "form",
      formId,
      variables: vars,
      nRows: 0,
      chunkCount: 0,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const batch = writeBatch(db);
    batch.set(doc(db, "projects", projectId, "forms", formId), {
      projectId,
      projectOwnerId: ownerId,
      datasetId,
      name,
      description,
      fields: input.fields,
      formVersion: 1,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "projects", projectId, "meta", "index"), {
      datasetIds: arrayUnion(datasetId),
      formIds: arrayUnion(formId),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    await appendAuditLog(
      projectId,
      {
        action: "FORM_CREATE",
        resourceType: "form",
        resourceId: formId,
        outcome: "SUCCESS",
        details: { name, fieldCount: input.fields.length, datasetId },
      },
      { strict: true }
    );

    return {
      id: formId,
      project_id: projectId,
      dataset_id: datasetId,
      name,
      description,
      fields: input.fields,
      form_version: 1,
      created_at: new Date().toISOString(),
      record_count: 0,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateForm(projectId: string, formId: string, input: FormIn, user: User): Promise<Form> {
  ensureVerifiedUser(user);
  const name = input.name.trim().slice(0, 160);
  const description = input.description.trim().slice(0, 1000);
  if (!name || !input.fields.length) {
    throw new Error("El formulario requiere título y al menos un campo.");
  }
  const path = `projects/${projectId}/forms/${formId}`;
  try {
    const existing = await getForm(projectId, formId);
    const nextFormVersion = Number(existing.form_version ?? 1) + 1;
    await updateDoc(doc(db, "projects", projectId, "forms", formId), {
      name,
      description,
      fields: input.fields,
      formVersion: nextFormVersion,
      updatedAt: serverTimestamp(),
    });

    const dsSnap = await getDoc(doc(db, "projects", projectId, "datasets", existing.dataset_id));
    if (dsSnap.exists()) {
      const dsData = dsSnap.data() as {
        name: string;
        source: "upload" | "form";
        variables?: Variable[];
        nRows?: number;
        chunkCount?: number;
        createdAt?: unknown;
      };
      const formVars = buildFormVariables(input.fields);
      if (dsData.source === "upload") {
        const formVarMap = new Map(formVars.map((v) => [v.name, v]));
        const preservedExisting = (dsData.variables ?? []).filter((v) => !formVarMap.has(v.name));
        const mergedVars = [...formVars, ...preservedExisting];
        const dsObj: Dataset = {
          id: existing.dataset_id,
          project_id: projectId,
          name: dsData.name,
          source: "upload",
          form_id: formId,
          variables: mergedVars,
          n_rows: dsData.nRows ?? 0,
          chunk_count: dsData.chunkCount ?? 0,
          created_at: tsToIso(dsData.createdAt),
        };
        const full = await getDatasetWithRows(projectId, dsObj);
        await updateDoc(doc(db, "projects", projectId, "datasets", existing.dataset_id), {
          variables: full.dataset.variables,
          nRows: full.rows.length,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, "projects", projectId, "datasets", existing.dataset_id), {
          name: `Formulario · ${name}`.slice(0, 160),
          variables: formVars,
          updatedAt: serverTimestamp(),
        });
      }
    }

    await appendAuditLog(
      projectId,
      {
        action: "FORM_UPDATE",
        resourceType: "form",
        resourceId: formId,
        outcome: "SUCCESS",
        details: { name, formVersion: nextFormVersion, fieldCount: input.fields.length },
      },
      { strict: true }
    );

    return { ...existing, name, description, fields: input.fields, form_version: nextFormVersion };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteForm(projectId: string, form: Form, user: User): Promise<void> {
  ensureVerifiedUser(user);
  const path = `projects/${projectId}/forms/${form.id}`;
  try {
    const dsSnap = await getDoc(doc(db, "projects", projectId, "datasets", form.dataset_id)).catch(() => null);
    const isUploadDataset = Boolean(
      dsSnap && dsSnap.exists() && (dsSnap.data() as { source?: string }).source === "upload"
    );

    if (isUploadDataset) {
      await deleteDoc(doc(db, "projects", projectId, "forms", form.id));
      await updateDoc(doc(db, "projects", projectId, "datasets", form.dataset_id), {
        formId: null,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "projects", projectId, "meta", "index"), {
        formIds: arrayRemove(form.id),
        updatedAt: serverTimestamp(),
      });
      await appendAuditLog(
        projectId,
        {
          action: "FORM_DELETE",
          resourceType: "form",
          resourceId: form.id,
          outcome: "SUCCESS",
          details: { name: form.name, keptUploadDatasetId: form.dataset_id },
        },
        { strict: true }
      );
      return;
    }

    const meta = await getMetaIndex(projectId);
    const recSnaps = await Promise.all(
      meta.crfRecordIds.map((id) => getDoc(doc(db, "projects", projectId, "crfRecords", id)).catch(() => null))
    );
    const toRemoveRecIds: string[] = [];
    for (const rs of recSnaps) {
      if (rs && rs.exists() && (rs.data() as { formId: string }).formId === form.id) {
        toRemoveRecIds.push(rs.id);
        await deleteDoc(rs.ref).catch(() => {});
      }
    }

    await deleteDoc(doc(db, "projects", projectId, "forms", form.id));
    await deleteDoc(doc(db, "projects", projectId, "datasets", form.dataset_id)).catch(() => {});
    await removeIdsFromMetaShards(projectId, "crfRecordIds", toRemoveRecIds, {
      formIds: arrayRemove(form.id),
      datasetIds: arrayRemove(form.dataset_id),
    });
    await appendAuditLog(
      projectId,
      {
        action: "FORM_DELETE",
        resourceType: "form",
        resourceId: form.id,
        outcome: "SUCCESS",
        details: { name: form.name, removedRecords: toRemoveRecIds.length },
      },
      { strict: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function listConsents(projectId: string): Promise<ConsentRecord[]> {
  const path = `projects/${projectId}/consentRecords`;
  try {
    const meta = await getMetaIndex(projectId);
    if (!meta.consentIds.length) return [];
    const snaps = await Promise.all(
      meta.consentIds.map((id) => getDoc(doc(db, "projects", projectId, "consentRecords", id)).catch(() => null))
    );
    const items: ConsentRecord[] = [];
    for (const s of snaps) {
      if (!s || !s.exists()) continue;
      const d = s.data() as {
        projectId: string;
        subjectPseudoId: string;
        protocolVersion: string;
        documentTitle: string;
        method: ConsentMethod;
        status: ConsentStatus;
        signedAt: string;
        withdrawnAt?: string | null;
        withdrawalReason?: string;
        recordedBy: string;
        recordedByName: string;
        createdAt: unknown;
        updatedAt: unknown;
      };
      items.push({
        id: s.id,
        project_id: d.projectId,
        subject_pseudo_id: d.subjectPseudoId,
        protocol_version: d.protocolVersion,
        document_title: d.documentTitle,
        method: d.method,
        status: d.status,
        signed_at: d.signedAt,
        withdrawn_at: d.withdrawnAt ?? null,
        withdrawal_reason: d.withdrawalReason ?? "",
        recorded_by: d.recordedBy,
        recorded_by_name: d.recordedByName,
        created_at: tsToIso(d.createdAt),
        updated_at: tsToIso(d.updatedAt),
      });
    }
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function listVaultSubjects(
  projectId: string,
  canAccessVault: boolean
): Promise<VaultSubjectSummary[]> {
  const path = `projects/${projectId}/identityVault`;
  try {
    const [meta, consents] = await Promise.all([
      getMetaIndex(projectId),
      listConsents(projectId).catch(() => [] as ConsentRecord[]),
    ]);
    const latestConsentBySubj = new Map<string, ConsentStatus>();
    for (const c of consents) {
      if (!latestConsentBySubj.has(c.subject_pseudo_id)) {
        latestConsentBySubj.set(c.subject_pseudo_id, c.status);
      }
    }

    if (!canAccessVault) {
      return meta.vaultIds.map((subjectId) => ({
        subject_pseudo_id: subjectId,
        project_id: projectId,
        blind_index: "",
        created_by: "",
        created_at: "",
        consent_status: latestConsentBySubj.get(subjectId) ?? "pendiente",
      }));
    }

    const snaps = await Promise.all(
      meta.vaultIds.map((id) => getDoc(doc(db, "projects", projectId, "identityVault", id)).catch(() => null))
    );
    const items: VaultSubjectSummary[] = [];
    for (const s of snaps) {
      if (!s || !s.exists()) continue;
      const d = s.data() as {
        projectId: string;
        subjectPseudoId: string;
        blindIndex: string;
        createdBy: string;
        createdAt: unknown;
      };
      items.push({
        subject_pseudo_id: d.subjectPseudoId,
        project_id: d.projectId,
        blind_index: d.blindIndex,
        created_by: d.createdBy,
        created_at: tsToIso(d.createdAt),
        consent_status: latestConsentBySubj.get(d.subjectPseudoId) ?? "pendiente",
      });
    }
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function registerPseudonymizedSubject(
  projectId: string,
  input: {
    subjectPseudoId?: string;
    fullName: string;
    nationalId: string;
    nhc?: string;
    birthDate?: string;
    phone?: string;
    email?: string;
  },
  user: User,
  canAccessVault: boolean
): Promise<VaultSubjectSummary> {
  ensureVerifiedUser(user);
  const sealed = await apiPost<{
    subjectPseudoId: string;
    blindIndex: string;
    sealedPayload: SealedIdentityPayload;
  }>("/pseudonymize/seal", {
    projectId,
    subjectPseudoId: input.subjectPseudoId,
    fullName: input.fullName,
    nationalId: input.nationalId,
    nhc: input.nhc ?? "",
    birthDate: input.birthDate ?? "",
    phone: input.phone ?? "",
    email: input.email ?? "",
  });

  const meta = await getMetaIndex(projectId);
  if (meta.vaultIds.includes(sealed.subjectPseudoId)) {
    throw new Error(`El código pseudonimizado «${sealed.subjectPseudoId}» ya existe en este estudio.`);
  }

  // O(1) duplicate detection via blindIndexes subcollection (available to all vault registrars incl. capturador/investigador)
  const blindRef = doc(db, "projects", projectId, "blindIndexes", sealed.blindIndex);
  const blindSnap = await getDoc(blindRef).catch(() => null);
  if (blindSnap && blindSnap.exists()) {
    const existingPseudo = (blindSnap.data() as { subjectPseudoId?: string }).subjectPseudoId || "existente";
    throw new Error(
      `Posible participante duplicado: ya existe un sujeto registrado con este documento bajo el código «${existingPseudo}».`
    );
  }

  if (canAccessVault && meta.vaultIds.length > 0) {
    const existingSnaps = await Promise.all(
      meta.vaultIds.map((id) => getDoc(doc(db, "projects", projectId, "identityVault", id)).catch(() => null))
    );
    for (const s of existingSnaps) {
      if (s && s.exists() && (s.data() as { blindIndex?: string }).blindIndex === sealed.blindIndex) {
        throw new Error(
          `Posible participante duplicado: ya existe un sujeto registrado con este documento bajo el código «${s.id}».`
        );
      }
    }
  }

  const path = `projects/${projectId}/identityVault/${sealed.subjectPseudoId}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "projects", projectId, "identityVault", sealed.subjectPseudoId), {
      projectId,
      subjectPseudoId: sealed.subjectPseudoId,
      blindIndex: sealed.blindIndex,
      sealedPayload: sealed.sealedPayload,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
    batch.set(blindRef, {
      projectId,
      blindIndex: sealed.blindIndex,
      subjectPseudoId: sealed.subjectPseudoId,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
    await batch.commit();

    await appendIdsToMetaShards(projectId, { vaultIds: sealed.subjectPseudoId });
    await appendAuditLog(
      projectId,
      {
        action: "SUBJECT_PSEUDONYMIZED",
        resourceType: "identityVault",
        resourceId: sealed.subjectPseudoId,
        outcome: "SUCCESS",
      },
      { strict: true }
    );

    return {
      subject_pseudo_id: sealed.subjectPseudoId,
      project_id: projectId,
      blind_index: sealed.blindIndex,
      created_by: user.uid,
      created_at: new Date().toISOString(),
      consent_status: "pendiente",
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function reidentifySubject(
  projectId: string,
  subjectPseudoId: string,
  reason: string,
  user: User
): Promise<{
  subjectPseudoId: string;
  identity: {
    fullName: string;
    nationalId: string;
    nhc: string;
    birthDate?: string;
    phone?: string;
    email?: string;
  };
}> {
  ensureVerifiedUser(user);
  const path = `projects/${projectId}/identityVault/${subjectPseudoId}`;
  const snap = await getDoc(doc(db, "projects", projectId, "identityVault", subjectPseudoId));
  if (!snap.exists()) {
    throw new Error("Código pseudonimizado no encontrado en la bóveda del estudio.");
  }
  const d = snap.data() as {
    sealedPayload: SealedIdentityPayload;
  };

  const metaRef = doc(db, "projects", projectId, "meta", "index");
  const result = await runTransaction(db, async (tx) => {
    const metaSnap = await tx.get(metaRef);
    const metaData = metaSnap.exists() ? (metaSnap.data() as Partial<MetaIndexData>) : {};
    const prevHash =
      typeof metaData.lastAuditHash === "string" && metaData.lastAuditHash ? metaData.lastAuditHash : "GENESIS";
    const shardCounts: Partial<Record<ShardedIndexKind, number>> = {
      ...(metaData.shardCounts && typeof metaData.shardCounts === "object" ? metaData.shardCounts : {}),
    };
    const count = Number(shardCounts.auditLogIds ?? 0);
    let tailSnapIds: string[] = [];
    let creatingNewShard = count <= 0;
    let targetIdx = count > 0 ? count - 1 : 0;

    if (count > 0) {
      const tailSnap = await tx.get(doc(db, "projects", projectId, "meta", shardDocId("auditLogIds", count - 1)));
      if (!tailSnap.exists()) {
        creatingNewShard = true;
        targetIdx = count;
      } else {
        tailSnapIds = (tailSnap.data() as { ids?: string[] }).ids ?? [];
        if (tailSnapIds.length >= SHARD_MAX_SIZE) {
          creatingNewShard = true;
          targetIdx = count;
        }
      }
    }

    const res = await apiPost<{
      subjectPseudoId: string;
      identity: {
        fullName: string;
        nationalId: string;
        nhc: string;
        birthDate?: string;
        phone?: string;
        email?: string;
      };
      auditEntry: SignedAuditResponse;
    }>("/pseudonymize/unseal", {
      projectId,
      subjectPseudoId,
      reason,
      sealedPayload: d.sealedPayload,
      prevHash,
    });

    const auditId = makeId("aud");
    tx.set(doc(db, "projects", projectId, "auditLogs", auditId), res.auditEntry);
    if (creatingNewShard) {
      tx.set(doc(db, "projects", projectId, "meta", shardDocId("auditLogIds", targetIdx)), {
        projectId,
        kind: "auditLogIds",
        shardIndex: targetIdx,
        ids: [auditId],
        updatedAt: serverTimestamp(),
      });
      shardCounts.auditLogIds = targetIdx + 1;
    } else {
      tx.update(doc(db, "projects", projectId, "meta", shardDocId("auditLogIds", targetIdx)), {
        ids: [...tailSnapIds, auditId],
        updatedAt: serverTimestamp(),
      });
    }
    tx.update(metaRef, {
      lastAuditHash: res.auditEntry.entryHash,
      ...(creatingNewShard ? { shardCounts } : {}),
      updatedAt: serverTimestamp(),
    });

    return { subjectPseudoId: res.subjectPseudoId, identity: res.identity };
  });

  void path;
  return result;
}

export async function recordConsent(
  projectId: string,
  input: {
    subjectPseudoId: string;
    protocolVersion: string;
    documentTitle: string;
    method: ConsentMethod;
    status: ConsentStatus;
    signedAt: string;
  },
  user: User
): Promise<ConsentRecord> {
  ensureVerifiedUser(user);
  const consentId = makeId("cns");
  const path = `projects/${projectId}/consentRecords/${consentId}`;
  const actorName = (user.displayName || user.email?.split("@")[0] || "Investigador").slice(0, 120);
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "projects", projectId, "consentRecords", consentId), {
      projectId,
      subjectPseudoId: input.subjectPseudoId,
      protocolVersion: input.protocolVersion.trim().slice(0, 64),
      documentTitle: input.documentTitle.trim().slice(0, 200),
      method: input.method,
      status: input.status,
      signedAt: input.signedAt.trim().slice(0, 64),
      recordedBy: user.uid,
      recordedByName: actorName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "projects", projectId, "consentStates", input.subjectPseudoId), {
      projectId,
      subjectPseudoId: input.subjectPseudoId,
      status: input.status,
      consentId,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await appendIdsToMetaShards(projectId, { consentIds: consentId });
    await appendAuditLog(
      projectId,
      {
        action: input.status === "retirado" ? "CONSENT_WITHDRAWN" : "CONSENT_RECORDED",
        resourceType: "consentRecord",
        resourceId: consentId,
        outcome: "SUCCESS",
        details: { subjectPseudoId: input.subjectPseudoId, status: input.status, protocolVersion: input.protocolVersion },
      },
      { strict: true }
    );

    const now = new Date().toISOString();
    return {
      id: consentId,
      project_id: projectId,
      subject_pseudo_id: input.subjectPseudoId,
      protocol_version: input.protocolVersion,
      document_title: input.documentTitle,
      method: input.method,
      status: input.status,
      signed_at: input.signedAt,
      recorded_by: user.uid,
      recorded_by_name: actorName,
      created_at: now,
      updated_at: now,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateConsentStatus(
  projectId: string,
  consent: ConsentRecord,
  nextStatus: ConsentStatus,
  reason: string,
  user: User
): Promise<void> {
  ensureVerifiedUser(user);
  const path = `projects/${projectId}/consentRecords/${consent.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "projects", projectId, "consentRecords", consent.id), {
      status: nextStatus,
      ...(nextStatus === "retirado"
        ? { withdrawnAt: new Date().toISOString(), withdrawalReason: reason.trim().slice(0, 500) }
        : {}),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "projects", projectId, "consentStates", consent.subject_pseudo_id), {
      projectId,
      subjectPseudoId: consent.subject_pseudo_id,
      status: nextStatus,
      consentId: consent.id,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await appendAuditLog(
      projectId,
      {
        action: nextStatus === "retirado" ? "CONSENT_WITHDRAWN" : "CONSENT_RECORDED",
        resourceType: "consentRecord",
        resourceId: consent.id,
        outcome: "SUCCESS",
        reason,
        details: { subjectPseudoId: consent.subject_pseudo_id, status: nextStatus },
      },
      { strict: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function listFormRecords(
  projectId: string,
  formId: string,
  user: User,
  myRole: Role
): Promise<RecordOut[]> {
  const path = `projects/${projectId}/crfRecords`;
  try {
    let snaps;
    if (myRole === "capturador") {
      const idxSnap = await getDoc(doc(db, "projects", projectId, "memberIndexes", user.uid)).catch(() => null);
      const recIds =
        idxSnap && idxSnap.exists()
          ? ((idxSnap.data() as { crfRecordIds?: string[] }).crfRecordIds ?? [])
          : [];
      const raw = await Promise.all(
        recIds.map((id) => getDoc(doc(db, "projects", projectId, "crfRecords", id)).catch(() => null))
      );
      snaps = raw.filter((s): s is NonNullable<typeof s> => Boolean(s && s.exists()));
    } else {
      const meta = await getMetaIndex(projectId);
      const raw = await Promise.all(
        meta.crfRecordIds.map((id) => getDoc(doc(db, "projects", projectId, "crfRecords", id)).catch(() => null))
      );
      snaps = raw.filter((s): s is NonNullable<typeof s> => Boolean(s && s.exists()));
    }

    const list: RecordOut[] = [];
    for (const s of snaps) {
      const d = s.data() as {
        formId: string;
        datasetId: string;
        seq: number;
        subjectPseudoId?: string | null;
        status?: CrfRecordStatus;
        version?: number;
        formVersion?: number;
        lastChangeReason?: string;
        data: Record<string, Cell>;
        createdAt: unknown;
        createdBy: string;
        updatedAt?: unknown;
        updatedBy?: string;
      };
      if (d.formId !== formId) continue;
      list.push({
        id: s.id,
        dataset_id: d.datasetId,
        seq: d.seq ?? 0,
        subject_pseudo_id: d.subjectPseudoId ?? null,
        status: d.status ?? "borrador",
        version: Number(d.version ?? 1),
        form_version: d.formVersion ? Number(d.formVersion) : undefined,
        last_change_reason: d.lastChangeReason ?? "",
        data: d.data ?? {},
        created_at: tsToIso(d.createdAt),
        created_by: d.createdBy,
        updated_at: d.updatedAt ? tsToIso(d.updatedAt) : undefined,
        updated_by: d.updatedBy,
      });
    }
    list.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function listRecordVersions(projectId: string, recordId: string): Promise<CrfVersionEntry[]> {
  const path = `projects/${projectId}/crfVersions`;
  try {
    const meta = await getMetaIndex(projectId);
    if (!meta.crfVersionIds.length) return [];
    const snaps = await Promise.all(
      meta.crfVersionIds.map((id) => getDoc(doc(db, "projects", projectId, "crfVersions", id)).catch(() => null))
    );
    const items: CrfVersionEntry[] = [];
    for (const s of snaps) {
      if (!s || !s.exists()) continue;
      const d = s.data() as {
        recordId: string;
        version: number;
        formVersion?: number;
        previousStatus?: CrfRecordStatus | null;
        newStatus: CrfRecordStatus;
        previousData: Record<string, Cell>;
        newData: Record<string, Cell>;
        changedBy: string;
        changedByName: string;
        changedAt: unknown;
        reason: string;
      };
      if (d.recordId !== recordId) continue;
      items.push({
        id: s.id,
        record_id: d.recordId,
        version: d.version,
        form_version: d.formVersion ? Number(d.formVersion) : undefined,
        previous_status: d.previousStatus ?? null,
        new_status: d.newStatus,
        previous_data: d.previousData ?? {},
        new_data: d.newData ?? {},
        changed_by: d.changedBy,
        changed_by_name: d.changedByName,
        changed_at: tsToIso(d.changedAt),
        reason: d.reason,
      });
    }
    items.sort((a, b) => b.version - a.version);
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

async function assertConsentEligibleForCapture(projectId: string, subjectPseudoId?: string | null): Promise<void> {
  const gov = await getStudyGovernance(projectId);
  const cleanSubj = subjectPseudoId?.trim() || "";
  if (gov.require_active_consent && !cleanSubj) {
    throw new Error(
      "Este estudio exige vincular un participante pseudonimizado con consentimiento informado «Vigente» antes de capturar datos."
    );
  }
  if (!cleanSubj) return;

  const stateSnap = await getDoc(doc(db, "projects", projectId, "consentStates", cleanSubj)).catch(() => null);
  if (stateSnap && stateSnap.exists()) {
    const stateStatus = (stateSnap.data() as { status?: ConsentStatus }).status;
    if (stateStatus !== "vigente") {
      throw new Error(
        `Captura bloqueada: el consentimiento de «${cleanSubj}» está en estado «${stateStatus}».`
      );
    }
    return;
  }

  const consents = await listConsents(projectId);
  const subjectConsents = consents.filter((c) => c.subject_pseudo_id === cleanSubj);
  const latest = subjectConsents[0];
  if (!latest) {
    if (gov.require_active_consent) {
      throw new Error(
        `El participante «${cleanSubj}» no tiene consentimiento registrado. Registra un consentimiento «Vigente» primero.`
      );
    }
    return;
  }
  if (latest.status !== "vigente") {
    throw new Error(
      `Captura bloqueada: el consentimiento de «${cleanSubj}» está en estado «${latest.status}».`
    );
  }
}

export async function createFormRecord(
  projectId: string,
  form: Form,
  inputData: Record<string, unknown>,
  user: User,
  myRole: Role,
  options?: { subjectPseudoId?: string | null; status?: "borrador" | "completado" | "enviado" }
): Promise<RecordOut> {
  ensureVerifiedUser(user);
  await assertStudyOpenForCapture(projectId);
  const cleanedData = cleanRecordInput(form.fields, inputData);
  const subjectPseudoId = options?.subjectPseudoId?.trim() || null;
  if (subjectPseudoId && !/^[a-zA-Z0-9_-]{4,64}$/.test(subjectPseudoId)) {
    throw new Error("El código pseudonimizado del sujeto solo puede tener letras, números, guiones y guion bajo.");
  }
  await assertConsentEligibleForCapture(projectId, subjectPseudoId);

  const initialStatus: "borrador" | "completado" | "enviado" = options?.status ?? "completado";
  const recordId = makeId("rec");
  const versionId = makeId("ver");
  const path = `projects/${projectId}/crfRecords/${recordId}`;
  const actorName = (user.displayName || user.email?.split("@")[0] || "Investigador").slice(0, 120);
  const formVersion = Number(form.form_version ?? 1);

  try {
    const [projSnap, meta] = await Promise.all([
      getDoc(doc(db, "projects", projectId)),
      getMetaIndex(projectId),
    ]);
    if (!projSnap.exists()) throw new Error("Estudio no encontrado.");
    const ownerId = (projSnap.data() as { ownerId: string }).ownerId;
    const seq = meta.crfRecordIds.length;

    const batch = writeBatch(db);
    batch.set(doc(db, "projects", projectId, "crfRecords", recordId), {
      projectId,
      projectOwnerId: ownerId,
      formId: form.id,
      datasetId: form.dataset_id,
      ...(subjectPseudoId ? { subjectPseudoId } : {}),
      status: initialStatus,
      version: 1,
      formVersion,
      lastChangeReason: "Captura inicial del registro CRF",
      seq,
      data: cleanedData,
      createdBy: user.uid,
      updatedBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "projects", projectId, "crfVersions", versionId), {
      projectId,
      recordId,
      version: 1,
      formVersion,
      previousStatus: null,
      newStatus: initialStatus,
      previousData: {},
      newData: cleanedData,
      changedBy: user.uid,
      changedByName: actorName,
      changedAt: serverTimestamp(),
      reason: "Captura inicial del registro CRF",
    });
    await batch.commit();

    await appendIdsToMetaShards(projectId, { crfRecordIds: recordId, crfVersionIds: versionId });
    await appendToMemberIndex(projectId, user.uid, { crfRecordId: recordId }).catch(() => {});
    await appendAuditLog(
      projectId,
      {
        action: "RECORD_CREATE",
        resourceType: "crfRecord",
        resourceId: recordId,
        outcome: "SUCCESS",
        details: {
          formId: form.id,
          formVersion,
          status: initialStatus,
          subjectPseudoId: subjectPseudoId || undefined,
        },
      },
      { strict: true }
    );

    if (myRole === "admin" || myRole === "coordinador" || myRole === "investigador") {
      try {
        const dsSnap = await getDoc(doc(db, "projects", projectId, "datasets", form.dataset_id));
        if (dsSnap.exists()) {
          const dsRaw = dsSnap.data() as {
            name: string;
            source: "upload" | "form";
            formId?: string | null;
            variables: Variable[];
            nRows: number;
            chunkCount: number;
            createdAt: unknown;
          };
          const dsObj: Dataset = {
            id: form.dataset_id,
            project_id: projectId,
            name: dsRaw.name,
            source: dsRaw.source,
            form_id: dsRaw.formId ?? form.id,
            variables: dsRaw.variables ?? [],
            n_rows: dsRaw.nRows ?? 0,
            chunk_count: dsRaw.chunkCount ?? 0,
            created_at: tsToIso(dsRaw.createdAt),
          };
          const full = await getDatasetWithRows(projectId, dsObj);
          await updateDoc(doc(db, "projects", projectId, "datasets", form.dataset_id), {
            nRows: full.rows.length,
            variables: full.dataset.variables,
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // non-fatal stats sync
      }
    }

    return {
      id: recordId,
      dataset_id: form.dataset_id,
      seq,
      subject_pseudo_id: subjectPseudoId,
      status: initialStatus,
      version: 1,
      form_version: formVersion,
      last_change_reason: "Captura inicial del registro CRF",
      data: cleanedData,
      created_at: new Date().toISOString(),
      created_by: user.uid,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateFormRecord(
  projectId: string,
  form: Form,
  recordId: string,
  inputData: Record<string, unknown>,
  user: User,
  myRole: Role,
  options?: { reason?: string; status?: "borrador" | "completado" | "enviado"; subjectPseudoId?: string | null }
): Promise<RecordOut> {
  ensureVerifiedUser(user);
  await assertStudyOpenForCapture(projectId);
  const cleanReason = (options?.reason ?? "").trim();
  if (cleanReason.length < 5) {
    throw new Error("Indica un motivo de modificación (mínimo 5 caracteres) para guardar cambios en el CRF.");
  }
  const cleanedData = cleanRecordInput(form.fields, inputData);
  const path = `projects/${projectId}/crfRecords/${recordId}`;
  const formVersion = Number(form.form_version ?? 1);

  try {
    const prevSnap = await getDoc(doc(db, "projects", projectId, "crfRecords", recordId));
    if (!prevSnap.exists()) throw new Error("Registro CRF no encontrado.");
    const prevDataDoc = prevSnap.data() as {
      status?: CrfRecordStatus;
      version?: number;
      data?: Record<string, Cell>;
      subjectPseudoId?: string | null;
    };
    const currStatus: CrfRecordStatus = prevDataDoc.status ?? "borrador";
    if (currStatus === "verificado" || currStatus === "bloqueado") {
      throw new Error(
        `El registro está en estado «${currStatus}». Un Coordinador o IP debe reabrirlo con motivo antes de modificar datos.`
      );
    }

    const nextStatus = options?.status ?? (currStatus as "borrador" | "completado" | "enviado");
    const nextVersion = Number(prevDataDoc.version ?? 1) + 1;
    const versionId = makeId("ver");
    const actorName = (user.displayName || user.email?.split("@")[0] || "Investigador").slice(0, 120);
    const subjectPseudoId =
      options?.subjectPseudoId !== undefined ? options.subjectPseudoId : (prevDataDoc.subjectPseudoId ?? null);

    if (subjectPseudoId) {
      await assertConsentEligibleForCapture(projectId, subjectPseudoId);
    }

    const batch = writeBatch(db);
    batch.update(doc(db, "projects", projectId, "crfRecords", recordId), {
      data: cleanedData,
      status: nextStatus,
      version: nextVersion,
      formVersion,
      lastChangeReason: cleanReason.slice(0, 500),
      ...(subjectPseudoId ? { subjectPseudoId } : {}),
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "projects", projectId, "crfVersions", versionId), {
      projectId,
      recordId,
      version: nextVersion,
      formVersion,
      previousStatus: currStatus,
      newStatus: nextStatus,
      previousData: prevDataDoc.data ?? {},
      newData: cleanedData,
      changedBy: user.uid,
      changedByName: actorName,
      changedAt: serverTimestamp(),
      reason: cleanReason.slice(0, 500),
    });
    await batch.commit();

    await appendIdsToMetaShards(projectId, { crfVersionIds: versionId });
    await appendAuditLog(
      projectId,
      {
        action: "RECORD_UPDATE",
        resourceType: "crfRecord",
        resourceId: recordId,
        outcome: "SUCCESS",
        reason: cleanReason,
        details: { version: nextVersion, formVersion, newStatus: nextStatus },
      },
      { strict: true }
    );

    const updatedSnap = await getDoc(doc(db, "projects", projectId, "crfRecords", recordId));
    const d = updatedSnap.data() as {
      datasetId: string;
      seq: number;
      subjectPseudoId?: string | null;
      status?: CrfRecordStatus;
      version?: number;
      formVersion?: number;
      lastChangeReason?: string;
      data: Record<string, Cell>;
      createdAt: unknown;
      createdBy: string;
    };

    if (myRole === "admin" || myRole === "coordinador" || myRole === "investigador") {
      try {
        const dsSnap = await getDoc(doc(db, "projects", projectId, "datasets", form.dataset_id));
        if (dsSnap.exists()) {
          const dsRaw = dsSnap.data() as {
            name: string;
            source: "upload" | "form";
            formId?: string | null;
            variables: Variable[];
            nRows: number;
            chunkCount: number;
            createdAt: unknown;
          };
          const dsObj: Dataset = {
            id: form.dataset_id,
            project_id: projectId,
            name: dsRaw.name,
            source: dsRaw.source,
            form_id: dsRaw.formId ?? form.id,
            variables: dsRaw.variables ?? [],
            n_rows: dsRaw.nRows ?? 0,
            chunk_count: dsRaw.chunkCount ?? 0,
            created_at: tsToIso(dsRaw.createdAt),
          };
          const full = await getDatasetWithRows(projectId, dsObj);
          await updateDoc(doc(db, "projects", projectId, "datasets", form.dataset_id), {
            nRows: full.rows.length,
            variables: full.dataset.variables,
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // non-fatal
      }
    }

    return {
      id: recordId,
      dataset_id: d.datasetId,
      seq: d.seq,
      subject_pseudo_id: d.subjectPseudoId ?? null,
      status: d.status ?? nextStatus,
      version: d.version ?? nextVersion,
      form_version: d.formVersion ?? formVersion,
      last_change_reason: d.lastChangeReason ?? cleanReason,
      data: d.data,
      created_at: tsToIso(d.createdAt),
      created_by: d.createdBy,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function transitionFormRecordStatus(
  projectId: string,
  recordId: string,
  nextStatus: "verificado" | "bloqueado",
  reason: string,
  user: User,
  signatureId?: string
): Promise<void> {
  ensureVerifiedUser(user);
  await assertStudyUnlockedForCrfReview(projectId);
  const cleanReason = reason.trim() || `Transición de control a estado ${nextStatus}`;
  const path = `projects/${projectId}/crfRecords/${recordId}`;
  try {
    const prevSnap = await getDoc(doc(db, "projects", projectId, "crfRecords", recordId));
    if (!prevSnap.exists()) throw new Error("Registro CRF no encontrado.");
    const prev = prevSnap.data() as {
      status?: CrfRecordStatus;
      version?: number;
      formVersion?: number;
      data?: Record<string, Cell>;
    };
    const currStatus = prev.status ?? "borrador";
    const nextVersion = Number(prev.version ?? 1) + 1;
    const versionId = makeId("ver");
    const actorName = (user.displayName || user.email?.split("@")[0] || "Monitor").slice(0, 120);

    const batch = writeBatch(db);
    batch.update(doc(db, "projects", projectId, "crfRecords", recordId), {
      status: nextStatus,
      version: nextVersion,
      lastChangeReason: cleanReason.slice(0, 500),
      ...(signatureId ? { lastSignatureId: signatureId } : {}),
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "projects", projectId, "crfVersions", versionId), {
      projectId,
      recordId,
      version: nextVersion,
      ...(prev.formVersion ? { formVersion: prev.formVersion } : {}),
      previousStatus: currStatus,
      newStatus: nextStatus,
      previousData: prev.data ?? {},
      newData: prev.data ?? {},
      changedBy: user.uid,
      changedByName: actorName,
      changedAt: serverTimestamp(),
      reason: cleanReason.slice(0, 500),
      ...(signatureId ? { signatureId } : {}),
    });
    await batch.commit();

    await appendIdsToMetaShards(projectId, { crfVersionIds: versionId });
    await appendAuditLog(
      projectId,
      {
        action: "RECORD_STATUS_CHANGE",
        resourceType: "crfRecord",
        resourceId: recordId,
        outcome: "SUCCESS",
        reason: cleanReason,
        details: { previousStatus: currStatus, newStatus: nextStatus, version: nextVersion, signatureId: signatureId ?? null },
      },
      { strict: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function reopenFormRecord(
  projectId: string,
  recordId: string,
  reason: string,
  user: User,
  signatureId?: string
): Promise<void> {
  ensureVerifiedUser(user);
  await assertStudyUnlockedForCrfReview(projectId);
  const cleanReason = reason.trim();
  if (cleanReason.length < 5) {
    throw new Error("Es obligatorio indicar un motivo de reapertura (mínimo 5 caracteres).");
  }
  const path = `projects/${projectId}/crfRecords/${recordId}`;
  try {
    const prevSnap = await getDoc(doc(db, "projects", projectId, "crfRecords", recordId));
    if (!prevSnap.exists()) throw new Error("Registro CRF no encontrado.");
    const prev = prevSnap.data() as {
      status?: CrfRecordStatus;
      version?: number;
      formVersion?: number;
      data?: Record<string, Cell>;
    };
    const currStatus = prev.status ?? "bloqueado";
    const nextVersion = Number(prev.version ?? 1) + 1;
    const versionId = makeId("ver");
    const actorName = (user.displayName || user.email?.split("@")[0] || "Coordinador").slice(0, 120);

    const batch = writeBatch(db);
    batch.update(doc(db, "projects", projectId, "crfRecords", recordId), {
      status: "borrador",
      version: nextVersion,
      lastChangeReason: cleanReason.slice(0, 500),
      ...(signatureId ? { lastSignatureId: signatureId } : {}),
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "projects", projectId, "crfVersions", versionId), {
      projectId,
      recordId,
      version: nextVersion,
      ...(prev.formVersion ? { formVersion: prev.formVersion } : {}),
      previousStatus: currStatus,
      newStatus: "borrador",
      previousData: prev.data ?? {},
      newData: prev.data ?? {},
      changedBy: user.uid,
      changedByName: actorName,
      changedAt: serverTimestamp(),
      reason: cleanReason.slice(0, 500),
      ...(signatureId ? { signatureId } : {}),
    });
    await batch.commit();

    await appendIdsToMetaShards(projectId, { crfVersionIds: versionId });
    await appendAuditLog(
      projectId,
      {
        action: "RECORD_REOPEN",
        resourceType: "crfRecord",
        resourceId: recordId,
        outcome: "SUCCESS",
        reason: cleanReason,
        details: { previousStatus: currStatus, newStatus: "borrador", version: nextVersion, signatureId: signatureId ?? null },
      },
      { strict: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function listSavedAnalyses(projectId: string): Promise<SavedAnalysis[]> {
  const path = `projects/${projectId}/savedAnalyses`;
  try {
    const meta = await getMetaIndex(projectId);
    const snaps = await Promise.all(
      meta.analysisIds.map((id) => getDoc(doc(db, "projects", projectId, "savedAnalyses", id)).catch(() => null))
    );
    const items: SavedAnalysis[] = [];
    for (const s of snaps) {
      if (!s || !s.exists()) continue;
      const d = s.data() as {
        projectId: string;
        datasetId: string;
        datasetName: string;
        test: string;
        title: string;
        summary: string;
        params: Record<string, unknown>;
        tables: unknown;
        charts: AnalysisResult["charts"];
        interpretation?: string | null;
        source: "manual" | "copilot";
        isPinned: boolean;
        note: string;
        createdBy: string;
        createdByName: string;
        createdAt: unknown;
        updatedAt: unknown;
      };
      items.push({
        id: s.id,
        project_id: d.projectId,
        dataset_id: d.datasetId,
        dataset_name: d.datasetName,
        test: d.test,
        title: d.title,
        summary: d.summary ?? "",
        params: d.params ?? {},
        tables: deserializeTables(d.tables),
        charts: Array.isArray(d.charts) ? d.charts : [],
        interpretation: d.interpretation ?? null,
        source: d.source ?? "manual",
        is_pinned: Boolean(d.isPinned),
        note: d.note ?? "",
        created_by: d.createdBy,
        created_by_name: d.createdByName,
        created_at: tsToIso(d.createdAt),
        updated_at: tsToIso(d.updatedAt),
      });
    }
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveAnalysisToProject(
  projectId: string,
  dataset: Dataset,
  result: AnalysisResult,
  options: {
    params?: Record<string, unknown>;
    interpretation?: string | null;
    source: "manual" | "copilot";
    isPinned?: boolean;
  },
  user: User
): Promise<SavedAnalysis> {
  ensureVerifiedUser(user);
  const analysisId = makeId("ana");
  const path = `projects/${projectId}/savedAnalyses/${analysisId}`;
  const creatorName = (user.displayName || user.email?.split("@")[0] || "Investigador").slice(0, 120);

  try {
    const projSnap = await getDoc(doc(db, "projects", projectId));
    if (!projSnap.exists()) throw new Error("Estudio no encontrado.");
    const ownerId = (projSnap.data() as { ownerId: string }).ownerId;
    const serialized = serializeAnalysis(result);

    await setDoc(doc(db, "projects", projectId, "savedAnalyses", analysisId), {
      projectId,
      projectOwnerId: ownerId,
      datasetId: dataset.id,
      datasetName: dataset.name.slice(0, 160),
      test: String(result.test ?? "").slice(0, 64),
      title: String(serialized.title),
      summary: String(serialized.summary),
      params: options.params ?? {},
      tables: serialized.tables,
      charts: serialized.charts,
      interpretation: options.interpretation ? options.interpretation.slice(0, 20000) : null,
      source: options.source,
      isPinned: Boolean(options.isPinned),
      note: "",
      createdBy: user.uid,
      createdByName: creatorName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await updateDoc(doc(db, "projects", projectId, "meta", "index"), {
      analysisIds: arrayUnion(analysisId),
      updatedAt: serverTimestamp(),
    });

    await appendAuditLog(
      projectId,
      {
        action: "ANALYSIS_SAVED",
        resourceType: "savedAnalysis",
        resourceId: analysisId,
        outcome: "SUCCESS",
        details: { test: result.test, datasetId: dataset.id },
      },
      { strict: true }
    );

    const now = new Date().toISOString();
    return {
      id: analysisId,
      project_id: projectId,
      dataset_id: dataset.id,
      dataset_name: dataset.name,
      test: result.test,
      title: result.title,
      summary: result.summary,
      params: options.params ?? {},
      tables: result.tables,
      charts: result.charts,
      interpretation: options.interpretation ?? null,
      source: options.source,
      is_pinned: Boolean(options.isPinned),
      note: "",
      created_by: user.uid,
      created_by_name: creatorName,
      created_at: now,
      updated_at: now,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSavedAnalysisMeta(
  projectId: string,
  analysisId: string,
  patch: { is_pinned?: boolean; title?: string; note?: string },
  user: User
): Promise<void> {
  ensureVerifiedUser(user);
  const path = `projects/${projectId}/savedAnalyses/${analysisId}`;
  try {
    const updatePayload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.is_pinned !== undefined) updatePayload.isPinned = Boolean(patch.is_pinned);
    if (patch.title !== undefined) updatePayload.title = patch.title.trim().slice(0, 240) || "Análisis estadístico";
    if (patch.note !== undefined) updatePayload.note = patch.note.slice(0, 1000);
    await updateDoc(doc(db, "projects", projectId, "savedAnalyses", analysisId), updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSavedAnalysis(projectId: string, analysisId: string, user: User): Promise<void> {
  ensureVerifiedUser(user);
  const path = `projects/${projectId}/savedAnalyses/${analysisId}`;
  try {
    await deleteDoc(doc(db, "projects", projectId, "savedAnalyses", analysisId));
    await updateDoc(doc(db, "projects", projectId, "meta", "index"), {
      analysisIds: arrayRemove(analysisId),
      updatedAt: serverTimestamp(),
    });
    await appendAuditLog(
      projectId,
      {
        action: "ANALYSIS_DELETED",
        resourceType: "savedAnalysis",
        resourceId: analysisId,
        outcome: "SUCCESS",
      },
      { strict: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function listChatMessages(projectId: string, datasetId: string, user: User): Promise<ChatMessage[]> {
  const path = `projects/${projectId}/chatMessages`;
  try {
    const idxSnap = await getDoc(doc(db, "projects", projectId, "memberIndexes", user.uid)).catch(() => null);
    const msgIds =
      idxSnap && idxSnap.exists()
        ? ((idxSnap.data() as { chatMessageIds?: string[] }).chatMessageIds ?? [])
        : [];
    const rawSnaps = await Promise.all(
      msgIds.map((id) => getDoc(doc(db, "projects", projectId, "chatMessages", id)).catch(() => null))
    );
    const msgs: ChatMessage[] = [];
    for (const d of rawSnaps) {
      if (!d || !d.exists()) continue;
      const data = d.data() as {
        datasetId: string;
        userId: string;
        role: "user" | "assistant";
        content: string;
        analysis?: unknown;
        createdAt: unknown;
      };
      if (data.datasetId !== datasetId) continue;
      msgs.push({
        id: d.id,
        dataset_id: data.datasetId,
        user_id: data.userId,
        role: data.role,
        content: data.content,
        analysis: deserializeAnalysis(data.analysis),
        created_at: tsToIso(data.createdAt),
      });
    }
    msgs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return msgs;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveChatMessage(
  projectId: string,
  datasetId: string,
  role: "user" | "assistant",
  content: string,
  analysis: AnalysisResult | null,
  user: User
): Promise<ChatMessage> {
  ensureVerifiedUser(user);
  const msgId = makeId("msg");
  const path = `projects/${projectId}/chatMessages/${msgId}`;
  try {
    await setDoc(doc(db, "projects", projectId, "chatMessages", msgId), {
      projectId,
      datasetId,
      userId: user.uid,
      role,
      content: content.slice(0, 30000),
      analysis: analysis ? serializeAnalysis(analysis) : null,
      createdAt: serverTimestamp(),
    });
    await appendToMemberIndex(projectId, user.uid, { chatMessageId: msgId }).catch(() => {});
    return {
      id: msgId,
      dataset_id: datasetId,
      user_id: user.uid,
      role,
      content,
      analysis,
      created_at: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function clearChatMessages(projectId: string, datasetId: string, user: User): Promise<void> {
  ensureVerifiedUser(user);
  const path = `projects/${projectId}/chatMessages`;
  try {
    const idxRef = doc(db, "projects", projectId, "memberIndexes", user.uid);
    const idxSnap = await getDoc(idxRef).catch(() => null);
    const msgIds =
      idxSnap && idxSnap.exists()
        ? ((idxSnap.data() as { chatMessageIds?: string[] }).chatMessageIds ?? [])
        : [];
    const snaps = await Promise.all(
      msgIds.map((id) => getDoc(doc(db, "projects", projectId, "chatMessages", id)).catch(() => null))
    );
    const deletedIds: string[] = [];
    await Promise.all(
      snaps.map(async (d) => {
        if (!d || !d.exists()) return;
        if ((d.data() as { datasetId: string }).datasetId === datasetId) {
          deletedIds.push(d.id);
          await deleteDoc(d.ref);
        }
      })
    );
    if (deletedIds.length && idxSnap && idxSnap.exists()) {
      await updateDoc(idxRef, {
        chatMessageIds: arrayRemove(...deletedIds),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ============================================================================
// Study Lifecycle, Amendments, Electronic Approvals, Queries & Deviations
// ============================================================================

export async function getStudyLifecycle(projectId: string): Promise<StudyLifecycle> {
  try {
    const snap = await getDoc(doc(db, "projects", projectId, "governance", "lifecycle"));
    if (!snap.exists()) {
      return {
        project_id: projectId,
        study_status: "reclutamiento",
        protocol_version: "1.0",
        amendments: [],
      };
    }
    const d = snap.data() as {
      studyStatus?: StudyStatus;
      protocolVersion?: string;
      amendments?: StudyAmendment[];
      lastStatusReason?: string;
      updatedBy?: string;
      updatedByName?: string;
      updatedAt?: unknown;
    };
    return {
      project_id: projectId,
      study_status: d.studyStatus ?? "reclutamiento",
      protocol_version: d.protocolVersion ?? "1.0",
      amendments: Array.isArray(d.amendments) ? d.amendments : [],
      last_status_reason: d.lastStatusReason ?? "",
      updated_by: d.updatedBy,
      updated_by_name: d.updatedByName,
      updated_at: d.updatedAt ? tsToIso(d.updatedAt) : undefined,
    };
  } catch {
    return {
      project_id: projectId,
      study_status: "reclutamiento",
      protocol_version: "1.0",
      amendments: [],
    };
  }
}

async function assertStudyOpenForCapture(projectId: string): Promise<void> {
  const lifecycle = await getStudyLifecycle(projectId);
  if (lifecycle.study_status === "cerrado" || lifecycle.study_status === "bloqueado" || lifecycle.study_status === "archivado") {
    throw new Error(
      `Operación bloqueada: el estudio está en fase «${lifecycle.study_status}». Solo un IP o Coordinador puede reabrir la fase de captura.`
    );
  }
}

async function assertStudyUnlockedForCrfReview(projectId: string): Promise<void> {
  const lifecycle = await getStudyLifecycle(projectId);
  if (lifecycle.study_status === "bloqueado" || lifecycle.study_status === "archivado") {
    throw new Error(
      `Estudio en estado «${lifecycle.study_status}»: los registros CRF están congelados hasta que se desbloquee el ciclo de vida del estudio.`
    );
  }
}

export async function updateStudyStatus(
  projectId: string,
  nextStatus: StudyStatus,
  reason: string,
  user: User,
  signatureId?: string
): Promise<StudyLifecycle> {
  ensureVerifiedUser(user);
  const cleanReason = reason.trim();
  if (cleanReason.length < 5) {
    throw new Error("Indica un motivo de cambio de estado del estudio (mínimo 5 caracteres).");
  }
  const path = `projects/${projectId}/governance/lifecycle`;
  const actorName = (user.displayName || user.email?.split("@")[0] || "Investigador Principal").slice(0, 120);
  try {
    const current = await getStudyLifecycle(projectId);
    await setDoc(doc(db, "projects", projectId, "governance", "lifecycle"), {
      projectId,
      studyStatus: nextStatus,
      protocolVersion: current.protocol_version || "1.0",
      amendments: current.amendments ?? [],
      lastStatusReason: cleanReason.slice(0, 500),
      updatedBy: user.uid,
      updatedByName: actorName,
      updatedAt: serverTimestamp(),
    });
    await appendAuditLog(
      projectId,
      {
        action: "STUDY_STATUS_CHANGE",
        resourceType: "studyLifecycle",
        resourceId: projectId,
        outcome: "SUCCESS",
        reason: cleanReason,
        details: {
          previousStatus: current.study_status,
          nextStatus,
          protocolVersion: current.protocol_version,
          signatureId: signatureId ?? null,
        },
      },
      { strict: true }
    );
    return {
      ...current,
      study_status: nextStatus,
      last_status_reason: cleanReason,
      updated_by: user.uid,
      updated_by_name: actorName,
      updated_at: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function addStudyAmendment(
  projectId: string,
  input: { version: string; summary: string; effectiveDate: string },
  user: User
): Promise<StudyLifecycle> {
  ensureVerifiedUser(user);
  const version = input.version.trim().slice(0, 64);
  const summary = input.summary.trim().slice(0, 500);
  const effectiveDate = input.effectiveDate.trim().slice(0, 32);
  if (!version || summary.length < 5 || !effectiveDate) {
    throw new Error("Completa versión del protocolo, fecha efectiva y resumen de la enmienda (mín. 5 caracteres).");
  }
  const path = `projects/${projectId}/governance/lifecycle`;
  const actorName = (user.displayName || user.email?.split("@")[0] || "Coordinador").slice(0, 120);
  try {
    const current = await getStudyLifecycle(projectId);
    const amendment: StudyAmendment = {
      id: makeId("amd"),
      version,
      summary,
      effective_date: effectiveDate,
      approved_by: user.uid,
      approved_by_name: actorName,
      created_at: new Date().toISOString(),
    };
    const nextAmendments = [amendment, ...(current.amendments ?? [])].slice(0, 100);
    await setDoc(doc(db, "projects", projectId, "governance", "lifecycle"), {
      projectId,
      studyStatus: current.study_status,
      protocolVersion: version,
      amendments: nextAmendments,
      lastStatusReason: `Enmienda de protocolo ${version}`,
      updatedBy: user.uid,
      updatedByName: actorName,
      updatedAt: serverTimestamp(),
    });
    await appendAuditLog(
      projectId,
      {
        action: "STUDY_AMENDMENT",
        resourceType: "studyLifecycle",
        resourceId: amendment.id,
        outcome: "SUCCESS",
        reason: summary,
        details: { version, effectiveDate },
      },
      { strict: true }
    );
    return {
      ...current,
      protocol_version: version,
      amendments: nextAmendments,
      updated_by: user.uid,
      updated_by_name: actorName,
      updated_at: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function signElectronicApproval(
  projectId: string,
  input: {
    targetType: "crf_record" | "study_lifecycle";
    targetId: string;
    targetVersion?: number;
    meaning: string;
    reason: string;
  },
  user: User
): Promise<ElectronicSignatureManifest> {
  ensureVerifiedUser(user);
  const res = await apiPost<{ manifest: ElectronicSignatureManifest }>("/signatures/sign", {
    projectId,
    targetType: input.targetType,
    targetId: input.targetId,
    ...(input.targetVersion !== undefined ? { targetVersion: input.targetVersion } : {}),
    meaning: input.meaning,
    reason: input.reason,
  });
  const m = res.manifest;
  const path = `projects/${projectId}/electronicSignatures/${m.id}`;
  try {
    await setDoc(doc(db, "projects", projectId, "electronicSignatures", m.id), {
      id: m.id,
      projectId: m.project_id,
      targetType: m.target_type,
      targetId: m.target_id,
      ...(m.target_version !== undefined ? { targetVersion: m.target_version } : {}),
      meaning: m.meaning,
      reason: m.reason,
      signerUid: m.signer_uid,
      signerName: m.signer_name,
      signerRole: m.signer_role,
      authTimeUtc: m.auth_time_utc,
      signedAtUtc: m.signed_at_utc,
      attestationHash: m.attestation_hash,
      keyId: m.key_id,
      signatureLevel: m.signature_level,
      createdAt: serverTimestamp(),
    });
    await appendIdsToMetaShards(projectId, { signatureIds: m.id });
    await appendAuditLog(
      projectId,
      {
        action: "ELECTRONIC_APPROVAL",
        resourceType: m.target_type,
        resourceId: m.target_id,
        outcome: "SUCCESS",
        reason: m.reason,
        details: {
          signatureId: m.id,
          meaning: m.meaning,
          attestationHash: m.attestation_hash,
          keyId: m.key_id,
          signatureLevel: m.signature_level,
        },
      },
      { strict: true }
    );
    return m;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function listElectronicSignatures(projectId: string): Promise<ElectronicSignatureManifest[]> {
  const path = `projects/${projectId}/electronicSignatures`;
  try {
    const meta = await getMetaIndex(projectId);
    if (!meta.signatureIds.length) return [];
    const snaps = await Promise.all(
      meta.signatureIds.map((id) => getDoc(doc(db, "projects", projectId, "electronicSignatures", id)).catch(() => null))
    );
    const items: ElectronicSignatureManifest[] = [];
    for (const s of snaps) {
      if (!s || !s.exists()) continue;
      const d = s.data() as {
        id: string;
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
        signedAtUtc: string;
        attestationHash: string;
        keyId: string;
        signatureLevel: "reauthenticated_hmac_attestation";
      };
      items.push({
        id: d.id,
        project_id: d.projectId,
        target_type: d.targetType,
        target_id: d.targetId,
        target_version: d.targetVersion,
        meaning: d.meaning,
        reason: d.reason,
        signer_uid: d.signerUid,
        signer_name: d.signerName,
        signer_role: d.signerRole,
        auth_time_utc: d.authTimeUtc,
        signed_at_utc: d.signedAtUtc,
        attestation_hash: d.attestationHash,
        key_id: d.keyId,
        signature_level: d.signatureLevel,
      });
    }
    items.sort((a, b) => b.signed_at_utc.localeCompare(a.signed_at_utc));
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function listClinicalQueries(
  projectId: string,
  filters?: { recordId?: string; formId?: string }
): Promise<ClinicalQuery[]> {
  const path = `projects/${projectId}/queries`;
  try {
    const meta = await getMetaIndex(projectId);
    if (!meta.queryIds.length) return [];
    const snaps = await Promise.all(
      meta.queryIds.map((id) => getDoc(doc(db, "projects", projectId, "queries", id)).catch(() => null))
    );
    const items: ClinicalQuery[] = [];
    for (const s of snaps) {
      if (!s || !s.exists()) continue;
      const d = s.data() as {
        projectId: string;
        recordId: string;
        formId: string;
        subjectPseudoId?: string | null;
        variableName: string;
        status: QueryStatus;
        openedBy: string;
        openedByName: string;
        openedAt: string;
        resolvedBy?: string | null;
        resolvedAt?: string | null;
        messages: QueryMessageEntry[];
        updatedAt: unknown;
      };
      if (filters?.recordId && d.recordId !== filters.recordId) continue;
      if (filters?.formId && d.formId !== filters.formId) continue;
      items.push({
        id: s.id,
        project_id: d.projectId,
        record_id: d.recordId,
        form_id: d.formId,
        subject_pseudo_id: d.subjectPseudoId ?? null,
        variable_name: d.variableName,
        status: d.status,
        opened_by: d.openedBy,
        opened_by_name: d.openedByName,
        opened_at: d.openedAt,
        resolved_by: d.resolvedBy ?? null,
        resolved_at: d.resolvedAt ?? null,
        messages: Array.isArray(d.messages) ? d.messages : [],
        updated_at: tsToIso(d.updatedAt),
      });
    }
    items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function createClinicalQuery(
  projectId: string,
  input: {
    recordId: string;
    formId: string;
    subjectPseudoId?: string | null;
    variableName: string;
    message: string;
  },
  user: User,
  myRole: Role
): Promise<ClinicalQuery> {
  ensureVerifiedUser(user);
  const cleanMsg = input.message.trim().slice(0, 1500);
  const cleanVar = input.variableName.trim().slice(0, 120);
  if (cleanMsg.length < 5 || !cleanVar) {
    throw new Error("Indica la variable afectada y el detalle de la query (mínimo 5 caracteres).");
  }
  const queryId = makeId("qry");
  const path = `projects/${projectId}/queries/${queryId}`;
  const actorName = (user.displayName || user.email?.split("@")[0] || "Monitor").slice(0, 120);
  const nowIso = new Date().toISOString();
  const initialEntry: QueryMessageEntry = {
    id: makeId("qmsg"),
    author_uid: user.uid,
    author_name: actorName,
    author_role: myRole,
    message: cleanMsg,
    action_type: "open",
    created_at: nowIso,
  };
  try {
    await setDoc(doc(db, "projects", projectId, "queries", queryId), {
      projectId,
      recordId: input.recordId,
      formId: input.formId,
      ...(input.subjectPseudoId ? { subjectPseudoId: input.subjectPseudoId } : {}),
      variableName: cleanVar,
      status: "abierta" satisfies QueryStatus,
      openedBy: user.uid,
      openedByName: actorName,
      openedAt: nowIso,
      messages: [initialEntry],
      updatedAt: serverTimestamp(),
    });
    await appendIdsToMetaShards(projectId, { queryIds: queryId });
    await appendAuditLog(
      projectId,
      {
        action: "QUERY_OPEN",
        resourceType: "clinicalQuery",
        resourceId: queryId,
        outcome: "SUCCESS",
        reason: cleanMsg,
        details: { recordId: input.recordId, variableName: cleanVar },
      },
      { strict: true }
    );
    return {
      id: queryId,
      project_id: projectId,
      record_id: input.recordId,
      form_id: input.formId,
      subject_pseudo_id: input.subjectPseudoId ?? null,
      variable_name: cleanVar,
      status: "abierta",
      opened_by: user.uid,
      opened_by_name: actorName,
      opened_at: nowIso,
      messages: [initialEntry],
      updated_at: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function respondClinicalQuery(
  projectId: string,
  queryId: string,
  message: string,
  user: User,
  myRole: Role
): Promise<ClinicalQuery> {
  ensureVerifiedUser(user);
  const cleanMsg = message.trim().slice(0, 1500);
  if (cleanMsg.length < 3) {
    throw new Error("Introduce una respuesta o aclaración clínica (mínimo 3 caracteres).");
  }
  const path = `projects/${projectId}/queries/${queryId}`;
  const actorName = (user.displayName || user.email?.split("@")[0] || "Investigador").slice(0, 120);
  try {
    const snap = await getDoc(doc(db, "projects", projectId, "queries", queryId));
    if (!snap.exists()) throw new Error("Query no encontrada.");
    const d = snap.data() as {
      recordId: string;
      formId: string;
      subjectPseudoId?: string | null;
      variableName: string;
      status: QueryStatus;
      openedBy: string;
      openedByName: string;
      openedAt: string;
      messages: QueryMessageEntry[];
    };
    const nowIso = new Date().toISOString();
    const entry: QueryMessageEntry = {
      id: makeId("qmsg"),
      author_uid: user.uid,
      author_name: actorName,
      author_role: myRole,
      message: cleanMsg,
      action_type: "response",
      created_at: nowIso,
    };
    const nextMessages = [...(d.messages ?? []), entry].slice(0, 100);
    await updateDoc(doc(db, "projects", projectId, "queries", queryId), {
      status: "respondida" satisfies QueryStatus,
      messages: nextMessages,
      updatedAt: serverTimestamp(),
    });
    await appendAuditLog(
      projectId,
      {
        action: "QUERY_RESPOND",
        resourceType: "clinicalQuery",
        resourceId: queryId,
        outcome: "SUCCESS",
        reason: cleanMsg,
        details: { recordId: d.recordId, variableName: d.variableName },
      },
      { strict: true }
    );
    return {
      id: queryId,
      project_id: projectId,
      record_id: d.recordId,
      form_id: d.formId,
      subject_pseudo_id: d.subjectPseudoId ?? null,
      variable_name: d.variableName,
      status: "respondida",
      opened_by: d.openedBy,
      opened_by_name: d.openedByName,
      opened_at: d.openedAt,
      messages: nextMessages,
      updated_at: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function transitionClinicalQuery(
  projectId: string,
  queryId: string,
  nextStatus: "correccion_solicitada" | "cerrada" | "cancelada",
  message: string,
  user: User,
  myRole: Role
): Promise<ClinicalQuery> {
  ensureVerifiedUser(user);
  const cleanMsg = message.trim().slice(0, 1500);
  if (cleanMsg.length < 3) {
    throw new Error("Indica un comentario de cierre o solicitud de corrección (mínimo 3 caracteres).");
  }
  const path = `projects/${projectId}/queries/${queryId}`;
  const actorName = (user.displayName || user.email?.split("@")[0] || "Monitor").slice(0, 120);
  try {
    const snap = await getDoc(doc(db, "projects", projectId, "queries", queryId));
    if (!snap.exists()) throw new Error("Query no encontrada.");
    const d = snap.data() as {
      recordId: string;
      formId: string;
      subjectPseudoId?: string | null;
      variableName: string;
      openedBy: string;
      openedByName: string;
      openedAt: string;
      messages: QueryMessageEntry[];
    };
    const nowIso = new Date().toISOString();
    const actionType =
      nextStatus === "cerrada"
        ? "close"
        : nextStatus === "cancelada"
          ? "cancel"
          : "correction_requested";
    const entry: QueryMessageEntry = {
      id: makeId("qmsg"),
      author_uid: user.uid,
      author_name: actorName,
      author_role: myRole,
      message: cleanMsg,
      action_type: actionType,
      created_at: nowIso,
    };
    const nextMessages = [...(d.messages ?? []), entry].slice(0, 100);
    const isResolved = nextStatus === "cerrada" || nextStatus === "cancelada";
    await updateDoc(doc(db, "projects", projectId, "queries", queryId), {
      status: nextStatus,
      messages: nextMessages,
      ...(isResolved ? { resolvedBy: user.uid, resolvedAt: nowIso } : {}),
      updatedAt: serverTimestamp(),
    });
    await appendAuditLog(
      projectId,
      {
        action: isResolved ? "QUERY_CLOSE" : "QUERY_RESPOND",
        resourceType: "clinicalQuery",
        resourceId: queryId,
        outcome: "SUCCESS",
        reason: cleanMsg,
        details: { nextStatus, recordId: d.recordId, variableName: d.variableName },
      },
      { strict: true }
    );
    return {
      id: queryId,
      project_id: projectId,
      record_id: d.recordId,
      form_id: d.formId,
      subject_pseudo_id: d.subjectPseudoId ?? null,
      variable_name: d.variableName,
      status: nextStatus,
      opened_by: d.openedBy,
      opened_by_name: d.openedByName,
      opened_at: d.openedAt,
      resolved_by: isResolved ? user.uid : null,
      resolved_at: isResolved ? nowIso : null,
      messages: nextMessages,
      updated_at: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function listProtocolDeviations(projectId: string): Promise<ProtocolDeviation[]> {
  const path = `projects/${projectId}/deviations`;
  try {
    const meta = await getMetaIndex(projectId);
    if (!meta.deviationIds.length) return [];
    const snaps = await Promise.all(
      meta.deviationIds.map((id) => getDoc(doc(db, "projects", projectId, "deviations", id)).catch(() => null))
    );
    const items: ProtocolDeviation[] = [];
    for (const s of snaps) {
      if (!s || !s.exists()) continue;
      const d = s.data() as {
        projectId: string;
        subjectPseudoId?: string | null;
        recordId?: string | null;
        title: string;
        description: string;
        severity: DeviationSeverity;
        status: DeviationStatus;
        occurredAt: string;
        detectedAt: string;
        impactAssessment: string;
        capaPlan: string;
        responsibleName: string;
        resolutionNotes?: string | null;
        reportedBy: string;
        reportedByName: string;
        createdAt: unknown;
        updatedAt: unknown;
      };
      items.push({
        id: s.id,
        project_id: d.projectId,
        subject_pseudo_id: d.subjectPseudoId ?? null,
        record_id: d.recordId ?? null,
        title: d.title,
        description: d.description,
        severity: d.severity,
        status: d.status,
        occurred_at: d.occurredAt,
        detected_at: d.detectedAt,
        impact_assessment: d.impactAssessment,
        capa_plan: d.capaPlan,
        responsible_name: d.responsibleName,
        resolution_notes: d.resolutionNotes ?? "",
        reported_by: d.reportedBy,
        reported_by_name: d.reportedByName,
        created_at: tsToIso(d.createdAt),
        updated_at: tsToIso(d.updatedAt),
      });
    }
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function createProtocolDeviation(
  projectId: string,
  input: {
    subjectPseudoId?: string | null;
    recordId?: string | null;
    title: string;
    description: string;
    severity: DeviationSeverity;
    occurredAt: string;
    detectedAt: string;
    impactAssessment: string;
    capaPlan: string;
    responsibleName: string;
  },
  user: User
): Promise<ProtocolDeviation> {
  ensureVerifiedUser(user);
  const title = input.title.trim().slice(0, 200);
  const description = input.description.trim().slice(0, 2000);
  const responsibleName = input.responsibleName.trim().slice(0, 120);
  if (title.length < 3 || description.length < 5 || !responsibleName) {
    throw new Error("Completa título, descripción (mín. 5 caracteres) y responsable de la desviación.");
  }
  const deviationId = makeId("dev");
  const path = `projects/${projectId}/deviations/${deviationId}`;
  const actorName = (user.displayName || user.email?.split("@")[0] || "Investigador").slice(0, 120);
  try {
    await setDoc(doc(db, "projects", projectId, "deviations", deviationId), {
      projectId,
      ...(input.subjectPseudoId ? { subjectPseudoId: input.subjectPseudoId.trim().slice(0, 64) } : {}),
      ...(input.recordId ? { recordId: input.recordId.trim().slice(0, 128) } : {}),
      title,
      description,
      severity: input.severity,
      status: "abierta" satisfies DeviationStatus,
      occurredAt: input.occurredAt.trim().slice(0, 64),
      detectedAt: input.detectedAt.trim().slice(0, 64),
      impactAssessment: input.impactAssessment.trim().slice(0, 2000),
      capaPlan: input.capaPlan.trim().slice(0, 2000),
      responsibleName,
      reportedBy: user.uid,
      reportedByName: actorName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await appendIdsToMetaShards(projectId, { deviationIds: deviationId });
    await appendAuditLog(
      projectId,
      {
        action: "DEVIATION_LOGGED",
        resourceType: "protocolDeviation",
        resourceId: deviationId,
        outcome: "SUCCESS",
        reason: title,
        details: { severity: input.severity, subjectPseudoId: input.subjectPseudoId || null },
      },
      { strict: true }
    );
    const now = new Date().toISOString();
    return {
      id: deviationId,
      project_id: projectId,
      subject_pseudo_id: input.subjectPseudoId ?? null,
      record_id: input.recordId ?? null,
      title,
      description,
      severity: input.severity,
      status: "abierta",
      occurred_at: input.occurredAt,
      detected_at: input.detectedAt,
      impact_assessment: input.impactAssessment,
      capa_plan: input.capaPlan,
      responsible_name: responsibleName,
      resolution_notes: "",
      reported_by: user.uid,
      reported_by_name: actorName,
      created_at: now,
      updated_at: now,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateProtocolDeviation(
  projectId: string,
  deviationId: string,
  patch: {
    status?: DeviationStatus;
    severity?: DeviationSeverity;
    impactAssessment?: string;
    capaPlan?: string;
    responsibleName?: string;
    resolutionNotes?: string;
  },
  user: User
): Promise<void> {
  ensureVerifiedUser(user);
  const path = `projects/${projectId}/deviations/${deviationId}`;
  try {
    const updatePayload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.status !== undefined) updatePayload.status = patch.status;
    if (patch.severity !== undefined) updatePayload.severity = patch.severity;
    if (patch.impactAssessment !== undefined) {
      updatePayload.impactAssessment = patch.impactAssessment.trim().slice(0, 2000);
    }
    if (patch.capaPlan !== undefined) updatePayload.capaPlan = patch.capaPlan.trim().slice(0, 2000);
    if (patch.responsibleName !== undefined) {
      updatePayload.responsibleName = patch.responsibleName.trim().slice(0, 120);
    }
    if (patch.resolutionNotes !== undefined) {
      updatePayload.resolutionNotes = patch.resolutionNotes.trim().slice(0, 2000);
    }
    await updateDoc(doc(db, "projects", projectId, "deviations", deviationId), updatePayload);
    await appendAuditLog(
      projectId,
      {
        action: "DEVIATION_UPDATED",
        resourceType: "protocolDeviation",
        resourceId: deviationId,
        outcome: "SUCCESS",
        reason: patch.resolutionNotes || `Actualización CAPA (${patch.status ?? "en curso"})`,
        details: { status: patch.status, severity: patch.severity },
      },
      { strict: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
