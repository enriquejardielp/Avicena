import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type {
  Cell,
  ChatMessage,
  Dataset,
  FormField,
  FormIn,
  Role,
  TestName,
  UserRow,
  VarType,
} from "./src/lib/types.ts";
import { verifyFirebaseIdToken } from "./server/firebaseAuth.ts";
import {
  cleanCell,
  formVariables,
  formWithCount,
  getDatasetRows,
  getDb,
  getProjectRole,
  inferVariables,
  nowIso,
  projectCounts,
  projectVisible,
  recomputeLevels,
  saveDb,
  toRecordOut,
  uid,
  upsertAuthUser,
  type StoredForm,
  type StoredProject,
  type StoredRow,
} from "./server/store.ts";
import { runStatTest, StatsError } from "./server/statsEngine.ts";
import { runGeminiCopilot } from "./server/geminiCopilot.ts";

interface AuthedRequest extends Request {
  member?: UserRow;
}

const VALID_ROLES: Role[] = ["admin", "investigador", "capturador"];
const VALID_VAR_TYPES: VarType[] = ["numeric", "categorical", "binary", "date", "text"];

async function withMember(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.header("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ detail: "Inicia sesión para acceder a Avicena." });
    return;
  }
  try {
    const verified = await verifyFirebaseIdToken(match[1].trim());
    req.member = upsertAuthUser({
      user_id: verified.uid,
      email: verified.email,
      name: verified.name,
      photo_url: verified.picture,
    });
    next();
  } catch {
    res.status(401).json({ detail: "Tu sesión ha expirado o no es válida. Inicia sesión de nuevo." });
  }
}

function isProjectAnalyst(p: StoredProject, member: UserRow): boolean {
  const role = getProjectRole(p, member);
  return role === "admin" || role === "investigador";
}

function isProjectAdmin(p: StoredProject, member: UserRow): boolean {
  return getProjectRole(p, member) === "admin";
}

function canCaptureProject(p: StoredProject, member: UserRow): boolean {
  return getProjectRole(p, member) !== null;
}

function getProjectOr404(projectId: string, member: UserRow, res: Response): StoredProject | null {
  const db = getDb();
  const p = db.projects.find((item) => item.id === projectId);
  if (!p || !projectVisible(p, member)) {
    res.status(404).json({ detail: "Estudio no encontrado o sin acceso." });
    return null;
  }
  return p;
}

function getDatasetOr404(datasetId: string, member: UserRow, res: Response): { ds: Dataset; proj: StoredProject } | null {
  const db = getDb();
  const ds = db.datasets.find((d) => d.id === datasetId);
  if (!ds) {
    res.status(404).json({ detail: "Base de datos no encontrada." });
    return null;
  }
  const proj = db.projects.find((p) => p.id === ds.project_id);
  if (!proj || !projectVisible(proj, member)) {
    res.status(403).json({ detail: "No tienes acceso a este estudio." });
    return null;
  }
  return { ds, proj };
}

function getFormOr404(formId: string, member: UserRow, res: Response): { form: StoredForm; proj: StoredProject } | null {
  const db = getDb();
  const form = db.forms.find((f) => f.id === formId);
  if (!form) {
    res.status(404).json({ detail: "Formulario no encontrado." });
    return null;
  }
  const proj = db.projects.find((p) => p.id === form.project_id);
  if (!proj || !projectVisible(proj, member)) {
    res.status(403).json({ detail: "No tienes acceso a este formulario." });
    return null;
  }
  return { form, proj };
}

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
  const buf = Buffer.from(base64Content, "base64");
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

  const origKeys = Object.keys(rawRows[0] ?? {});
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

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT ?? 3000);

  // Warm database (starts empty with zero demo users or demo projects)
  getDb();

  app.use(express.json({ limit: "25mb" }));

  const api = express.Router();
  api.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, service: "avicena", timestamp: nowIso() });
  });
  api.use(withMember);

  // Current authenticated user profile
  api.get("/me", (req: AuthedRequest, res: Response) => {
    res.json(req.member);
  });

  // Projects (any authenticated user can create projects and becomes project admin)
  api.get("/projects", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const db = getDb();
    const visible = db.projects
      .filter((p) => projectVisible(p, member))
      .map((p) => projectCounts(p, member));
    res.json(visible);
  });

  api.post("/projects", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const name = String(req.body?.name ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    if (!name) {
      res.status(422).json({ detail: "El nombre del estudio es obligatorio." });
      return;
    }
    const db = getDb();
    const proj: StoredProject = {
      id: `proj-${uid().slice(0, 8)}`,
      name,
      description,
      owner_id: member.user_id,
      members: [
        {
          user_id: member.user_id,
          email: member.email,
          name: member.name,
          role: "admin",
          invited_at: nowIso(),
        },
      ],
      created_at: nowIso(),
    };
    db.projects.unshift(proj);
    saveDb();
    res.status(201).json(projectCounts(proj, member));
  });

  api.get("/projects/:id", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const p = getProjectOr404(req.params.id, member, res);
    if (!p) return;
    res.json(projectCounts(p, member));
  });

  api.put("/projects/:id", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const p = getProjectOr404(req.params.id, member, res);
    if (!p) return;
    if (!isProjectAnalyst(p, member)) {
      res.status(403).json({ detail: "No tienes permisos para editar este estudio." });
      return;
    }
    const name = String(req.body?.name ?? p.name).trim();
    const description = String(req.body?.description ?? p.description).trim();
    if (!name) {
      res.status(422).json({ detail: "El nombre del estudio no puede quedar vacío." });
      return;
    }
    p.name = name;
    p.description = description;
    saveDb();
    res.json(projectCounts(p, member));
  });

  api.delete("/projects/:id", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const p = getProjectOr404(req.params.id, member, res);
    if (!p) return;
    if (!isProjectAdmin(p, member)) {
      res.status(403).json({ detail: "Solo el Administrador del estudio puede eliminarlo." });
      return;
    }
    const db = getDb();
    const dsIds = new Set(db.datasets.filter((d) => d.project_id === p.id).map((d) => d.id));
    db.projects = db.projects.filter((item) => item.id !== p.id);
    db.datasets = db.datasets.filter((d) => d.project_id !== p.id);
    db.forms = db.forms.filter((f) => f.project_id !== p.id);
    db.rows = db.rows.filter((r) => !dsIds.has(r.dataset_id));
    db.chat_messages = db.chat_messages.filter((m) => !dsIds.has(m.dataset_id));
    saveDb();
    res.json({ ok: true });
  });

  // Project Members & Per-Project Role Sharing
  api.get("/projects/:id/members", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const p = getProjectOr404(req.params.id, member, res);
    if (!p) return;
    const db = getDb();
    const myRole = getProjectRole(p, member)!;
    const memberEmails = new Set(p.members.map((m) => m.email.toLowerCase()));
    const registeredUsers =
      myRole === "admin"
        ? db.users.filter((u) => u.user_id !== member.user_id && !memberEmails.has(u.email.toLowerCase()))
        : [];
    res.json({
      owner_id: p.owner_id,
      my_role: myRole,
      members: p.members.map((m) => ({ ...m, pending: !m.user_id })),
      registered_users: registeredUsers,
    });
  });

  api.post("/projects/:id/members", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const p = getProjectOr404(req.params.id, member, res);
    if (!p) return;
    if (!isProjectAdmin(p, member)) {
      res.status(403).json({ detail: "Solo el Administrador del estudio puede compartirlo y asignar roles." });
      return;
    }
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const role = String(req.body?.role ?? "investigador") as Role;
    const providedName = String(req.body?.name ?? "").trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(422).json({ detail: "Introduce un correo electrónico válido." });
      return;
    }
    if (!VALID_ROLES.includes(role)) {
      res.status(422).json({ detail: "Rol inválido. Elige Administrador, Investigador Principal o Capturador." });
      return;
    }

    const db = getDb();
    const existingUser = db.users.find((u) => u.email.toLowerCase() === email);
    const existingMember = p.members.find((m) => m.email.toLowerCase() === email);

    if (existingMember) {
      if (existingMember.user_id === p.owner_id && role !== "admin") {
        res.status(422).json({ detail: "El creador del estudio debe conservar el rol de Administrador." });
        return;
      }
      existingMember.role = role;
      if (existingUser) {
        existingMember.user_id = existingUser.user_id;
        existingMember.name = existingUser.name;
      }
      saveDb();
      res.json({ ...existingMember, pending: !existingMember.user_id });
      return;
    }

    const added = {
      user_id: existingUser?.user_id ?? null,
      email,
      name: existingUser?.name || providedName || email.split("@")[0],
      role,
      invited_at: nowIso(),
    };
    p.members.push(added);
    saveDb();
    res.status(201).json({ ...added, pending: !added.user_id });
  });

  api.patch("/projects/:id/members/:memberKey", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const p = getProjectOr404(req.params.id, member, res);
    if (!p) return;
    if (!isProjectAdmin(p, member)) {
      res.status(403).json({ detail: "Solo el Administrador del estudio puede cambiar roles." });
      return;
    }
    const role = String(req.body?.role ?? "") as Role;
    if (!VALID_ROLES.includes(role)) {
      res.status(422).json({ detail: "Rol inválido." });
      return;
    }
    const key = decodeURIComponent(req.params.memberKey).toLowerCase();
    const target = p.members.find((m) => (m.user_id && m.user_id.toLowerCase() === key) || m.email.toLowerCase() === key);
    if (!target) {
      res.status(404).json({ detail: "Miembro no encontrado en este estudio." });
      return;
    }
    if (target.user_id === p.owner_id && role !== "admin") {
      res.status(422).json({ detail: "El creador del estudio debe mantener el rol Administrador." });
      return;
    }
    target.role = role;
    saveDb();
    res.json({ ...target, pending: !target.user_id });
  });

  api.delete("/projects/:id/members/:memberKey", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const p = getProjectOr404(req.params.id, member, res);
    if (!p) return;
    if (!isProjectAdmin(p, member)) {
      res.status(403).json({ detail: "Solo el Administrador del estudio puede retirar miembros." });
      return;
    }
    const key = decodeURIComponent(req.params.memberKey).toLowerCase();
    const target = p.members.find((m) => (m.user_id && m.user_id.toLowerCase() === key) || m.email.toLowerCase() === key);
    if (!target) {
      res.status(404).json({ detail: "Miembro no encontrado en este estudio." });
      return;
    }
    if (target.user_id === p.owner_id) {
      res.status(422).json({ detail: "No se puede retirar al creador Administrador del estudio." });
      return;
    }
    p.members = p.members.filter((m) => m !== target);
    saveDb();
    res.json({ ok: true });
  });

  // Datasets
  api.get("/projects/:id/datasets", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const p = getProjectOr404(req.params.id, member, res);
    if (!p) return;
    if (!isProjectAnalyst(p, member)) {
      res.status(403).json({ detail: "El rol Capturador de datos solo accede a formularios asignados." });
      return;
    }
    const db = getDb();
    const list = db.datasets.filter((d) => d.project_id === p.id);
    res.json(list);
  });

  api.post("/projects/:id/datasets/upload", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const p = getProjectOr404(req.params.id, member, res);
    if (!p) return;
    if (!isProjectAnalyst(p, member)) {
      res.status(403).json({ detail: "No tienes permisos para cargar archivos en este estudio." });
      return;
    }
    const filename = String(req.body?.filename ?? "datos.csv");
    const contentBase64 = String(req.body?.contentBase64 ?? "");
    const customName = String(req.body?.name ?? "").trim();
    if (!contentBase64) {
      res.status(422).json({ detail: "El archivo está vacío." });
      return;
    }
    let parsedRows: Record<string, Cell>[];
    try {
      parsedRows = parseTabularFile(filename, contentBase64);
    } catch (err) {
      res.status(422).json({
        detail: `No se pudo leer el archivo (${err instanceof Error ? err.message : "formato inválido"}).`,
      });
      return;
    }
    if (!parsedRows.length) {
      res.status(422).json({ detail: "El archivo no contiene filas válidas." });
      return;
    }

    const db = getDb();
    const dsId = uid();
    const vars = inferVariables(parsedRows);
    const ds: Dataset = {
      id: dsId,
      project_id: p.id,
      name: customName || filename.replace(/\.(csv|xlsx|xls|txt)$/i, ""),
      source: "upload",
      form_id: null,
      variables: vars,
      n_rows: parsedRows.length,
      created_at: nowIso(),
    };
    db.datasets.unshift(ds);
    parsedRows.forEach((rec, i) => {
      db.rows.push({
        id: `${dsId}-${i}`,
        dataset_id: dsId,
        seq: i,
        data: rec,
        created_by: member.user_id,
        created_at: nowIso(),
      });
    });
    saveDb();
    res.status(201).json(ds);
  });

  api.get("/datasets/:id", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const found = getDatasetOr404(req.params.id, member, res);
    if (!found) return;
    if (!isProjectAnalyst(found.proj, member)) {
      res.status(403).json({ detail: "Sin permisos para consultar la sábana de datos." });
      return;
    }
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const q = String(req.query.q ?? "").trim().toLowerCase();

    let rows = getDatasetRows(found.ds.id);
    if (q) {
      rows = rows.filter((r) =>
        Object.values(r).some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q))
      );
    }
    const total = rows.length;
    res.json({
      dataset: found.ds,
      rows: rows.slice(offset, offset + limit),
      total,
    });
  });

  api.patch("/datasets/:id/variables/:varName", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const found = getDatasetOr404(req.params.id, member, res);
    if (!found) return;
    if (!isProjectAnalyst(found.proj, member)) {
      res.status(403).json({ detail: "Este estudio es de solo lectura para tu rol." });
      return;
    }
    const newType = req.body?.type as VarType | undefined;
    if (!newType || !VALID_VAR_TYPES.includes(newType)) {
      res.status(422).json({ detail: "Tipo de variable inválido." });
      return;
    }
    const v = found.ds.variables.find((item) => item.name === req.params.varName);
    if (!v) {
      res.status(404).json({ detail: "Variable no encontrada." });
      return;
    }
    v.type = newType;
    if (typeof req.body?.label === "string") {
      v.label = req.body.label.trim();
    }
    const rows = getDatasetRows(found.ds.id);
    found.ds.variables = recomputeLevels(found.ds.variables, rows);
    saveDb();
    res.json(found.ds);
  });

  api.get("/datasets/:id/export", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const found = getDatasetOr404(req.params.id, member, res);
    if (!found) return;
    if (!isProjectAnalyst(found.proj, member)) {
      res.status(403).json({ detail: "Sin permisos para exportar bases de datos." });
      return;
    }
    const rows = getDatasetRows(found.ds.id);
    const cols = found.ds.variables.map((v) => v.name);
    const csv = Papa.unparse({
      fields: cols,
      data: rows.map((r) => cols.map((c) => r[c] ?? "")),
    });
    const safeName = found.ds.name.replace(/[^a-zA-Z0-9_-]+/g, "_");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.csv"`);
    res.send(`\uFEFF${csv}`);
  });

  api.delete("/datasets/:id", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const found = getDatasetOr404(req.params.id, member, res);
    if (!found) return;
    if (!isProjectAnalyst(found.proj, member)) {
      res.status(403).json({ detail: "No tienes permisos para eliminar esta base de datos." });
      return;
    }
    if (found.ds.form_id) {
      res.status(422).json({ detail: "Esta base está vinculada a un formulario CRF; elimina el formulario para retirarla." });
      return;
    }
    const db = getDb();
    db.datasets = db.datasets.filter((d) => d.id !== found.ds.id);
    db.rows = db.rows.filter((r) => r.dataset_id !== found.ds.id);
    db.chat_messages = db.chat_messages.filter((m) => m.dataset_id !== found.ds.id);
    saveDb();
    res.json({ ok: true });
  });

  // Forms (Clinical CRF)
  api.get("/projects/:id/forms", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const p = getProjectOr404(req.params.id, member, res);
    if (!p) return;
    const db = getDb();
    const list = db.forms.filter((f) => f.project_id === p.id).map(formWithCount);
    res.json(list);
  });

  api.post("/projects/:id/forms", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const p = getProjectOr404(req.params.id, member, res);
    if (!p) return;
    if (!isProjectAnalyst(p, member)) {
      res.status(403).json({ detail: "No tienes permisos para crear formularios en este estudio." });
      return;
    }
    const body = req.body as FormIn;
    const name = String(body?.name ?? "").trim();
    const description = String(body?.description ?? "").trim();
    const fields = Array.isArray(body?.fields) ? body.fields : [];
    if (!name || !fields.length) {
      res.status(422).json({ detail: "El formulario requiere un título y al menos un campo clínico." });
      return;
    }
    const db = getDb();
    const dsId = uid();
    const fId = uid();
    const vars = formVariables(fields);
    const ds: Dataset = {
      id: dsId,
      project_id: p.id,
      name: `Formulario · ${name}`,
      source: "form",
      form_id: fId,
      variables: vars,
      n_rows: 0,
      created_at: nowIso(),
    };
    const form: StoredForm = {
      id: fId,
      project_id: p.id,
      dataset_id: dsId,
      name,
      description,
      fields,
      created_at: nowIso(),
    };
    db.datasets.push(ds);
    db.forms.push(form);
    saveDb();
    res.status(201).json(formWithCount(form));
  });

  api.get("/forms/:id", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const found = getFormOr404(req.params.id, member, res);
    if (!found) return;
    res.json(formWithCount(found.form));
  });

  api.put("/forms/:id", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const found = getFormOr404(req.params.id, member, res);
    if (!found) return;
    if (!isProjectAnalyst(found.proj, member)) {
      res.status(403).json({ detail: "No tienes permisos para editar este formulario." });
      return;
    }
    const body = req.body as FormIn;
    const name = String(body?.name ?? "").trim();
    const description = String(body?.description ?? "").trim();
    const fields = Array.isArray(body?.fields) ? body.fields : [];
    if (!name || !fields.length) {
      res.status(422).json({ detail: "El formulario requiere título y al menos un campo." });
      return;
    }
    found.form.name = name;
    found.form.description = description;
    found.form.fields = fields;

    const db = getDb();
    const ds = db.datasets.find((d) => d.id === found.form.dataset_id);
    if (ds) {
      ds.name = `Formulario · ${name}`;
      const rows = getDatasetRows(ds.id);
      ds.variables = recomputeLevels(formVariables(fields), rows);
    }
    saveDb();
    res.json(formWithCount(found.form));
  });

  api.delete("/forms/:id", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const found = getFormOr404(req.params.id, member, res);
    if (!found) return;
    if (!isProjectAnalyst(found.proj, member)) {
      res.status(403).json({ detail: "No tienes permisos para eliminar este formulario." });
      return;
    }
    const db = getDb();
    db.forms = db.forms.filter((f) => f.id !== found.form.id);
    db.datasets = db.datasets.filter((d) => d.id !== found.form.dataset_id);
    db.rows = db.rows.filter((r) => r.dataset_id !== found.form.dataset_id);
    db.chat_messages = db.chat_messages.filter((m) => m.dataset_id !== found.form.dataset_id);
    saveDb();
    res.json({ ok: true });
  });

  // Form Records (Clinical Capture)
  api.get("/forms/:id/records", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const found = getFormOr404(req.params.id, member, res);
    if (!found) return;
    const db = getDb();
    const role = getProjectRole(found.proj, member);
    let list = db.rows.filter((r) => r.dataset_id === found.form.dataset_id);
    if (role === "capturador") {
      list = list.filter((r) => r.created_by === member.user_id);
    }
    list.sort((a, b) => b.seq - a.seq);
    res.json(list.slice(0, 100).map(toRecordOut));
  });

  api.post("/forms/:id/records", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const found = getFormOr404(req.params.id, member, res);
    if (!found) return;
    if (!canCaptureProject(found.proj, member)) {
      res.status(403).json({ detail: "No tienes permisos para capturar pacientes en este estudio." });
      return;
    }

    const inputData = (req.body?.data ?? {}) as Record<string, unknown>;
    const cleanedRecord: Record<string, Cell> = {};

    for (const field of found.form.fields as FormField[]) {
      const raw = inputData[field.name];
      const isEmpty =
        raw === null ||
        raw === undefined ||
        (typeof raw === "string" && raw.trim() === "") ||
        (Array.isArray(raw) && raw.length === 0);

      if (field.required && isEmpty) {
        res.status(422).json({ detail: `El campo obligatorio «${field.label}» está vacío.` });
        return;
      }

      if (isEmpty) {
        cleanedRecord[field.name] = null;
        continue;
      }

      if (field.type === "number") {
        const num = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
        if (!Number.isFinite(num)) {
          res.status(422).json({ detail: `«${field.label}» debe ser un valor numérico válido.` });
          return;
        }
        if (field.min !== null && num < field.min) {
          res.status(422).json({
            detail: `«${field.label}» (${num}) es menor que el mínimo clínico permitido (${field.min}).`,
          });
          return;
        }
        if (field.max !== null && num > field.max) {
          res.status(422).json({
            detail: `«${field.label}» (${num}) supera el máximo clínico permitido (${field.max}).`,
          });
          return;
        }
        cleanedRecord[field.name] = Math.round(num * 10000) / 10000;
      } else if (field.type === "yesno") {
        if (raw === true || raw === 1 || raw === "1" || String(raw).toLowerCase() === "sí" || String(raw).toLowerCase() === "si") {
          cleanedRecord[field.name] = 1;
        } else {
          cleanedRecord[field.name] = 0;
        }
      } else if (field.type === "checkbox") {
        cleanedRecord[field.name] = Array.isArray(raw) ? raw.map(String).join(", ") : String(raw).trim();
      } else {
        cleanedRecord[field.name] = String(raw).trim();
      }
    }

    const db = getDb();
    const existing = db.rows.filter((r) => r.dataset_id === found.form.dataset_id);
    const nextSeq = existing.length ? Math.max(...existing.map((r) => r.seq)) + 1 : 0;
    const stored: StoredRow = {
      id: uid(),
      dataset_id: found.form.dataset_id,
      seq: nextSeq,
      data: cleanedRecord,
      created_by: member.user_id,
      created_at: nowIso(),
    };
    db.rows.push(stored);

    const ds = db.datasets.find((d) => d.id === found.form.dataset_id);
    if (ds) {
      const allRows = getDatasetRows(ds.id);
      ds.n_rows = allRows.length;
      ds.variables = recomputeLevels(ds.variables, allRows);
    }
    saveDb();
    res.status(201).json(toRecordOut(stored));
  });

  // Statistical Engine
  api.post("/analyze", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const datasetId = String(req.body?.dataset_id ?? "");
    const test = String(req.body?.test ?? "") as TestName;
    const params = (req.body?.params ?? {}) as Record<string, unknown>;

    const found = getDatasetOr404(datasetId, member, res);
    if (!found) return;
    if (!isProjectAnalyst(found.proj, member)) {
      res.status(403).json({ detail: "Solo Investigadores y Administradores del estudio pueden ejecutar análisis." });
      return;
    }

    const rows = getDatasetRows(found.ds.id);
    try {
      const result = runStatTest(test, rows, found.ds.variables, params);
      res.json(result);
    } catch (err) {
      if (err instanceof StatsError) {
        res.status(422).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: err instanceof Error ? err.message : "Error al ejecutar la prueba estadística." });
    }
  });

  // AI Copilot (Gemini SSE)
  api.get("/ai/messages/:datasetId", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const found = getDatasetOr404(req.params.datasetId, member, res);
    if (!found) return;
    if (!isProjectAnalyst(found.proj, member)) {
      res.status(403).json({ detail: "Sin permisos para consultar el Asistente IA." });
      return;
    }
    const db = getDb();
    const msgs = db.chat_messages.filter((m) => m.dataset_id === found.ds.id);
    res.json(msgs);
  });

  api.delete("/ai/messages/:datasetId", (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const found = getDatasetOr404(req.params.datasetId, member, res);
    if (!found) return;
    if (!isProjectAnalyst(found.proj, member)) {
      res.status(403).json({ detail: "Sin permisos para limpiar la conversación." });
      return;
    }
    const db = getDb();
    db.chat_messages = db.chat_messages.filter((m) => m.dataset_id !== found.ds.id);
    saveDb();
    res.json({ ok: true });
  });

  api.post("/ai/chat", async (req: AuthedRequest, res: Response) => {
    const member = req.member!;
    const datasetId = String(req.body?.dataset_id ?? "");
    const message = String(req.body?.message ?? "").trim();
    if (!message) {
      res.status(422).json({ detail: "Escribe una consulta clínica o estadística." });
      return;
    }
    const found = getDatasetOr404(datasetId, member, res);
    if (!found) return;
    if (!isProjectAnalyst(found.proj, member)) {
      res.status(403).json({ detail: "Solo Investigadores y Administradores del estudio pueden consultar al Asistente IA." });
      return;
    }

    const db = getDb();
    const pastMessages = db.chat_messages.filter((m) => m.dataset_id === found.ds.id);

    const userMsg: ChatMessage = {
      id: uid(),
      dataset_id: found.ds.id,
      user_id: member.user_id,
      role: "user",
      content: message,
      analysis: null,
      created_at: nowIso(),
    };
    db.chat_messages.push(userMsg);
    saveDb();

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const outcome = await runGeminiCopilot(found.ds, pastMessages, message, {
      onStatus: (text) => sendEvent("status", { text }),
      onAnalysis: (result) => sendEvent("analysis", result),
      onDelta: (text) => sendEvent("delta", { text }),
      onError: (text) => sendEvent("error", { text }),
    });

    const assistantMsg: ChatMessage = {
      id: uid(),
      dataset_id: found.ds.id,
      user_id: member.user_id,
      role: "assistant",
      content: outcome.content,
      analysis: outcome.analysis,
      created_at: nowIso(),
    };
    db.chat_messages.push(assistantMsg);
    saveDb();

    sendEvent("done", assistantMsg);
    res.end();
  });

  app.use("/api", api);

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== "production") {
    const disableHmr = process.env.DISABLE_HMR === "true";
    if (disableHmr) {
      app.get("/@vite/client", (_req: Request, res: Response) => {
        res.type("application/javascript").send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url) { return url; }
export class ErrorOverlay {}
`);
      });
    }

    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ...(disableHmr
          ? { hmr: false, ws: false }
          : { hmr: { server: httpServer }, ws: { server: httpServer } }),
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send("Build not found");
      }
    });
  }

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`Avicena server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start Avicena server:", err);
  process.exit(1);
});
