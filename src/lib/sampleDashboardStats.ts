import type { Cell, DatasetRowItem, Variable } from "./types.ts";

export function toNumeric(v: Cell | undefined): number | null {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

export function toCategoryLabel(v: Cell | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "Sí" : "No";
  const s = String(v).trim();
  return s === "" ? null : s;
}

function round(x: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

function pearsonStats(x: number[], y: number[]): { r: number; p: number } {
  const n = x.length;
  if (n < 3) return { r: NaN, p: NaN };
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx <= 0 || dy <= 0) return { r: 0, p: 1 };
  const r = Math.max(-1, Math.min(1, num / Math.sqrt(dx * dy)));
  if (Math.abs(r) >= 0.999999) return { r, p: 0 };
  const t = Math.abs(r) * Math.sqrt((n - 2) / (1 - r * r));
  // Accurate two-sided p via z-transform / t-approx for df >= 1
  const df = n - 2;
  const zApprox = df > 30 ? t : t * (1 - 1 / (4 * df)) / Math.sqrt(1 + (t * t) / (2 * df));
  const p = Math.min(1, Math.max(0, 2 * (1 - normalCdf(zApprox))));
  return { r, p };
}

function averageRanks(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) {
      j++;
    }
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      ranks[indexed[k].i] = avgRank;
    }
    i = j + 1;
  }
  return ranks;
}

export interface CategorySlice {
  category: string;
  count: number;
  pct: number;
}

export interface CategoricalSummary {
  varName: string;
  label: string;
  valid: number;
  missing: number;
  slices: CategorySlice[];
}

export function computeCategoricalSummary(
  items: DatasetRowItem[],
  variable: Variable,
  maxSlices = 8
): CategoricalSummary {
  const counts = new Map<string, number>();
  let valid = 0;
  let missing = 0;

  for (const it of items) {
    const lbl = toCategoryLabel(it.data[variable.name]);
    if (lbl === null) {
      missing++;
    } else {
      valid++;
      counts.set(lbl, (counts.get(lbl) ?? 0) + 1);
    }
  }

  const sorted =
    variable.type === "ordinal" && variable.levels.length > 0
      ? Array.from(counts.entries()).sort((a, b) => {
          const ia = variable.levels.indexOf(a[0]);
          const ib = variable.levels.indexOf(b[0]);
          if (ia !== -1 && ib !== -1) return ia - ib;
          if (ia !== -1) return -1;
          if (ib !== -1) return 1;
          return a[0].localeCompare(b[0], "es");
        })
      : Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  let slices: CategorySlice[];
  if (sorted.length > maxSlices) {
    const head = sorted.slice(0, maxSlices - 1);
    const otherCount = sorted.slice(maxSlices - 1).reduce((s, [, c]) => s + c, 0);
    slices = [
      ...head.map(([category, count]) => ({
        category,
        count,
        pct: valid > 0 ? round((count / valid) * 100, 1) : 0,
      })),
      {
        category: "Otras categorías",
        count: otherCount,
        pct: valid > 0 ? round((otherCount / valid) * 100, 1) : 0,
      },
    ];
  } else {
    slices = sorted.map(([category, count]) => ({
      category,
      count,
      pct: valid > 0 ? round((count / valid) * 100, 1) : 0,
    }));
  }

  return {
    varName: variable.name,
    label: variable.label || variable.name,
    valid,
    missing,
    slices,
  };
}

export interface NumericHistogramSummary {
  varName: string;
  label: string;
  n: number;
  missing: number;
  mean: number;
  sd: number;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
  bins: Array<{ bin: string; count: number }>;
}

export function computeNumericSummary(items: DatasetRowItem[], variable: Variable): NumericHistogramSummary | null {
  const nums: number[] = [];
  let missing = 0;
  for (const it of items) {
    const val = toNumeric(it.data[variable.name]);
    if (val === null) missing++;
    else nums.push(val);
  }
  if (!nums.length) return null;

  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;
  const m = nums.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? nums.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1) : 0;
  const s = Math.sqrt(variance);
  const min = sorted[0];
  const max = sorted[n - 1];
  const k = Math.max(4, Math.min(12, Math.ceil(1 + 3.322 * Math.log10(Math.max(2, n)))));
  const span = max - min;
  const bins: Array<{ bin: string; count: number }> = [];

  if (span <= 0) {
    bins.push({ bin: String(round(min, 2)), count: n });
  } else {
    const width = span / k;
    for (let i = 0; i < k; i++) {
      const lo = min + i * width;
      const hi = i === k - 1 ? max : min + (i + 1) * width;
      const count = sorted.filter((v) => (i === k - 1 ? v >= lo && v <= hi : v >= lo && v < hi)).length;
      const labelLo = Number.isInteger(lo) ? String(lo) : round(lo, 1).toString();
      const labelHi = Number.isInteger(hi) ? String(hi) : round(hi, 1).toString();
      bins.push({ bin: `${labelLo}–${labelHi}`, count });
    }
  }

  return {
    varName: variable.name,
    label: variable.label || variable.name,
    n,
    missing,
    mean: round(m, 2),
    sd: round(s, 2),
    median: round(quantile(sorted, 0.5), 2),
    q1: round(quantile(sorted, 0.25), 2),
    q3: round(quantile(sorted, 0.75), 2),
    min: round(min, 2),
    max: round(max, 2),
    bins,
  };
}

export interface GroupBoxSummary {
  group: string;
  n: number;
  mean: number;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
}

export function computeNumericByGroup(
  items: DatasetRowItem[],
  numVar: string,
  groupVar: string
): GroupBoxSummary[] {
  const buckets = new Map<string, number[]>();
  for (const it of items) {
    const val = toNumeric(it.data[numVar]);
    const grp = toCategoryLabel(it.data[groupVar]);
    if (val === null || grp === null) continue;
    const list = buckets.get(grp);
    if (list) list.push(val);
    else buckets.set(grp, [val]);
  }
  const out: GroupBoxSummary[] = [];
  for (const [group, vals] of buckets.entries()) {
    const sorted = [...vals].sort((a, b) => a - b);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    out.push({
      group,
      n: vals.length,
      mean: round(m, 2),
      median: round(quantile(sorted, 0.5), 2),
      q1: round(quantile(sorted, 0.25), 2),
      q3: round(quantile(sorted, 0.75), 2),
      min: round(sorted[0], 2),
      max: round(sorted[sorted.length - 1], 2),
    });
  }
  return out.sort((a, b) => b.n - a.n).slice(0, 10);
}

export interface CorrelationCell {
  rowVar: string;
  colVar: string;
  r: number | null;
  p: number | null;
  n: number;
}

export interface CorrelationOverview {
  vars: string[];
  cells: CorrelationCell[];
  strongestPair: { xVar: string; yVar: string; r: number; p: number; n: number } | null;
}

export function computeCorrelationOverview(
  items: DatasetRowItem[],
  numVars: Variable[],
  method: "pearson" | "spearman"
): CorrelationOverview {
  const vars = numVars.slice(0, 8).map((v) => v.name);
  const cells: CorrelationCell[] = [];
  let strongestPair: { xVar: string; yVar: string; r: number; p: number; n: number } | null = null;

  for (let i = 0; i < vars.length; i++) {
    const v1 = vars[i];
    for (let j = 0; j < vars.length; j++) {
      const v2 = vars[j];
      if (v1 === v2) {
        cells.push({ rowVar: v1, colVar: v2, r: 1, p: 0, n: items.length });
        continue;
      }
      const x: number[] = [];
      const y: number[] = [];
      for (const it of items) {
        const xv = toNumeric(it.data[v1]);
        const yv = toNumeric(it.data[v2]);
        if (xv !== null && yv !== null) {
          x.push(xv);
          y.push(yv);
        }
      }
      if (x.length < 3) {
        cells.push({ rowVar: v1, colVar: v2, r: null, p: null, n: x.length });
        continue;
      }
      const stats =
        method === "pearson"
          ? pearsonStats(x, y)
          : pearsonStats(averageRanks(x), averageRanks(y));
      const rRounded = Number.isFinite(stats.r) ? round(stats.r, 3) : null;
      const pRounded = Number.isFinite(stats.p) ? round(stats.p, 4) : null;
      cells.push({ rowVar: v1, colVar: v2, r: rRounded, p: pRounded, n: x.length });
      if (
        i < j &&
        rRounded !== null &&
        pRounded !== null &&
        (!strongestPair || Math.abs(rRounded) > Math.abs(strongestPair.r))
      ) {
        strongestPair = { xVar: v1, yVar: v2, r: rRounded, p: pRounded, n: x.length };
      }
    }
  }

  return { vars, cells, strongestPair };
}

export interface ScatterPairResult {
  points: Array<{ x: number; y: number; group: string }>;
  r: number | null;
  r2: number | null;
  p: number | null;
  n: number;
  slope: number;
  intercept: number;
  xmin: number;
  xmax: number;
}

export function computeScatterPair(
  items: DatasetRowItem[],
  xVar: string,
  yVar: string,
  method: "pearson" | "spearman",
  groupVar?: string
): ScatterPairResult {
  const x: number[] = [];
  const y: number[] = [];
  const points: Array<{ x: number; y: number; group: string }> = [];

  for (const it of items) {
    const xv = toNumeric(it.data[xVar]);
    const yv = toNumeric(it.data[yVar]);
    if (xv !== null && yv !== null) {
      x.push(xv);
      y.push(yv);
      if (points.length < 600) {
        const grp = groupVar ? toCategoryLabel(it.data[groupVar]) ?? "Sin grupo" : "Cohorte";
        points.push({ x: round(xv, 3), y: round(yv, 3), group: grp });
      }
    }
  }

  if (x.length < 2) {
    return { points, r: null, r2: null, p: null, n: x.length, slope: 0, intercept: 0, xmin: 0, xmax: 0 };
  }

  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const stats =
    x.length >= 3
      ? method === "pearson"
        ? pearsonStats(x, y)
        : pearsonStats(averageRanks(x), averageRanks(y))
      : { r: NaN, p: NaN };

  return {
    points,
    r: Number.isFinite(stats.r) ? round(stats.r, 3) : null,
    r2: Number.isFinite(stats.r) ? round(stats.r * stats.r, 3) : null,
    p: Number.isFinite(stats.p) ? round(stats.p, 4) : null,
    n: x.length,
    slope: round(slope, 4),
    intercept: round(intercept, 4),
    xmin: Math.min(...x),
    xmax: Math.max(...x),
  };
}

export interface VariableCompletenessItem {
  name: string;
  label: string;
  type: Variable["type"];
  valid: number;
  missing: number;
  pct: number;
}

export function computeVariableCompleteness(
  items: DatasetRowItem[],
  variables: Variable[]
): VariableCompletenessItem[] {
  const total = items.length;
  return variables.map((v) => {
    let valid = 0;
    for (const it of items) {
      const val = it.data[v.name];
      if (val !== null && val !== undefined && String(val).trim() !== "") {
        valid++;
      }
    }
    const missing = total - valid;
    return {
      name: v.name,
      label: v.label || v.name,
      type: v.type,
      valid,
      missing,
      pct: total > 0 ? round((valid / total) * 100, 1) : 0,
    };
  });
}

export interface RecruitmentPoint {
  fecha: string;
  nuevos: number;
  acumulados: number;
}

export function computeRecruitmentSeries(
  items: DatasetRowItem[],
  variables: Variable[]
): { sourceLabel: string; points: RecruitmentPoint[] } | null {
  const dateVar = variables.find((v) => v.type === "date");
  const dateCounts = new Map<string, number>();
  let sourceLabel = "Fecha de registro CRF";

  if (dateVar) {
    for (const it of items) {
      const raw = it.data[dateVar.name];
      if (raw === null || raw === undefined) continue;
      const str = String(raw).trim();
      const m = str.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) {
        dateCounts.set(m[1], (dateCounts.get(m[1]) ?? 0) + 1);
      }
    }
    if (dateCounts.size >= 2) {
      sourceLabel = `Variable: ${dateVar.label || dateVar.name}`;
    } else {
      dateCounts.clear();
    }
  }

  if (dateCounts.size === 0) {
    for (const it of items) {
      if (!it.created_at) continue;
      const day = it.created_at.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        dateCounts.set(day, (dateCounts.get(day) ?? 0) + 1);
      }
    }
  }

  if (dateCounts.size < 1) return null;
  const sortedDays = Array.from(dateCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  let acc = 0;
  const points = sortedDays.map(([fecha, nuevos]) => {
    acc += nuevos;
    return { fecha, nuevos, acumulados: acc };
  });
  return { sourceLabel, points };
}
