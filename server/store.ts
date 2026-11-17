import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  Cell,
  ChatMessage,
  Dataset,
  FieldType,
  Form,
  FormField,
  Project,
  ProjectMember,
  RecordOut,
  Role,
  UserRow,
  Variable,
  VarType,
} from "../src/lib/types.ts";

export interface StoredRow {
  id: string;
  dataset_id: string;
  seq: number;
  data: Record<string, Cell>;
  created_by: string;
  created_at: string;
}

export interface StoredProject {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  members: ProjectMember[];
  created_at: string;
}

export interface StoredForm extends Omit<Form, "record_count"> {}

export interface Database {
  users: UserRow[];
  projects: StoredProject[];
  datasets: Dataset[];
  forms: StoredForm[];
  rows: StoredRow[];
  chat_messages: ChatMessage[];
}

const DATA_FILE = path.resolve(process.cwd(), process.env.AVICENA_DATA_FILE || ".avicena-data.json");

const LEGACY_DEMO_USER_IDS = new Set(["usr-investigador", "usr-admin", "usr-capturador", "system"]);
const LEGACY_DEMO_PROJECT_IDS = new Set(["proj-cardiomed-2026", "proj-onco-surv", "proj-covid-longitud"]);

export function uid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function cleanCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return Number.isInteger(v) ? v : Math.round(v * 10000) / 10000;
  }
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

export function inferVariables(rows: Record<string, Cell>[]): Variable[] {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  return cols.map((col) => {
    const nonNull = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== "");
    let vtype: VarType = "text";
    if (nonNull.length > 0) {
      const nums = nonNull.map((v) => (typeof v === "number" ? v : Number(String(v).replace(",", "."))));
      const numFrac = nums.filter((n) => Number.isFinite(n)).length / nonNull.length;
      if (numFrac > 0.95) {
        const validNums = nums.filter((n) => Number.isFinite(n));
        const uniq = new Set(validNums);
        if (Array.from(uniq).every((u) => u === 0 || u === 1)) {
          vtype = "binary";
        } else if (uniq.size <= 6 && Array.from(uniq).every((u) => Number.isInteger(u)) && nonNull.length > 30) {
          vtype = "categorical";
        } else {
          vtype = "numeric";
        }
      } else {
        const strVals = nonNull.map((v) => String(v).trim());
        const uniq = new Set(strVals);
        if (uniq.size === 2) {
          vtype = "binary";
        } else if (uniq.size <= Math.max(12, Math.floor(0.05 * nonNull.length))) {
          vtype = "categorical";
        } else {
          const dateFrac =
            strVals.filter((s) => /^\d{4}-\d{2}-\d{2}/.test(s) || !Number.isNaN(Date.parse(s))).length / strVals.length;
          vtype = dateFrac > 0.9 ? "date" : "text";
        }
      }
    }
    const levels =
      vtype === "categorical" || vtype === "binary"
        ? Array.from(new Set(nonNull.map((v) => String(v).trim()))).sort().slice(0, 50)
        : [];
    return { name: col, label: "", type: vtype, levels };
  });
}

export function recomputeLevels(variables: Variable[], rows: Record<string, Cell>[]): Variable[] {
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

export const FIELD_TO_VAR_TYPE: Record<FieldType, VarType> = {
  number: "numeric",
  yesno: "binary",
  select: "categorical",
  radio: "categorical",
  date: "date",
  text: "text",
  textarea: "text",
  checkbox: "text",
};

export function formVariables(fields: FormField[]): Variable[] {
  return fields.map((f) => ({
    name: f.name,
    label: f.label,
    type: FIELD_TO_VAR_TYPE[f.type] ?? "text",
    levels: [],
  }));
}

function emptyDatabase(): Database {
  return {
    users: [],
    projects: [],
    datasets: [],
    forms: [],
    rows: [],
    chat_messages: [],
  };
}

let cachedDb: Database | null = null;

export function getDb(): Database {
  if (cachedDb) return cachedDb;
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<Database> & {
        projects?: Array<StoredProject & { demo?: boolean; member_ids?: string[] }>;
      };
      if (parsed && Array.isArray(parsed.projects)) {
        // Purge any legacy demo users & demo projects so zero fake data remains
        const cleanUsers = (parsed.users ?? []).filter((u) => !LEGACY_DEMO_USER_IDS.has(u.user_id));
        const cleanProjects: StoredProject[] = (parsed.projects ?? [])
          .filter(
            (p) =>
              !(p as StoredProject & { demo?: boolean }).demo &&
              !LEGACY_DEMO_PROJECT_IDS.has(p.id) &&
              !LEGACY_DEMO_USER_IDS.has(p.owner_id)
          )
          .map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description ?? "",
            owner_id: p.owner_id,
            members: Array.isArray(p.members) ? p.members : [],
            created_at: p.created_at ?? nowIso(),
          }));
        const keepProjIds = new Set(cleanProjects.map((p) => p.id));
        const cleanDatasets = (parsed.datasets ?? []).filter((d) => keepProjIds.has(d.project_id));
        const keepDsIds = new Set(cleanDatasets.map((d) => d.id));
        const cleanForms = (parsed.forms ?? []).filter((f) => keepProjIds.has(f.project_id));
        const cleanRows = (parsed.rows ?? []).filter((r) => keepDsIds.has(r.dataset_id));
        const cleanMsgs = (parsed.chat_messages ?? []).filter((m) => keepDsIds.has(m.dataset_id));

        cachedDb = {
          users: cleanUsers,
          projects: cleanProjects,
          datasets: cleanDatasets,
          forms: cleanForms,
          rows: cleanRows,
          chat_messages: cleanMsgs,
        };
        return cachedDb;
      }
    } catch {
      // Fallback to clean empty database
    }
  }
  cachedDb = emptyDatabase();
  saveDb();
  return cachedDb;
}

export function saveDb(): void {
  if (!cachedDb) return;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(cachedDb), "utf-8");
  } catch (err) {
    console.error("Failed to persist database:", err);
  }
}

export function upsertAuthUser(authUser: {
  user_id: string;
  email: string;
  name: string;
  photo_url?: string | null;
}): UserRow {
  const db = getDb();
  const normalizedEmail = authUser.email.trim().toLowerCase();
  let existing = db.users.find((u) => u.user_id === authUser.user_id);
  let dirty = false;

  if (!existing) {
    existing = {
      user_id: authUser.user_id,
      email: normalizedEmail,
      name: authUser.name || normalizedEmail.split("@")[0],
      photo_url: authUser.photo_url ?? null,
    };
    db.users.push(existing);
    dirty = true;
  } else {
    if (existing.email !== normalizedEmail || existing.name !== authUser.name || existing.photo_url !== (authUser.photo_url ?? null)) {
      existing.email = normalizedEmail;
      existing.name = authUser.name || existing.name;
      existing.photo_url = authUser.photo_url ?? existing.photo_url ?? null;
      dirty = true;
    }
  }

  // Link any pending email invitations across projects to this user_id
  for (const proj of db.projects) {
    for (const m of proj.members) {
      if (m.email.toLowerCase() === normalizedEmail && (m.user_id !== existing.user_id || m.name !== existing.name)) {
        m.user_id = existing.user_id;
        m.name = existing.name;
        dirty = true;
      }
    }
  }

  if (dirty) saveDb();
  return existing;
}

export function getProjectRole(p: StoredProject, user: UserRow): Role | null {
  if (p.owner_id === user.user_id) return "admin";
  const emailLow = user.email.toLowerCase();
  const found = p.members.find((m) => m.user_id === user.user_id || m.email.toLowerCase() === emailLow);
  return found ? found.role : null;
}

export function projectVisible(p: StoredProject, user: UserRow): boolean {
  return getProjectRole(p, user) !== null;
}

export function projectCounts(p: StoredProject, user: UserRow): Project {
  const db = getDb();
  const dsIds = db.datasets.filter((d) => d.project_id === p.id).map((d) => d.id);
  const dsSet = new Set(dsIds);
  const myRole = getProjectRole(p, user) ?? "capturador";

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    owner_id: p.owner_id,
    members: p.members.map((m) => ({ ...m, pending: !m.user_id })),
    my_role: myRole,
    created_at: p.created_at,
    dataset_count: dsIds.length,
    form_count: db.forms.filter((f) => f.project_id === p.id).length,
    record_count: db.rows.filter((r) => dsSet.has(r.dataset_id)).length,
    can_edit: myRole === "admin" || myRole === "investigador",
    can_manage_team: myRole === "admin",
  };
}

export function formWithCount(f: StoredForm): Form {
  const db = getDb();
  return {
    ...f,
    record_count: db.rows.filter((r) => r.dataset_id === f.dataset_id).length,
  };
}

export function getDatasetRows(datasetId: string): Record<string, Cell>[] {
  const db = getDb();
  return db.rows
    .filter((r) => r.dataset_id === datasetId)
    .sort((a, b) => a.seq - b.seq)
    .map((r) => r.data);
}

export function toRecordOut(r: StoredRow): RecordOut {
  return {
    id: r.id,
    dataset_id: r.dataset_id,
    data: r.data,
    created_at: r.created_at,
    created_by: r.created_by,
  };
}
