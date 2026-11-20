import crypto from "node:crypto";
import { matchKnownOrdinalScale, sortLevelsSmart } from "../src/lib/statAssumptions.ts";
import type { Cell, FieldType, FormField, VarType, Variable } from "../src/lib/types.ts";

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

const ORDINAL_COL_HINT = /(^|_)(eva|vas|escala|grado|estadio|nyha|ecog|killip|rankin|asa|likert|severidad|gravedad)(_|$)/i;

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
        } else if (
          ORDINAL_COL_HINT.test(col) &&
          uniq.size >= 3 &&
          uniq.size <= 11 &&
          Array.from(uniq).every((u) => Number.isInteger(u))
        ) {
          vtype = "ordinal";
        } else if (uniq.size <= 6 && Array.from(uniq).every((u) => Number.isInteger(u)) && nonNull.length > 30) {
          vtype = "categorical";
        } else {
          vtype = "numeric";
        }
      } else {
        const strVals = nonNull.map((v) => String(v).trim());
        const uniq = new Set(strVals);
        const dateFrac =
          strVals.filter((s) => /^\d{4}-\d{2}-\d{2}/.test(s) || (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s) && !Number.isNaN(Date.parse(s)))).length /
          strVals.length;
        if (dateFrac > 0.9) {
          vtype = "date";
        } else if (uniq.size === 2) {
          vtype = "binary";
        } else if (matchKnownOrdinalScale(strVals)) {
          vtype = "ordinal";
        } else if (uniq.size <= Math.max(12, Math.floor(0.05 * nonNull.length))) {
          vtype = "categorical";
        } else {
          vtype = "text";
        }
      }
    }
    const levels =
      vtype === "categorical" || vtype === "binary" || vtype === "ordinal"
        ? sortLevelsSmart(nonNull.map((v) => String(v).trim())).slice(0, 50)
        : [];
    return { name: col, label: "", type: vtype, levels };
  });
}

export function recomputeLevels(variables: Variable[], rows: Record<string, Cell>[]): Variable[] {
  return variables.map((v) => {
    if (v.type === "categorical" || v.type === "binary" || v.type === "ordinal") {
      const observed = rows
        .map((r) => r[v.name])
        .filter((val) => val !== null && val !== undefined && val !== "")
        .map((val) => String(val).trim());
      const levels = sortLevelsSmart(observed, v.type === "ordinal" ? v.levels : undefined).slice(0, 50);
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
    levels: f.type === "yesno" ? ["0", "1"] : f.choices?.length ? f.choices.slice(0, 50) : [],
  }));
}
