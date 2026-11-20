import type { AnalysisResult, Cell } from "../src/lib/types.ts";

export interface NarrativeVerificationResult {
  ok: boolean;
  resolvedText: string;
  unverifiedNumbers: string[];
  safeText: string;
}

const STANDARD_METHOD_NUMBERS = new Set([
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "10",
  "95",
  "99",
  "100",
  "0.05",
  "0.01",
  "0.001",
  "0.1",
  "0.2",
  "0.5",
  "0.8",
  "0.80",
  "0.95",
  "1.5",
]);

function normalizeNumToken(raw: string): string | null {
  const cleaned = raw.replace(/−/g, "-").replace(/,/g, ".").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

function addNumberVariants(target: Set<string>, rawText: string): void {
  const matches = rawText.match(/-?\d+(?:[.,]\d+)?/g);
  if (!matches) return;
  for (const m of matches) {
    const norm = normalizeNumToken(m);
    if (norm === null) continue;
    const n = Number(norm);
    const absN = Math.abs(n);
    target.add(norm);
    target.add(String(absN));
    for (const d of [0, 1, 2, 3, 4]) {
      target.add(n.toFixed(d));
      target.add(absN.toFixed(d));
      target.add(String(Number(n.toFixed(d))));
      target.add(String(Number(absN.toFixed(d))));
    }
    // Percentage <-> proportion equivalence (e.g., 0.452 <-> 45.2%)
    if (absN > 0 && absN <= 1) {
      const pct = absN * 100;
      for (const d of [0, 1, 2]) {
        target.add(pct.toFixed(d));
        target.add(String(Number(pct.toFixed(d))));
      }
    } else if (absN > 1 && absN <= 100) {
      const prop = absN / 100;
      for (const d of [2, 3, 4]) {
        target.add(prop.toFixed(d));
        target.add(String(Number(prop.toFixed(d))));
      }
    }
  }
}

export function extractAllowedNumbers(result: AnalysisResult): Set<string> {
  const allowed = new Set<string>(STANDARD_METHOD_NUMBERS);

  addNumberVariants(allowed, result.title ?? "");
  addNumberVariants(allowed, result.summary ?? "");

  for (const tbl of result.tables ?? []) {
    addNumberVariants(allowed, tbl.title ?? "");
    addNumberVariants(allowed, tbl.note ?? "");
    for (const col of tbl.columns ?? []) addNumberVariants(allowed, String(col));
    for (const row of tbl.rows ?? []) {
      for (const cell of row) {
        if (cell === null || cell === undefined) continue;
        addNumberVariants(allowed, String(cell));
      }
    }
  }

  for (const ch of result.charts ?? []) {
    addNumberVariants(allowed, ch.title ?? "");
    if (ch.meta) addNumberVariants(allowed, JSON.stringify(ch.meta));
    for (const pt of (ch.data ?? []).slice(0, 200)) {
      for (const val of Object.values(pt)) {
        if (typeof val === "number" || typeof val === "string") {
          addNumberVariants(allowed, String(val));
        }
      }
    }
  }

  if (result.provenance) {
    const provExtra = result.provenance as unknown as Record<string, unknown>;
    if (typeof provExtra.n_rows === "number") addNumberVariants(allowed, String(provExtra.n_rows));
    for (const w of result.provenance.warnings ?? []) addNumberVariants(allowed, w);
  }

  return allowed;
}

export function resolveAnalysisPlaceholders(text: string, result: AnalysisResult): string {
  if (!text.includes("{{")) return text;
  return text.replace(/\{\{\s*(?:resultado|result)\.([^}]+?)\s*\}\}/gi, (_full, expr: string) => {
    const clean = expr.trim();
    if (clean === "summary" || clean === "resumen") return result.summary;
    if (clean === "title" || clean === "titulo") return result.title;
    if (clean === "test" || clean === "prueba") return result.test;

    const tblCellMatch = clean.match(/^(?:tables?|tablas?)\[(\d+)\]\.(?:rows|filas)\[(\d+)\](?:\.(?:cols?|columnas?))?\[(\d+)\]$/i);
    if (tblCellMatch) {
      const ti = Number(tblCellMatch[1]);
      const ri = Number(tblCellMatch[2]);
      const ci = Number(tblCellMatch[3]);
      const val: Cell | undefined = result.tables?.[ti]?.rows?.[ri]?.[ci];
      return val === null || val === undefined ? "—" : String(val);
    }

    const tblNoteMatch = clean.match(/^(?:tables?|tablas?)\[(\d+)\]\.note$/i);
    if (tblNoteMatch) {
      return result.tables?.[Number(tblNoteMatch[1])]?.note ?? "";
    }

    return "[dato no disponible]";
  });
}

function stripStructuralTokens(text: string, result: AnalysisResult): string {
  let s = text;
  // Remove markdown list prefixes (e.g. "1. ", "2) ") and markdown heading markers ("### ")
  s = s.replace(/(^|\n)\s*\d+[.)]\s+/g, "$1 ");
  // Remove references to variable names from the result titles/columns so e.g. "var_1" or "Q1-Q3" don't false-trigger
  const protectedLabels = new Set<string>(["IC 95%", "IC95%", "Q1", "Q3", "H0", "H1", "2x2", "2×2", "5-fold", "R²", "χ²", "τ-b"]);
  for (const tbl of result.tables ?? []) {
    for (const c of tbl.columns ?? []) protectedLabels.add(String(c));
    for (const r of tbl.rows ?? []) {
      if (r[0] !== null && r[0] !== undefined) protectedLabels.add(String(r[0]));
    }
  }
  for (const lbl of protectedLabels) {
    if (!lbl || lbl.length < 2) continue;
    const escaped = lbl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(escaped, "g"), " ");
  }
  // Remove alphanumeric identifiers containing digits (e.g., "t1", "paso_2", "n1", "n2", "IC95")
  s = s.replace(/\b[A-Za-zÁÉÍÓÚáéíóúÑñ_]+\d+[A-Za-z0-9_]*\b/g, " ");
  // Remove Tabla 1 / Tabla 2 / Paso 1 / FASE 2 style labels
  s = s.replace(/\b(?:Tabla|Cuadro|Figura|Gráfico|Paso|Nivel|Grupo)\s+\d+\b/gi, " ");
  return s;
}

export function buildAuditedFallbackNarrative(result: AnalysisResult): string {
  const lines: string[] = [
    `### ${result.title}`,
    "",
    `**Resumen estadístico verificado (Avicena):** ${result.summary}`,
  ];

  const primaryTbl = result.tables?.[0];
  if (primaryTbl && primaryTbl.rows.length > 0) {
    lines.push("", `**${primaryTbl.title}**`);
    for (const row of primaryTbl.rows.slice(0, 6)) {
      const cells = primaryTbl.columns
        .map((col, idx) => `${col}: ${row[idx] ?? "—"}`)
        .join(" · ");
      lines.push(`- ${cells}`);
    }
    if (primaryTbl.note) {
      lines.push("", `*Nota metodológica:* ${primaryTbl.note}`);
    }
  }

  return lines.join("\n");
}

export function verifyNarrativeAgainstResult(rawText: string, result: AnalysisResult): NarrativeVerificationResult {
  const resolvedText = resolveAnalysisPlaceholders(rawText, result).trim();
  if (!resolvedText) {
    const safe = buildAuditedFallbackNarrative(result);
    return { ok: false, resolvedText: "", unverifiedNumbers: ["(vacío)"], safeText: safe };
  }

  const allowed = extractAllowedNumbers(result);
  const scanTarget = stripStructuralTokens(resolvedText, result);
  const rawNums = scanTarget.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
  const unverified: string[] = [];

  for (const tok of rawNums) {
    const norm = normalizeNumToken(tok);
    if (norm === null) continue;
    const absNorm = String(Math.abs(Number(norm)));
    if (!allowed.has(norm) && !allowed.has(absNorm)) {
      if (!unverified.includes(tok)) unverified.push(tok);
    }
  }

  if (unverified.length === 0) {
    return { ok: true, resolvedText, unverifiedNumbers: [], safeText: resolvedText };
  }

  return {
    ok: false,
    resolvedText,
    unverifiedNumbers: unverified,
    safeText: `${buildAuditedFallbackNarrative(result)}\n\n> *Nota de verificación numérica:* se omitieron cifras redactadas por el asistente (${unverified.join(", ")}) que no figuraban literalmente en los resultados calculados por el motor estadístico.`,
  };
}
