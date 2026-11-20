import { sortLevelsSmart, toNumericOrOrdinal } from "../src/lib/statAssumptions.ts";
import type { AnalysisResult, Cell, ResultChart, ResultTable, Variable, VarType } from "../src/lib/types.ts";

export class StatsAdvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatsError";
  }
}

function logGamma(z: number): number {
  const c = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -0.000005395239384953,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += c[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normCdfAdv(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function normInvAdv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let rVal: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= phigh) {
    q = p - 0.5;
    rVal = q * q;
    return (
      ((((((a[0] * rVal + a[1]) * rVal + a[2]) * rVal + a[3]) * rVal + a[4]) * rVal + a[5]) * q) /
      (((((b[0] * rVal + b[1]) * rVal + b[2]) * rVal + b[3]) * rVal + b[4]) * rVal + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

function betaCf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}

function betainc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betaCf(a, b, x)) / a;
  return 1 - (bt * betaCf(b, a, 1 - x)) / b;
}

function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 200; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 3e-14) return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

export function fPvalAdv(f: number, df1: number, df2: number): number {
  if (!Number.isFinite(f) || f < 0 || df1 <= 0 || df2 <= 0) return NaN;
  if (f === 0) return 1;
  const x = (df1 * f) / (df1 * f + df2);
  return Math.min(1, Math.max(0, 1 - betainc(df1 / 2, df2 / 2, x)));
}

export function chi2PvalAdv(chi2: number, df: number): number {
  if (!Number.isFinite(chi2) || chi2 < 0 || df <= 0) return NaN;
  if (chi2 === 0) return 1;
  return Math.min(1, Math.max(0, 1 - gammaP(df / 2, chi2 / 2)));
}

export function tPvalAdv(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return NaN;
  return Math.min(1, Math.max(0, betainc(df / 2, 0.5, df / (df + t * t))));
}

export function tCritAdv(df: number): number {
  if (df <= 0) return 1.96;
  let lo = 1.0;
  let hi = 20.0;
  while (tPvalAdv(hi, df) > 0.05 && hi < 1000) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (tPvalAdv(mid, df) > 0.05) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function fp(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return p < 0.001 ? "<0.001" : p.toFixed(3);
}

function rn(x: number | null | undefined, digits = 3): number | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  const f = Math.pow(10, digits);
  return Math.round(x * f) / f;
}

function toNum(v: Cell | undefined): number | null {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

function toLbl(v: Cell | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "1" : "0";
  const s = String(v).trim();
  return s === "" ? null : s;
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sd(arr: number[], m?: number): number {
  if (arr.length < 2) return NaN;
  const mu = m ?? mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - mu) ** 2, 0) / (arr.length - 1));
}

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function getLevels(vals: (string | null)[]): string[] {
  const uniq = Array.from(new Set(vals.filter((v): v is string => v !== null)));
  if (uniq.every((v) => Number.isFinite(Number(v)))) return uniq.sort((a, b) => Number(a) - Number(b));
  return uniq.sort((a, b) => a.localeCompare(b, "es"));
}

function invertMatrix(M: number[][]): number[][] | null {
  const n = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    const pivot = A[i][i];
    if (Math.abs(pivot) < 1e-12) return null;
    for (let j = 0; j < 2 * n; j++) A[i][j] /= pivot;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = A[k][i];
      for (let j = 0; j < 2 * n; j++) A[k][j] -= factor * A[i][j];
    }
  }
  return A.map((row) => row.slice(n));
}

function matMulVec(A: number[][], v: number[]): number[] {
  return A.map((row) => row.reduce((s, val, j) => s + val * v[j], 0));
}

function needCols(rows: Record<string, Cell>[], cols: (string | undefined)[]) {
  if (!rows.length) throw new StatsAdvError("La base de datos no tiene registros.");
  const keys = new Set(Object.keys(rows[0]));
  for (const c of cols) {
    if (!c || !keys.has(c)) throw new StatsAdvError(`Variable no encontrada: ${c || "(vacía)"}`);
  }
}

export function holmAdjust(pvals: number[]): number[] {
  const m = pvals.length;
  const idx = pvals.map((p, i) => ({ p: Number.isFinite(p) ? p : 1, i })).sort((a, b) => a.p - b.p);
  const out = new Array<number>(m).fill(1);
  let prevMax = 0;
  for (let k = 0; k < m; k++) {
    const adj = Math.min(1, Math.max(prevMax, (m - k) * idx[k].p));
    prevMax = adj;
    out[idx[k].i] = adj;
  }
  return out;
}

export function bhFdrAdjust(pvals: number[]): number[] {
  const m = pvals.length;
  const idx = pvals.map((p, i) => ({ p: Number.isFinite(p) ? p : 1, i })).sort((a, b) => a.p - b.p);
  const out = new Array<number>(m).fill(1);
  let prevMin = 1;
  for (let k = m - 1; k >= 0; k--) {
    const adj = Math.min(1, Math.min(prevMin, (m / (k + 1)) * idx[k].p));
    prevMin = adj;
    out[idx[k].i] = adj;
  }
  return out;
}

export function kendallTauB(x: number[], y: number[]): { tau: number; p: number } {
  const n = x.length;
  if (n < 3) return { tau: 0, p: 1 };
  let C = 0;
  let D = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[i] - x[j];
      const dy = y[i] - y[j];
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) {
        tx++;
      } else if (dy === 0) {
        ty++;
      } else if (dx * dy > 0) {
        C++;
      } else {
        D++;
      }
    }
  }
  const n0 = (n * (n - 1)) / 2;
  const denom = Math.sqrt(Math.max(1e-12, (n0 - tx) * (n0 - ty)));
  const tau = (C - D) / denom;
  const varTau = (2 * (2 * n + 5)) / (9 * n * (n - 1));
  const z = varTau > 0 ? tau / Math.sqrt(varTau) : 0;
  return { tau, p: 2 * (1 - normCdfAdv(Math.abs(z))) };
}

function wilsonCI(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function runOutlierDetection(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap: Map<string, Variable>
): Omit<AnalysisResult, "test"> {
  const vars = (params.vars as string[]) || [];
  const zThresh = Number(params.z_threshold ?? 3);
  if (!vars.length) throw new StatsAdvError("Selecciona al menos una variable numérica.");
  needCols(rows, vars);

  const summaryRows: Cell[][] = [];
  const detailRows: Cell[][] = [];
  const chartData: Record<string, Cell>[] = [];

  for (const v of vars) {
    const meta = varMap.get(v);
    const isOrd = meta?.type === "ordinal";
    const levels = isOrd ? sortLevelsSmart(rows.map((r) => toLbl(r[v])).filter((x): x is string => x !== null), meta?.levels) : [];
    const pairs: { idx: number; val: number }[] = [];
    rows.forEach((r, i) => {
      const val = toNumericOrOrdinal(r[v], levels, isOrd);
      if (val !== null) pairs.push({ idx: i + 1, val });
    });
    if (pairs.length < 4) continue;
    const vals = pairs.map((p) => p.val);
    const s = [...vals].sort((a, b) => a - b);
    const q1 = quantile(s, 0.25);
    const med = quantile(s, 0.5);
    const q3 = quantile(s, 0.75);
    const iqr = q3 - q1;
    const lo15 = q1 - 1.5 * iqr;
    const hi15 = q3 + 1.5 * iqr;
    const lo3 = q1 - 3.0 * iqr;
    const hi3 = q3 + 3.0 * iqr;
    const m = mean(vals);
    const sdv = sd(vals, m);
    const absDevs = vals.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
    const mad = quantile(absDevs, 0.5);
    const madScale = 1.4826 * mad;

    let iqrMod = 0;
    let iqrExt = 0;
    let zOut = 0;
    let madOut = 0;
    for (const p of pairs) {
      const isMod = p.val < lo15 || p.val > hi15;
      const isExt = p.val < lo3 || p.val > hi3;
      const z = sdv > 0 ? (p.val - m) / sdv : 0;
      const mz = madScale > 0 ? (p.val - med) / madScale : 0;
      if (isMod) iqrMod++;
      if (isExt) iqrExt++;
      if (Math.abs(z) > zThresh) zOut++;
      if (Math.abs(mz) > zThresh) madOut++;
      if ((isMod || Math.abs(z) > zThresh || Math.abs(mz) > zThresh) && detailRows.length < 50) {
        detailRows.push([v, p.idx, rn(p.val, 3), rn(z, 2), rn(mz, 2), isExt ? "Extremo (3×IQR)" : isMod ? "Moderado (1.5×IQR)" : "Z/MAD"]);
      }
    }

    // Grubbs single max deviation test
    let grubbsG = 0;
    let grubbsP = 1;
    if (sdv > 0 && vals.length >= 5) {
      grubbsG = Math.max(...vals.map((x) => Math.abs(x - m))) / sdv;
      const n = vals.length;
      const t2 = (grubbsG * grubbsG * n * (n - 2)) / Math.max(1e-9, (n - 1) * (n - 1) - n * grubbsG * grubbsG);
      grubbsP = Math.min(1, n * tPvalAdv(Math.sqrt(Math.max(0, t2)), n - 2));
    }

    summaryRows.push([
      v,
      vals.length,
      `${rn(lo15, 2)} – ${rn(hi15, 2)}`,
      iqrMod,
      iqrExt,
      zOut,
      madOut,
      `${rn(grubbsG, 2)} (p=${fp(grubbsP)})`,
    ]);
    chartData.push({ variable: v, "Atípicos IQR": iqrMod, "Atípicos Z": zOut, "Atípicos MAD": madOut });
  }

  if (!summaryRows.length) throw new StatsAdvError("No hay variables con suficientes observaciones numéricas (n ≥ 4).");

  const tables: ResultTable[] = [
    {
      title: "Resumen de valores atípicos por método",
      columns: ["Variable", "N", "Valla IQR (1.5×)", "Atípicos 1.5×IQR", "Extremos 3×IQR", `|Z| > ${zThresh}`, `|MAD-Z| > ${zThresh}`, "Grubbs G (p)"],
      rows: summaryRows,
      note: "Tukey 1.5×RIC y MAD robusto son preferibles ante distribuciones asimétricas.",
    },
  ];
  if (detailRows.length) {
    tables.push({
      title: "Registros atípicos identificados (máx. 50)",
      columns: ["Variable", "Fila", "Valor", "Z clásico", "Z robusto (MAD)", "Criterio"],
      rows: detailRows,
      note: "",
    });
  }

  return {
    title: `Detección de valores atípicos (${vars.join(", ")})`,
    tables,
    charts: [{ type: "groupedbar", title: "Conteo de atípicos por criterio", x: "variable", series: ["Atípicos IQR", "Atípicos Z", "Atípicos MAD"], data: chartData, meta: {} }],
    summary: `Evaluadas ${summaryRows.length} variable(s) con criterios IQR, Z-score, MAD robusto y prueba de Grubbs.`,
  };
}

export function runMissingAnalysis(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap: Map<string, Variable>
): Omit<AnalysisResult, "test"> {
  if (!rows.length) throw new StatsAdvError("La base de datos no tiene registros.");
  const reqVars = (params.vars as string[] | undefined)?.filter(Boolean);
  const targetVars = reqVars && reqVars.length ? reqVars : Array.from(varMap.keys());
  needCols(rows, targetVars);

  const nRows = rows.length;
  const tableRows: Cell[][] = [];
  const chartData: Record<string, Cell>[] = [];
  let totalMissing = 0;

  for (const v of targetVars) {
    let miss = 0;
    for (const r of rows) {
      if (toLbl(r[v]) === null) miss++;
    }
    totalMissing += miss;
    const pct = (100 * miss) / nRows;
    tableRows.push([v, varMap.get(v)?.type ?? "numeric", nRows - miss, miss, `${rn(pct, 1)}%`]);
    if (miss > 0 || chartData.length < 15) {
      chartData.push({ variable: v, "% Perdidos": rn(pct, 1) });
    }
  }

  let completeRows = 0;
  const patternMap = new Map<string, number>();
  for (const r of rows) {
    const missCols = targetVars.filter((v) => toLbl(r[v]) === null);
    if (missCols.length === 0) completeRows++;
    const key = missCols.length === 0 ? "Completo (0 perdidos)" : missCols.slice(0, 4).join(", ") + (missCols.length > 4 ? ` (+${missCols.length - 4})` : "");
    patternMap.set(key, (patternMap.get(key) ?? 0) + 1);
  }
  const patternRows: Cell[][] = Array.from(patternMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([pat, cnt]) => [pat, cnt, `${rn((100 * cnt) / nRows, 1)}%`]);

  const totalCells = nRows * targetVars.length;
  return {
    title: "Auditoría de valores perdidos (Missing Data)",
    tables: [
      {
        title: "Completitud por variable",
        columns: ["Variable", "Tipo", "Válidos", "Perdidos", "% Perdidos"],
        rows: tableRows,
        note: `Casos completos (sin ningún dato perdido en ${targetVars.length} variables): ${completeRows}/${nRows} (${rn((100 * completeRows) / nRows, 1)}%).`,
      },
      {
        title: "Patrones de valores perdidos más frecuentes",
        columns: ["Patrón de ausencia", "Registros", "% Cohorte"],
        rows: patternRows,
        note: "",
      },
    ],
    charts: [{ type: "bar", title: "Porcentaje de valores perdidos por variable", x: "variable", series: ["% Perdidos"], data: chartData, meta: {} }],
    summary: `Completitud global ${rn(100 - (100 * totalMissing) / Math.max(1, totalCells), 1)}%: ${completeRows}/${nRows} casos completos y ${totalMissing} celdas perdidas.`,
  };
}

export function runRmAnova(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap: Map<string, Variable>
): Omit<AnalysisResult, "test"> {
  const vars = (params.vars as string[]) || [];
  if (vars.length < 3) throw new StatsAdvError("ANOVA de medidas repetidas requiere al menos 3 momentos.");
  needCols(rows, vars);

  const series = vars.map((v) => {
    const meta = varMap.get(v);
    const isOrd = meta?.type === "ordinal";
    const lv = isOrd ? sortLevelsSmart(rows.map((r) => toLbl(r[v])).filter((x): x is string => x !== null), meta?.levels) : [];
    return rows.map((r) => toNumericOrOrdinal(r[v], lv, isOrd));
  });
  const complete: number[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const rowVals = series.map((s) => s[i]);
    if (rowVals.every((x) => x !== null)) complete.push(rowVals as number[]);
  }
  const N = complete.length;
  const k = vars.length;
  if (N < 3) throw new StatsAdvError("Se necesitan al menos 3 sujetos con mediciones completas en todos los momentos.");

  const grandMean = mean(complete.flat());
  const subjMeans = complete.map((r) => mean(r));
  const condMeans = Array.from({ length: k }, (_, j) => mean(complete.map((r) => r[j])));

  const ssTotal = complete.reduce((acc, r) => acc + r.reduce((s, x) => s + (x - grandMean) ** 2, 0), 0);
  const ssSubj = k * subjMeans.reduce((s, m) => s + (m - grandMean) ** 2, 0);
  const ssCond = N * condMeans.reduce((s, m) => s + (m - grandMean) ** 2, 0);
  const ssErr = Math.max(0, ssTotal - ssSubj - ssCond);

  const dfCond = k - 1;
  const dfErr = (N - 1) * (k - 1);
  const msCond = ssCond / dfCond;
  const msErr = dfErr > 0 ? ssErr / dfErr : 0;
  const fStat = msErr > 0 ? msCond / msErr : 0;
  const pF = fPvalAdv(fStat, dfCond, dfErr);
  const partialEta2 = ssCond + ssErr > 0 ? ssCond / (ssCond + ssErr) : 0;

  // Greenhouse-Geisser epsilon from double-centered covariance matrix
  const Ydc = complete.map((r, i) => r.map((x, j) => x - subjMeans[i] - condMeans[j] + grandMean));
  const S: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      let s = 0;
      for (let i = 0; i < N; i++) s += Ydc[i][a] * Ydc[i][b];
      S[a][b] = s / Math.max(1, N - 1);
    }
  }
  let traceS = 0;
  let sumS2 = 0;
  for (let a = 0; a < k; a++) {
    traceS += S[a][a];
    for (let b = 0; b < k; b++) sumS2 += S[a][b] * S[a][b];
  }
  const epsGG = sumS2 > 0 ? Math.min(1, Math.max(1 / (k - 1), (traceS * traceS) / ((k - 1) * sumS2))) : 1;
  const pGG = fPvalAdv(fStat, dfCond * epsGG, dfErr * epsGG);

  // Pairwise paired t-tests with Holm correction
  const rawPairs: { a: string; b: string; diff: number; p: number }[] = [];
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      const d = complete.map((r) => r[b] - r[a]);
      const dm = mean(d);
      const dsd = sd(d, dm);
      const se = dsd / Math.sqrt(N);
      const t = se > 0 ? dm / se : 0;
      rawPairs.push({ a: vars[a], b: vars[b], diff: dm, p: tPvalAdv(t, N - 1) });
    }
  }
  const adjP = holmAdjust(rawPairs.map((r) => r.p));

  const descRows: Cell[][] = vars.map((v, j) => {
    const arr = complete.map((r) => r[j]);
    const m = condMeans[j];
    const s = sd(arr, m);
    const se = s / Math.sqrt(N);
    const tc = tCritAdv(N - 1);
    return [v, N, rn(m, 3), rn(s, 3), `${rn(m - tc * se, 3)} – ${rn(m + tc * se, 3)}`];
  });

  return {
    title: `ANOVA de medidas repetidas (${vars.join(" · ")})`,
    tables: [
      { title: "Medias marginales por momento", columns: ["Momento", "N", "Media", "DE", "IC 95% media"], rows: descRows, note: "" },
      {
        title: "Efecto intrasujeto y corrección de esfericidad",
        columns: ["Prueba", "F", "gl₁", "gl₂", "ε (GG)", "p", "η² parcial"],
        rows: [
          ["Esfericidad asumida", rn(fStat, 3), dfCond, dfErr, "1.000", fp(pF), rn(partialEta2, 3)],
          ["Greenhouse-Geisser", rn(fStat, 3), rn(dfCond * epsGG, 2), rn(dfErr * epsGG, 2), rn(epsGG, 3), fp(pGG), rn(partialEta2, 3)],
        ],
        note: "Se recomienda interpretar el p corregido por Greenhouse-Geisser cuando ε < 0.75.",
      },
      {
        title: "Comparaciones pareadas post hoc (Holm-Bonferroni)",
        columns: ["Momento 1", "Momento 2", "Diferencia (M₂−M₁)", "p bruta", "p ajustada (Holm)"],
        rows: rawPairs.map((r, i) => [r.a, r.b, rn(r.diff, 3), fp(r.p), fp(adjP[i])]),
        note: "",
      },
    ],
    charts: [
      {
        type: "line",
        title: "Trayectoria de medias longitudinales",
        x: "momento",
        series: ["Media"],
        data: vars.map((v, j) => ({ momento: v, Media: rn(condMeans[j], 3) })),
        meta: {},
      },
    ],
    summary: `ANOVA medidas repetidas (N=${N}): F = ${rn(fStat, 2)}, p = ${fp(pF)} (Greenhouse-Geisser ε=${rn(epsGG, 2)}, p=${fp(pGG)}), η² parcial = ${rn(partialEta2, 3)}.`,
  };
}

export function runIcc(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap: Map<string, Variable>
): Omit<AnalysisResult, "test"> {
  const vars = (params.vars as string[]) || [];
  const iccType = (params.icc_type as string) === "consistency" ? "consistency" : "agreement";
  if (vars.length < 2) throw new StatsAdvError("El ICC requiere al menos 2 evaluadores o mediciones.");
  needCols(rows, vars);

  const series = vars.map((v) => {
    const meta = varMap.get(v);
    const isOrd = meta?.type === "ordinal";
    const lv = isOrd ? sortLevelsSmart(rows.map((r) => toLbl(r[v])).filter((x): x is string => x !== null), meta?.levels) : [];
    return rows.map((r) => toNumericOrOrdinal(r[v], lv, isOrd));
  });
  const complete: number[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = series.map((s) => s[i]);
    if (r.every((x) => x !== null)) complete.push(r as number[]);
  }
  const n = complete.length;
  const k = vars.length;
  if (n < 3) throw new StatsAdvError("Se necesitan al menos 3 sujetos con mediciones completas.");

  const gm = mean(complete.flat());
  const rowMeans = complete.map((r) => mean(r));
  const colMeans = Array.from({ length: k }, (_, j) => mean(complete.map((r) => r[j])));
  const ssTotal = complete.reduce((acc, r) => acc + r.reduce((s, x) => s + (x - gm) ** 2, 0), 0);
  const ssR = k * rowMeans.reduce((s, m) => s + (m - gm) ** 2, 0);
  const ssC = n * colMeans.reduce((s, m) => s + (m - gm) ** 2, 0);
  const ssE = Math.max(0, ssTotal - ssR - ssC);

  const msR = ssR / (n - 1);
  const msC = ssC / (k - 1);
  const msE = ssE / ((n - 1) * (k - 1));

  // ICC(2,1), ICC(3,1), ICC(2,k), ICC(3,k)
  const icc21 = (msR - msE) / Math.max(1e-12, msR + (k - 1) * msE + (k * (msC - msE)) / n);
  const icc31 = (msR - msE) / Math.max(1e-12, msR + (k - 1) * msE);
  const icc2k = (msR - msE) / Math.max(1e-12, msR + (msC - msE) / n);
  const icc3k = (msR - msE) / Math.max(1e-12, msR);

  const primary = iccType === "agreement" ? icc21 : icc31;
  const fVal = msE > 0 ? msR / msE : 0;
  const pVal = fPvalAdv(fVal, n - 1, (n - 1) * (k - 1));
  // Approximate 95% CI using F bounds for ICC(3,1)
  const fL = fVal / 2.2;
  const fU = fVal * 2.2;
  const ciLo = Math.max(-1, Math.min(1, (fL - 1) / (fL + k - 1)));
  const ciHi = Math.max(-1, Math.min(1, (fU - 1) / (fU + k - 1)));

  const kooLi =
    primary < 0.5 ? "Pobre (<0.50)" : primary < 0.75 ? "Moderada (0.50–0.75)" : primary < 0.9 ? "Buena (0.75–0.90)" : "Excelente (≥0.90)";

  return {
    title: `Coeficiente de Correlación Intraclase (ICC): ${vars.join(" vs ")}`,
    tables: [
      {
        title: "Estimaciones de fiabilidad (Shrout & Fleiss)",
        columns: ["Modelo ICC", "Descripción", "ICC", "F", "p"],
        rows: [
          ["ICC(2,1)", "Acuerdo absoluto (medición única)", rn(icc21, 3), rn(fVal, 2), fp(pVal)],
          ["ICC(3,1)", "Consistencia (medición única)", rn(icc31, 3), rn(fVal, 2), fp(pVal)],
          ["ICC(2,k)", "Acuerdo absoluto (media de k)", rn(icc2k, 3), rn(fVal, 2), fp(pVal)],
          ["ICC(3,k)", "Consistencia (media de k)", rn(icc3k, 3), rn(fVal, 2), fp(pVal)],
        ],
        note: `N = ${n} sujetos, k = ${k} evaluadores. Interpretación Koo & Li (2016) para modelo principal: ${kooLi}. IC 95% ref.: ${rn(ciLo, 3)}–${rn(ciHi, 3)}.`,
      },
    ],
    charts: [],
    summary: `${iccType === "agreement" ? "ICC(2,1)" : "ICC(3,1)"} = ${rn(primary, 3)}, p = ${fp(pVal)} → fiabilidad ${kooLi}.`,
  };
}

export function runNegBinReg(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varTypes: Record<string, VarType>
): Omit<AnalysisResult, "test"> {
  const outcome = params.outcome as string;
  const predictors = (params.predictors as string[]) || [];
  if (!outcome || !predictors.length) throw new StatsAdvError("Selecciona variable de conteo y predictores.");
  needCols(rows, [outcome, ...predictors]);

  const catLevels: Record<string, string[]> = {};
  for (const pv of predictors) {
    if ((varTypes[pv] ?? "numeric") !== "numeric") {
      const lvs = getLevels(rows.map((r) => toLbl(r[pv])));
      if (lvs.length < 2) throw new StatsAdvError(`El predictor '${pv}' necesita al menos 2 categorías.`);
      catLevels[pv] = lvs;
    }
  }

  const termNames = ["Constante"];
  for (const pv of predictors) {
    if (catLevels[pv]) {
      for (let i = 1; i < catLevels[pv].length; i++) termNames.push(`${pv}: ${catLevels[pv][i]}`);
    } else termNames.push(pv);
  }

  const X: number[][] = [];
  const y: number[] = [];
  for (const r of rows) {
    const yv = toNum(r[outcome]);
    if (yv === null || yv < 0) continue;
    const xRow = [1];
    let ok = true;
    for (const pv of predictors) {
      if (catLevels[pv]) {
        const l = toLbl(r[pv]);
        if (l === null) {
          ok = false;
          break;
        }
        for (let i = 1; i < catLevels[pv].length; i++) xRow.push(l === catLevels[pv][i] ? 1 : 0);
      } else {
        const v = toNum(r[pv]);
        if (v === null) {
          ok = false;
          break;
        }
        xRow.push(v);
      }
    }
    if (ok) {
      X.push(xRow);
      y.push(yv);
    }
  }
  const n = X.length;
  const p = termNames.length;
  if (n < p + 4) throw new StatsAdvError("No hay suficientes casos completos para el modelo Binomial Negativo.");

  const yMean = Math.max(1e-3, mean(y));
  const yVar = y.reduce((s, v) => s + (v - yMean) ** 2, 0) / Math.max(1, n - 1);
  let alpha = Math.max(0.05, Math.min(5, (yVar - yMean) / Math.max(1e-3, yMean * yMean)));
  let beta = new Array(p).fill(0);
  beta[0] = Math.log(yMean);
  let invInfo: number[][] | null = null;

  for (let outer = 0; outer < 6; outer++) {
    for (let iter = 0; iter < 30; iter++) {
      const grad = new Array(p).fill(0);
      const info: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
      for (let i = 0; i < n; i++) {
        const eta = Math.max(-15, Math.min(15, X[i].reduce((s, v, j) => s + v * beta[j], 0)));
        const mu = Math.exp(eta);
        const w = mu / (1 + alpha * mu);
        const score = (y[i] - mu) / (1 + alpha * mu);
        for (let j = 0; j < p; j++) {
          grad[j] += X[i][j] * score;
          for (let k = 0; k < p; k++) info[j][k] += X[i][j] * X[i][k] * w;
        }
      }
      const inv = invertMatrix(info);
      if (!inv) break;
      invInfo = inv;
      const step = matMulVec(inv, grad);
      beta = beta.map((b, j) => b + step[j]);
      if (Math.max(...step.map(Math.abs)) < 1e-6) break;
    }
    // Method-of-moments update for dispersion alpha
    let pearsonChi = 0;
    let sumInvMu = 0;
    for (let i = 0; i < n; i++) {
      const mu = Math.exp(Math.max(-15, Math.min(15, X[i].reduce((s, v, j) => s + v * beta[j], 0))));
      pearsonChi += ((y[i] - mu) ** 2) / Math.max(1e-6, mu);
      sumInvMu += 1 / Math.max(1e-3, mu);
    }
    const newAlpha = Math.max(0.001, Math.min(10, (pearsonChi - (n - p)) / Math.max(1, n)));
    if (Math.abs(newAlpha - alpha) < 1e-3 || sumInvMu < 0) break;
    alpha = newAlpha;
  }

  if (!invInfo) throw new StatsAdvError("El modelo Binomial Negativo no convergió.");

  const coefRows: Cell[][] = [];
  const irrChart: Record<string, Cell>[] = [];
  termNames.forEach((t, j) => {
    const se = Math.sqrt(Math.max(0, invInfo![j][j]));
    const z = se > 0 ? beta[j] / se : 0;
    const pVal = 2 * (1 - normCdfAdv(Math.abs(z)));
    const irr = Math.exp(beta[j]);
    const lo = Math.exp(beta[j] - 1.96 * se);
    const hi = Math.exp(beta[j] + 1.96 * se);
    coefRows.push([t, rn(beta[j], 4), rn(se, 4), rn(z, 3), fp(pVal), rn(irr, 3), `${rn(lo, 3)} – ${rn(hi, 3)}`]);
    if (t !== "Constante") irrChart.push({ category: t, IRR: rn(irr, 3) });
  });

  return {
    title: `Regresión Binomial Negativa (sobredispersión): ${outcome}`,
    tables: [
      {
        title: "Resumen del modelo",
        columns: ["N", "Dispersión (α)", "Media desenlace", "Varianza desenlace"],
        rows: [[n, rn(alpha, 3), rn(yMean, 2), rn(yVar, 2)]],
        note: "α > 0 modela explícitamente la sobredispersión respecto a Poisson.",
      },
      {
        title: "Coeficientes (Razones de Tasas de Incidencia · IRR)",
        columns: ["Término", "β", "EE", "z", "p", "IRR", "IC 95% IRR"],
        rows: coefRows,
        note: "",
      },
    ],
    charts: [{ type: "bar", title: "Razones de Tasas de Incidencia (IRR)", x: "category", series: ["IRR"], data: irrChart, meta: { refline: 1 } }],
    summary: `Binomial Negativa (N=${n}): α = ${rn(alpha, 3)}, ${predictors.length} predictor(es).`,
  };
}

export function runIncidencePrevalence(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>
): Omit<AnalysisResult, "test"> {
  const outCol = params.outcome as string;
  const grpCol = (params.group as string) || "";
  const timeCol = (params.time as string) || "";
  needCols(rows, [outCol, ...(grpCol ? [grpCol] : []), ...(timeCol ? [timeCol] : [])]);

  const toEv = (v: Cell | undefined): 0 | 1 | null => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    const n = toNum(v);
    if (n === 1) return 1;
    if (n === 0) return 0;
    const s = String(v).trim().toLowerCase();
    if (["si", "sí", "yes", "true", "positivo", "evento"].includes(s)) return 1;
    if (["no", "false", "negativo", "censura"].includes(s)) return 0;
    return null;
  };

  const evalLevels = () => {
    if (!grpCol) return ["Cohorte total"];
    return getLevels(rows.map((r) => toLbl(r[grpCol])));
  };
  const levels = evalLevels();
  const tableRows: Cell[][] = [];
  const chartData: Record<string, Cell>[] = [];

  for (const lv of levels) {
    let cases = 0;
    let total = 0;
    let ptSum = 0;
    for (const r of rows) {
      if (grpCol && toLbl(r[grpCol]) !== lv) continue;
      const ev = toEv(r[outCol]);
      if (ev === null) continue;
      if (timeCol) {
        const t = toNum(r[timeCol]);
        if (t === null || t < 0) continue;
        ptSum += t;
      }
      total++;
      if (ev === 1) cases++;
    }
    if (!total) continue;
    const prev = cases / total;
    const [lo, hi] = wilsonCI(cases, total);
    if (timeCol && ptSum > 0) {
      const rate1000 = (cases / ptSum) * 1000;
      const rateLo = cases > 0 ? ((cases * Math.pow(1 - 1 / (9 * cases) - 1.96 / (3 * Math.sqrt(cases)), 3)) / ptSum) * 1000 : 0;
      const rateHi = (((cases + 1) * Math.pow(1 - 1 / (9 * (cases + 1)) + 1.96 / (3 * Math.sqrt(cases + 1)), 3)) / ptSum) * 1000;
      tableRows.push([lv, cases, total, `${rn(prev * 100, 1)}% (${rn(lo * 100, 1)}–${rn(hi * 100, 1)}%)`, rn(ptSum, 1), `${rn(rate1000, 2)} (${rn(rateLo, 2)}–${rn(rateHi, 2)})`]);
    } else {
      tableRows.push([lv, cases, total, `${rn(prev * 100, 1)}%`, `${rn(lo * 100, 1)}% – ${rn(hi * 100, 1)}%`]);
    }
    chartData.push({ grupo: lv, "Prevalencia (%)": rn(prev * 100, 1) });
  }

  if (!tableRows.length) throw new StatsAdvError("No hay observaciones válidas para calcular incidencia/prevalencia.");

  return {
    title: `Incidencia y Prevalencia: ${outCol}${grpCol ? ` por ${grpCol}` : ""}`,
    tables: [
      {
        title: timeCol ? "Incidencia acumulada y densidad por personas-tiempo" : "Prevalencia / Incidencia acumulada (IC 95% de Wilson)",
        columns: timeCol
          ? ["Estrato", "Casos", "N", "Incidencia acumulada (IC 95%)", "Personas-tiempo", "Tasa / 1000 p-t (IC 95% Byar)"]
          : ["Estrato", "Casos", "N", "Prevalencia / Incidencia", "IC 95% (Wilson)"],
        rows: tableRows,
        note: timeCol ? "IC 95% de densidad de incidencia calculado por aproximación exacta de Byar." : "IC 95% binomial calculado mediante método de Wilson.",
      },
    ],
    charts: [{ type: "bar", title: `Proporción de casos (${outCol}) %`, x: "grupo", series: ["Prevalencia (%)"], data: chartData, meta: {} }],
    summary: `Calculadas métricas epidemiológicas para ${outCol} en ${tableRows.length} estrato(s).`,
  };
}

export function runSampleSizeAdv(params: Record<string, unknown>): Omit<AnalysisResult, "test"> {
  const calcMode = (params.calc_mode as string) === "power" ? "power" : "sample_size";
  const design = (params.design as string) || "two_proportions";
  const alpha = Math.min(0.25, Math.max(0.001, Number(params.alpha ?? 0.05)));
  const targetPower = Math.min(0.99, Math.max(0.5, Number(params.power ?? 0.8)));
  const ratio = Math.min(10, Math.max(0.1, Number(params.ratio ?? 1)));
  const zAlpha = normInvAdv(1 - alpha / 2);

  const calcPower = (n1Val: number): number => {
    if (design === "two_means") {
      const diff = Math.abs(Number(params.diff ?? 10));
      const sigma = Math.max(1e-6, Number(params.sd_val ?? 15));
      const se = sigma * Math.sqrt(1 / n1Val + 1 / (n1Val * ratio));
      return se > 0 ? normCdfAdv(diff / se - zAlpha) : 0;
    }
    if (design === "correlation") {
      const r = Math.min(0.99, Math.max(0.05, Math.abs(Number(params.r_val ?? 0.3))));
      const zr = 0.5 * Math.log((1 + r) / (1 - r));
      return n1Val > 3 ? normCdfAdv(zr * Math.sqrt(n1Val - 3) - zAlpha) : 0;
    }
    let p1 = Math.min(0.99, Math.max(0.005, Number(params.p1 ?? 0.3)));
    let p2 = Math.min(0.99, Math.max(0.005, Number(params.p2 ?? 0.15)));
    if (design === "cohort_rr") {
      const rrVal = Math.max(1.05, Number(params.rr_val ?? 2));
      p1 = Math.min(0.95, p2 * rrVal);
    }
    const n2Val = n1Val * ratio;
    const pBar = (p1 + ratio * p2) / (1 + ratio);
    const se0 = Math.sqrt(pBar * (1 - pBar) * (1 / n1Val + 1 / n2Val));
    const se1 = Math.sqrt((p1 * (1 - p1)) / n1Val + (p2 * (1 - p2)) / n2Val);
    return se1 > 0 ? normCdfAdv((Math.abs(p1 - p2) - zAlpha * se0) / se1) : 0;
  };

  if (calcMode === "power") {
    const n1In = Math.max(3, Math.round(Number(params.n1 ?? 50)));
    const n2In = design === "correlation" ? 0 : Math.ceil(n1In * ratio);
    const achPower = calcPower(n1In);
    const curvePts: Record<string, Cell>[] = [];
    const maxN = Math.max(20, Math.ceil(n1In * 1.8));
    const step = Math.max(1, Math.floor(maxN / 12));
    for (let k = Math.max(5, step); k <= maxN; k += step) {
      curvePts.push({ N: `N=${design === "correlation" ? k : Math.ceil(k * (1 + ratio))}`, "Potencia (%)": rn(calcPower(k) * 100, 1) });
    }
    return {
      title: "Cálculo de potencia estadística alcanzada",
      tables: [
        {
          title: `Potencia para N = ${n1In + n2In} (${design})`,
          columns: ["Parámetro", "Valor"],
          rows: [
            ["Nivel de significación (α bilateral)", alpha],
            [design === "correlation" ? "Sujetos (N)" : "Grupo 1 (n₁) / Grupo 2 (n₂)", design === "correlation" ? n1In : `${n1In} / ${n2In}`],
            ["Potencia alcanzada (1 − β)", `${rn(achPower * 100, 1)}%`],
          ],
          note: "Cálculo inverso de potencia estadística post-hoc o de viabilidad muestral.",
        },
      ],
      charts: [{ type: "bar", title: "Curva de potencia según N", x: "N", series: ["Potencia (%)"], data: curvePts, meta: {} }],
      summary: `Con N = ${n1In + n2In} y α = ${alpha}, la potencia alcanzada es ${rn(achPower * 100, 1)}%.`,
    };
  }

  let n1 = 10;
  let n2 = 10;
  let descLabel = "";
  const zBeta = normInvAdv(targetPower);
  if (design === "two_means") {
    const diff = Math.abs(Number(params.diff ?? 10));
    const sigma = Math.max(1e-6, Number(params.sd_val ?? 15));
    if (diff <= 0) throw new StatsAdvError("La diferencia mínima esperada entre medias debe ser > 0.");
    n1 = Math.ceil((1 + 1 / ratio) * Math.pow((zAlpha + zBeta) * (sigma / diff), 2));
    n2 = Math.ceil(n1 * ratio);
    descLabel = `Comparación de 2 medias independientes (Δ = ${diff}, DE = ${sigma})`;
  } else if (design === "correlation") {
    const r = Math.min(0.99, Math.max(0.05, Math.abs(Number(params.r_val ?? 0.3))));
    const zr = 0.5 * Math.log((1 + r) / (1 - r));
    n1 = Math.ceil(Math.pow((zAlpha + zBeta) / zr, 2) + 3);
    n2 = 0;
    descLabel = `Estudio de correlación lineal (r esperado = ${r})`;
  } else {
    let p1 = Math.min(0.99, Math.max(0.005, Number(params.p1 ?? 0.3)));
    const p2 = Math.min(0.99, Math.max(0.005, Number(params.p2 ?? 0.15)));
    if (design === "cohort_rr") {
      const rrVal = Math.max(1.05, Number(params.rr_val ?? 2));
      p1 = Math.min(0.95, p2 * rrVal);
      descLabel = `Estudio de cohortes (RR = ${rrVal}, incidencia no expuestos = ${rn(p2 * 100, 1)}%)`;
    } else {
      descLabel = `Comparación de 2 proporciones (p₁ = ${rn(p1 * 100, 1)}% vs p₂ = ${rn(p2 * 100, 1)}%)`;
    }
    if (Math.abs(p1 - p2) < 0.005) throw new StatsAdvError("Las proporciones p₁ y p₂ deben ser distintas.");
    const pBar = (p1 + ratio * p2) / (1 + ratio);
    const num = zAlpha * Math.sqrt((1 + 1 / ratio) * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + (p2 * (1 - p2)) / ratio);
    n1 = Math.ceil(Math.pow(num / Math.abs(p1 - p2), 2));
    n2 = Math.ceil(n1 * ratio);
  }

  const nTotal = n1 + n2;
  const nTotal15 = Math.ceil(nTotal / 0.85);
  const curvePts: Record<string, Cell>[] = [];
  const maxN1 = Math.max(20, Math.ceil(n1 * 1.6));
  const step = Math.max(1, Math.floor(maxN1 / 12));
  for (let k = Math.max(5, step); k <= maxN1; k += step) {
    const tot = design === "correlation" ? k : Math.ceil(k * (1 + ratio));
    curvePts.push({ N: `N=${tot}`, "Potencia (%)": rn(calcPower(k) * 100, 1) });
  }

  return {
    title: "Cálculo de tamaño muestral y potencia estadística",
    tables: [
      {
        title: descLabel,
        columns: ["Parámetro", "Valor"],
        rows: [
          ["Nivel de significación (α bilateral)", alpha],
          ["Potencia estadística (1 − β)", `${rn(targetPower * 100, 0)}%`],
          [design === "correlation" ? "Sujetos requeridos (N)" : "Grupo 1 (n₁)", n1],
          ...(design === "correlation" ? [] : [["Grupo 2 (n₂)", n2]]),
          ["Tamaño muestral total requerido (N)", nTotal],
          ["Ajustado por 15% de pérdidas en seguimiento", nTotal15],
        ],
        note: "Fórmula bilateral estándar (Kelsey / Fleiss / Fisher-z según diseño).",
      },
    ],
    charts: [{ type: "bar", title: "Curva de potencia alcanzada según tamaño muestral", x: "N", series: ["Potencia (%)"], data: curvePts, meta: {} }],
    summary: `Tamaño muestral necesario: N = ${nTotal}${design === "correlation" ? "" : ` (n₁=${n1}, n₂=${n2})`} para α=${alpha} y potencia ${rn(targetPower * 100, 0)}% (${nTotal15} considerando 15% de pérdidas).`,
  };
}

export function runMultipleTesting(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap: Map<string, Variable>,
  mannWhitneyFn: (xa: number[], xb: number[]) => number,
  kruskalFn: (groups: number[][]) => number
): Omit<AnalysisResult, "test"> {
  const mode = (params.mode as string) === "pvalues" ? "pvalues" : "screen";
  const method = (params.method as string) || "fdr_bh";
  const alpha = 0.05;
  const items: { label: string; testLabel: string; p: number }[] = [];

  if (mode === "pvalues") {
    const pvals = (params.pvalues as number[]) || [];
    const labels = (params.labels as string[]) || [];
    if (pvals.length < 2) throw new StatsAdvError("Introduce al menos 2 valores p para aplicar corrección múltiple.");
    pvals.forEach((pv, i) => {
      items.push({ label: labels[i] || `Hipótesis ${i + 1}`, testLabel: "Valor p directo", p: pv });
    });
  } else {
    const gv = params.group as string;
    const vars = (params.vars as string[]) || [];
    if (!gv || vars.length < 2) throw new StatsAdvError("Selecciona variable de agrupación y al menos 2 variables de cribado.");
    needCols(rows, [gv, ...vars]);
    const gRaw = rows.map((r) => toLbl(r[gv]));
    const levels = getLevels(gRaw);
    if (levels.length < 2) throw new StatsAdvError(`La variable '${gv}' necesita al menos 2 categorías.`);

    for (const v of vars) {
      if (v === gv) continue;
      const meta = varMap.get(v);
      const vtype = meta?.type ?? "numeric";
      if (vtype === "numeric" || vtype === "ordinal") {
        const isOrd = vtype === "ordinal";
        const lvOrd = isOrd ? sortLevelsSmart(rows.map((r) => toLbl(r[v])).filter((x): x is string => x !== null), meta?.levels) : [];
        const grps = levels
          .map((lv) =>
            rows
              .map((r, i) => (gRaw[i] === lv ? toNumericOrOrdinal(r[v], lvOrd, isOrd) : null))
              .filter((x): x is number => x !== null)
          )
          .filter((g) => g.length > 0);
        if (grps.length === 2) items.push({ label: v, testLabel: "Mann-Whitney U", p: mannWhitneyFn(grps[0], grps[1]) });
        else if (grps.length > 2) items.push({ label: v, testLabel: "Kruskal-Wallis", p: kruskalFn(grps) });
      } else {
        const pairs = rows
          .map((r, i) => [toLbl(r[v]), gRaw[i]] as [string | null, string | null])
          .filter((p): p is [string, string] => p[0] !== null && p[1] !== null);
        const rLvs = getLevels(pairs.map((p) => p[0]));
        if (rLvs.length >= 2) {
          const ct = rLvs.map((rl) => levels.map((gl) => pairs.filter((p) => p[0] === rl && p[1] === gl).length));
          const rTot = ct.map((r) => r.reduce((s, x) => s + x, 0));
          const cTot = levels.map((_, j) => ct.reduce((s, r) => s + r[j], 0));
          const n = rTot.reduce((s, x) => s + x, 0);
          let chi = 0;
          for (let i = 0; i < rLvs.length; i++) {
            for (let j = 0; j < levels.length; j++) {
              const exp = (rTot[i] * cTot[j]) / Math.max(1, n);
              if (exp > 0) chi += (ct[i][j] - exp) ** 2 / exp;
            }
          }
          items.push({ label: v, testLabel: "χ² Pearson", p: chi2PvalAdv(chi, (rLvs.length - 1) * (levels.length - 1)) });
        }
      }
    }
    if (items.length < 2) throw new StatsAdvError("Se requieren al menos 2 contrastes válidos para ajustar multiplicidad.");
  }

  const rawP = items.map((i) => i.p);
  const m = rawP.length;
  const pBonf = rawP.map((p) => Math.min(1, p * m));
  const pHolm = holmAdjust(rawP);
  const pFdr = bhFdrAdjust(rawP);
  const active = method === "fdr_bh" ? pFdr : method === "holm" ? pHolm : pBonf;

  let sigRaw = 0;
  let sigAdj = 0;
  const outRows: Cell[][] = items.map((it, i) => {
    if (it.p < alpha) sigRaw++;
    if (active[i] < alpha) sigAdj++;
    return [it.label, it.testLabel, fp(it.p), fp(pBonf[i]), fp(pHolm[i]), fp(pFdr[i]), active[i] < alpha ? "Sí" : "No"];
  });

  const methodLbl = method === "fdr_bh" ? "Benjamini-Hochberg (FDR)" : method === "holm" ? "Holm-Bonferroni" : "Bonferroni";
  return {
    title: `Corrección por comparaciones múltiples (${methodLbl})`,
    tables: [
      {
        title: "Valores p brutos y ajustados",
        columns: ["Variable / Hipótesis", "Prueba", "p bruta", "p Bonferroni", "p Holm", "q FDR (BH)", `Significativo (${method})`],
        rows: outRows,
        note: "Benjamini-Hochberg (FDR) controla la tasa de falsos descubrimientos; Holm y Bonferroni controlan el error tipo I familiar.",
      },
    ],
    charts: [],
    summary: `${m} contrastes evaluados: ${sigRaw} significativos sin corregir vs ${sigAdj} tras ${methodLbl} (α=${alpha}).`,
  };
}

function extractOrderedSeries(rows: Record<string, Cell>[], outcome: string, timeCol?: string): { labels: string[]; y: number[] } {
  needCols(rows, timeCol ? [outcome, timeCol] : [outcome]);
  const items: { sortNum: number | null; sortStr: string; label: string; y: number; idx: number }[] = [];
  rows.forEach((r, idx) => {
    const yv = toNum(r[outcome]);
    if (yv === null) return;
    if (timeCol) {
      const lbl = toLbl(r[timeCol]);
      if (lbl === null) return;
      items.push({ sortNum: toNum(lbl), sortStr: lbl, label: lbl, y: yv, idx });
    } else {
      items.push({ sortNum: idx, sortStr: String(idx), label: `t=${idx + 1}`, y: yv, idx });
    }
  });
  if (timeCol) {
    items.sort((a, b) => {
      if (a.sortNum !== null && b.sortNum !== null) return a.sortNum - b.sortNum;
      return a.sortStr.localeCompare(b.sortStr, "es");
    });
  }
  if (items.length < 6) throw new StatsAdvError("Se requieren al menos 6 observaciones temporales válidas.");
  return { labels: items.map((i) => i.label), y: items.map((i) => i.y) };
}

export function runTsTrendSeasonal(rows: Record<string, Cell>[], params: Record<string, unknown>): Omit<AnalysisResult, "test"> {
  const outcome = params.outcome as string;
  const timeCol = (params.time as string) || undefined;
  const period = Math.max(2, Math.round(Number(params.period ?? 12)));
  const { labels, y } = extractOrderedSeries(rows, outcome, timeCol);
  const n = y.length;
  const tIdx = Array.from({ length: n }, (_, i) => i);

  // Mann-Kendall
  const { tau: tauMk, p: pMk } = kendallTauB(tIdx, y);

  // Theil-Sen median pairwise slope
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) slopes.push((y[j] - y[i]) / (j - i));
  }
  slopes.sort((a, b) => a - b);
  const senSlope = quantile(slopes, 0.5);

  // OLS slope
  const mx = mean(tIdx);
  const my = mean(y);
  const sxx = tIdx.reduce((s, x) => s + (x - mx) ** 2, 0);
  const sxy = tIdx.reduce((s, x, i) => s + (x - mx) * (y[i] - my), 0);
  const syy = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const olsSlope = sxx > 0 ? sxy / sxx : 0;
  const olsInt = my - olsSlope * mx;
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  const sse = y.reduce((s, v, i) => s + (v - (olsInt + olsSlope * i)) ** 2, 0);
  const seSlope = n > 2 && sxx > 0 ? Math.sqrt(sse / (n - 2) / sxx) : 0;
  const pOls = seSlope > 0 ? tPvalAdv(olsSlope / seSlope, n - 2) : 1;

  // Classical additive decomposition if n >= 2 * period
  let effectivePeriod = 0;
  let trendLine = tIdx.map((i) => olsInt + olsSlope * i);
  let deseasonalized = [...y];
  let trendStrength: number | null = null;
  let seasonalStrength: number | null = null;
  const decompRows: Cell[][] = [];

  if (n >= 2 * period) {
    effectivePeriod = period;
    const half = Math.floor(period / 2);
    const ma = new Array<number>(n).fill(NaN);
    for (let i = half; i < n - half; i++) {
      let sum = 0;
      for (let k = -half; k <= half; k++) {
        const w = period % 2 === 0 && Math.abs(k) === half ? 0.5 : 1;
        sum += w * y[i + k];
      }
      ma[i] = sum / period;
    }
    const firstValid = ma.find((v) => Number.isFinite(v)) ?? my;
    const lastValid = [...ma].reverse().find((v) => Number.isFinite(v)) ?? my;
    trendLine = ma.map((v, i) => (Number.isFinite(v) ? v : i < half ? firstValid : lastValid));
    const detrended = y.map((v, i) => v - trendLine[i]);
    const phaseAvgs = new Array<number>(period).fill(0);
    for (let pIdx = 0; pIdx < period; pIdx++) {
      const vals: number[] = [];
      for (let i = pIdx; i < n; i += period) vals.push(detrended[i]);
      phaseAvgs[pIdx] = vals.length ? mean(vals) : 0;
    }
    const phaseMean = mean(phaseAvgs);
    const seasIdx = phaseAvgs.map((v) => v - phaseMean);
    const seasSeries = y.map((_, i) => seasIdx[i % period]);
    deseasonalized = y.map((v, i) => v - seasSeries[i]);
    const resid = y.map((v, i) => v - trendLine[i] - seasSeries[i]);
    const varR = resid.reduce((s, v) => s + v * v, 0) / n;
    const varSR = seasSeries.reduce((s, v, i) => s + (v + resid[i]) ** 2, 0) / n;
    const varTR = trendLine.reduce((s, v, i) => s + (v - my + resid[i]) ** 2, 0) / n;
    seasonalStrength = varSR > 0 ? Math.max(0, 1 - varR / varSR) : 0;
    trendStrength = varTR > 0 ? Math.max(0, 1 - varR / varTR) : 0;
    seasIdx.forEach((sv, idx) => decompRows.push([`Fase ${idx + 1}`, rn(sv, 3)]));
  }

  const step = Math.max(1, Math.floor(n / 150));
  const chartData: Record<string, Cell>[] = [];
  for (let i = 0; i < n; i += step) {
    chartData.push({
      t: labels[i],
      Observado: rn(y[i], 3),
      Tendencia: rn(trendLine[i], 3),
      ...(effectivePeriod ? { Desestacionalizada: rn(deseasonalized[i], 3) } : {}),
    });
  }

  const tables: ResultTable[] = [
    {
      title: "Análisis de tendencia (Mann-Kendall, Theil-Sen y OLS)",
      columns: ["N puntos", "τ Mann-Kendall", "p (Mann-Kendall)", "Pendiente Theil-Sen", "Pendiente OLS", "R² lineal", "p (OLS)", "Fuerza tendencia (F_T)", "Fuerza estacional (F_S)"],
      rows: [[n, rn(tauMk, 3), fp(pMk), rn(senSlope, 4), rn(olsSlope, 4), rn(r2, 3), fp(pOls), trendStrength !== null ? rn(trendStrength, 3) : "—", seasonalStrength !== null ? rn(seasonalStrength, 3) : "—"]],
      note: effectivePeriod ? `Descomposición estacional aditiva con período = ${period}.` : `Se requieren al menos ${2 * period} puntos para descomposición estacional de período ${period}.`,
    },
  ];
  if (decompRows.length) {
    tables.push({ title: `Índices estacionales aditivos (período = ${period})`, columns: ["Fase del ciclo", "Efecto estacional"], rows: decompRows, note: "" });
  }

  return {
    title: `Tendencia y estacionalidad: ${outcome}`,
    tables,
    charts: [{ type: "line", title: `Serie temporal y tendencia: ${outcome}`, x: "t", series: ["Observado", "Tendencia", ...(effectivePeriod ? ["Desestacionalizada"] : [])], data: chartData, meta: {} }],
    summary: `Mann-Kendall τ = ${rn(tauMk, 3)} (p = ${fp(pMk)}), pendiente Theil-Sen = ${rn(senSlope, 4)}/unidad${seasonalStrength !== null ? `, fuerza estacional = ${rn(seasonalStrength, 3)}.` : "."}`,
  };
}

export function runTsArima(rows: Record<string, Cell>[], params: Record<string, unknown>): Omit<AnalysisResult, "test"> {
  const outcome = params.outcome as string;
  const timeCol = (params.time as string) || undefined;
  let pOrd = Math.max(0, Math.min(3, Math.round(Number(params.p ?? 1))));
  let dOrd = Math.max(0, Math.min(2, Math.round(Number(params.d ?? 1))));
  const qOrd = Math.max(0, Math.min(2, Math.round(Number(params.q ?? 0))));
  const steps = Math.max(1, Math.min(36, Math.round(Number(params.forecast_steps ?? 6))));
  const autoOrder = params.auto_order !== false;

  const { labels, y } = extractOrderedSeries(rows, outcome, timeCol);
  const n = y.length;
  if (n < 10) throw new StatsAdvError("ARIMA requiere al menos 10 observaciones temporales.");

  // ACF & Ljung-Box on raw series
  const nlags = Math.max(2, Math.min(14, Math.floor(n / 2) - 1));
  const yMean = mean(y);
  const denom = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const acfArr: number[] = [1];
  for (let lag = 1; lag <= nlags; lag++) {
    let num = 0;
    for (let i = lag; i < n; i++) num += (y[i] - yMean) * (y[i - lag] - yMean);
    acfArr.push(denom > 0 ? num / denom : 0);
  }
  const lbLag = Math.min(10, nlags);
  let lbQ = 0;
  for (let k = 1; k <= lbLag; k++) lbQ += (acfArr[k] * acfArr[k]) / (n - k);
  lbQ *= n * (n + 2);
  const lbP = chi2PvalAdv(lbQ, lbLag);

  // Simple Dickey-Fuller Δy_t = a + b * y_{t-1}
  const dy: number[] = [];
  const yLag: number[] = [];
  for (let i = 1; i < n; i++) {
    dy.push(y[i] - y[i - 1]);
    yLag.push(y[i - 1]);
  }
  const mx = mean(yLag);
  const mdy = mean(dy);
  const sxx = yLag.reduce((s, v) => s + (v - mx) ** 2, 0);
  const sxy = yLag.reduce((s, v, i) => s + (v - mx) * (dy[i] - mdy), 0);
  const dfSlope = sxx > 0 ? sxy / sxx : 0;
  const dfInt = mdy - dfSlope * mx;
  const dfSse = dy.reduce((s, v, i) => s + (v - (dfInt + dfSlope * yLag[i])) ** 2, 0);
  const dfSe = dy.length > 2 && sxx > 0 ? Math.sqrt(dfSse / (dy.length - 2) / sxx) : 1;
  const adfStat = dfSe > 0 ? dfSlope / dfSe : 0;
  // MacKinnon rough 5% critical ≈ -2.89
  const adfP = adfStat < -3.5 ? 0.008 : adfStat < -2.89 ? 0.042 : adfStat < -2.5 ? 0.11 : 0.45;

  const diffSeries = (arr: number[], d: number) => {
    let cur = [...arr];
    for (let k = 0; k < d; k++) cur = cur.slice(1).map((v, i) => v - cur[i]);
    return cur;
  };

  const fitAr = (dOrder: number, pOrder: number) => {
    const w = diffSeries(y, dOrder);
    const nw = w.length;
    if (nw <= pOrder + 3) return null;
    const X: number[][] = [];
    const target: number[] = [];
    for (let i = pOrder; i < nw; i++) {
      const row = [1];
      for (let lag = 1; lag <= pOrder; lag++) row.push(w[i - lag]);
      X.push(row);
      target.push(w[i]);
    }
    const mCols = pOrder + 1;
    const XtX: number[][] = Array.from({ length: mCols }, () => new Array(mCols).fill(0));
    const Xty = new Array<number>(mCols).fill(0);
    for (let i = 0; i < X.length; i++) {
      for (let j = 0; j < mCols; j++) {
        Xty[j] += X[i][j] * target[i];
        for (let k = 0; k < mCols; k++) XtX[j][k] += X[i][j] * X[i][k];
      }
    }
    const inv = invertMatrix(XtX);
    if (!inv) return null;
    const beta = matMulVec(inv, Xty);
    const resid = target.map((v, i) => v - X[i].reduce((s, xv, j) => s + xv * beta[j], 0));
    const sse = resid.reduce((s, r) => s + r * r, 0);
    const sigma2 = Math.max(1e-8, sse / resid.length);
    const aic = resid.length * Math.log(sigma2) + 2 * mCols;
    const bic = resid.length * Math.log(sigma2) + Math.log(resid.length) * mCols;
    return { beta, inv, resid, sigma2, aic, bic, w };
  };

  let best = fitAr(dOrd, pOrd);
  if (autoOrder) {
    let bestAic = Infinity;
    const dCands = adfP < 0.05 ? [0, 1] : [1, 0];
    for (const dc of dCands) {
      for (const pc of [0, 1, 2]) {
        const cand = fitAr(dc, pc);
        if (cand && cand.aic < bestAic) {
          bestAic = cand.aic;
          best = cand;
          dOrd = dc;
          pOrd = pc;
        }
      }
    }
  }
  if (!best) throw new StatsAdvError("No se pudo ajustar el modelo ARIMA a la serie temporal.");

  const rmse = Math.sqrt(best.sigma2);
  // Forecast on differenced scale then integrate back
  const wExt = [...best.w];
  for (let h = 0; h < steps; h++) {
    let pred = best.beta[0];
    for (let lag = 1; lag <= pOrd; lag++) {
      pred += best.beta[lag] * wExt[wExt.length - lag];
    }
    wExt.push(pred);
  }
  const newW = wExt.slice(best.w.length);
  const fcMean: number[] = [];
  if (dOrd === 0) {
    fcMean.push(...newW);
  } else if (dOrd === 1) {
    let last = y[n - 1];
    for (const dw of newW) {
      last += dw;
      fcMean.push(last);
    }
  } else {
    let last1 = y[n - 1];
    let lastDiff = y[n - 1] - y[n - 2];
    for (const d2w of newW) {
      lastDiff += d2w;
      last1 += lastDiff;
      fcMean.push(last1);
    }
  }

  const tailIdx = Math.max(0, n - 40);
  const lineData: Record<string, Cell>[] = [];
  for (let i = tailIdx; i < n; i++) {
    lineData.push({ t: labels[i], Observado: rn(y[i], 3) });
  }
  const fcRows: Cell[][] = [];
  fcMean.forEach((m, h) => {
    const seH = rmse * Math.sqrt(h + 1);
    const lo = m - 1.96 * seH;
    const hi = m + 1.96 * seH;
    fcRows.push([`+${h + 1}`, rn(m, 3), rn(lo, 3), rn(hi, 3)]);
    lineData.push({ t: `+${h + 1}`, "Pronóstico ARIMA": rn(m, 3), "IC95% inf": rn(lo, 3), "IC95% sup": rn(hi, 3) });
  });

  const coefRows: Cell[][] = best.beta.map((b, j) => {
    const se = Math.sqrt(Math.max(1e-12, best!.sigma2 * best!.inv[j][j]));
    const z = b / se;
    return [j === 0 ? "Constante" : `AR(L${j})`, rn(b, 4), rn(se, 4), rn(z, 3), fp(2 * (1 - normCdfAdv(Math.abs(z))))];
  });

  const orderStr = `(${pOrd}, ${dOrd}, ${autoOrder ? 0 : qOrd})`;
  const acfChart = acfArr.slice(1).map((val, idx) => ({ lag: `Lag ${idx + 1}`, ACF: rn(val, 3) }));

  return {
    title: `Autocorrelación y ARIMA${orderStr}: ${outcome}`,
    tables: [
      {
        title: "Diagnóstico de estacionariedad, autocorrelación y ajuste",
        columns: ["Orden (p,d,q)", "N", "ADF estadístico", "p (ADF)", "Ljung-Box serie (p)", "AIC", "BIC", "RMSE"],
        rows: [[orderStr, n, rn(adfStat, 3), fp(adfP), fp(lbP), rn(best.aic, 1), rn(best.bic, 1), rn(rmse, 3)]],
        note: "ADF p < 0.05 sugiere estacionariedad.",
      },
      { title: "Parámetros del modelo", columns: ["Parámetro", "Coeficiente", "EE", "z", "p"], rows: coefRows, note: "" },
      { title: `Pronóstico a ${steps} pasos (IC 95%)`, columns: ["Horizonte", "Pronóstico puntual", "IC 95% inf", "IC 95% sup"], rows: fcRows, note: "" },
    ],
    charts: [
      { type: "line", title: `Serie y pronóstico ARIMA${orderStr}`, x: "t", series: ["Observado", "Pronóstico ARIMA", "IC95% inf", "IC95% sup"], data: lineData, meta: {} },
      { type: "bar", title: "Autocorrelación (ACF por rezago)", x: "lag", series: ["ACF"], data: acfChart, meta: { refZero: true } },
    ],
    summary: `ARIMA${orderStr}: AIC = ${rn(best.aic, 1)}, BIC = ${rn(best.bic, 1)}, RMSE = ${rn(rmse, 3)}; ADF p = ${fp(adfP)}.`,
  };
}
