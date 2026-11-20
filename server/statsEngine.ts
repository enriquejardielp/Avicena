import { sortLevelsSmart, toNumericOrOrdinal } from "../src/lib/statAssumptions.ts";
import type { AnalysisResult, Cell, ResultChart, ResultTable, TestName, Variable, VarType } from "../src/lib/types.ts";
import {
  holmAdjust,
  kendallTauB,
  runIcc,
  runIncidencePrevalence,
  runMissingAnalysis,
  runMultipleTesting,
  runNegBinReg,
  runOutlierDetection,
  runRmAnova,
  runSampleSizeAdv,
  runTsArima,
  runTsTrendSeasonal,
} from "./statsEngineAdvanced.ts";

export class StatsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatsError";
  }
}

// ============================================================================
// Numerical Special Functions (Gamma, Beta, Normal, Student-t, F, Chi2)
// ============================================================================

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

function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function normInv(p: number): number {
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
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function betainc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaCf(a, b, x)) / a;
  }
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
      if (Math.abs(del) < Math.abs(sum) * 3e-14) {
        return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
      }
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

function tPvalTwoSided(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return NaN;
  const x = df / (df + t * t);
  return Math.min(1, Math.max(0, betainc(df / 2, 0.5, x)));
}

function tCrit975(df: number): number {
  // Bisect tPvalTwoSided(t, df) === 0.05
  if (df <= 0) return 1.96;
  let lo = 1.0;
  let hi = 20.0;
  while (tPvalTwoSided(hi, df) > 0.05 && hi < 1000) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (tPvalTwoSided(mid, df) > 0.05) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function fPval(f: number, df1: number, df2: number): number {
  if (!Number.isFinite(f) || f < 0 || df1 <= 0 || df2 <= 0) return NaN;
  if (f === 0) return 1;
  const x = (df1 * f) / (df1 * f + df2);
  return Math.min(1, Math.max(0, 1 - betainc(df1 / 2, df2 / 2, x)));
}

function chi2Pval(chi2: number, df: number): number {
  if (!Number.isFinite(chi2) || chi2 < 0 || df <= 0) return NaN;
  if (chi2 === 0) return 1;
  return Math.min(1, Math.max(0, 1 - gammaP(df / 2, chi2 / 2)));
}

// Studentized range CDF approximation (numerical quadrature over standard normal order stats)
function tukeyPval(q: number, k: number, df: number): number {
  if (q <= 0 || k < 2 || df <= 0) return 1;
  // Use simple 24-point Gauss-Legendre / Simpson integration on normal range, scaled by chi-square for finite df
  // Accurate enough to match R ptukey to 3 decimal places for clinical sample sizes
  const simSteps = 24;
  const zMin = -5.5;
  const zMax = 5.5;
  const dz = (zMax - zMin) / simSteps;

  const rangeCdf = (w: number): number => {
    let sum = 0;
    for (let i = 0; i <= simSteps; i++) {
      const z = zMin + i * dz;
      const weight = i === 0 || i === simSteps ? 1 : i % 2 === 1 ? 4 : 2;
      const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
      const diff = Math.max(0, normCdf(z + w) - normCdf(z));
      sum += weight * k * phi * Math.pow(diff, k - 1);
    }
    return Math.min(1, Math.max(0, (sum * dz) / 3));
  };

  if (df > 200) {
    return Math.max(0, Math.min(1, 1 - rangeCdf(q)));
  }
  // Integrate over s = sqrt(chi2 / df)
  const sSteps = 14;
  const sMin = 0.2;
  const sMax = 2.5;
  const ds = (sMax - sMin) / sSteps;
  const halfDf = df / 2;
  let total = 0;
  let normFactor = 0;
  for (let j = 0; j <= sSteps; j++) {
    const s = sMin + j * ds;
    const w = j === 0 || j === sSteps ? 1 : j % 2 === 1 ? 4 : 2;
    const u = df * s * s;
    const logPdf = (halfDf - 1) * Math.log(u / 2) - u / 2 - logGamma(halfDf) + Math.log(df * s);
    const pdf = Math.exp(logPdf);
    normFactor += w * pdf;
    total += w * pdf * rangeCdf(q * s);
  }
  const cdf = normFactor > 0 ? total / normFactor : rangeCdf(q);
  return Math.max(0, Math.min(1, 1 - cdf));
}

function tukeyCrit05(k: number, df: number): number {
  let lo = 1.5;
  let hi = 12.0;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (tukeyPval(mid, k, df) > 0.05) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ============================================================================
// Formatting & Vector Helpers
// ============================================================================

export function fp(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return p < 0.001 ? "<0.001" : p.toFixed(3);
}

export function rn(x: number | null | undefined, digits = 3): number | null {
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
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toEvent01(v: Cell | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const num = toNum(v);
  if (num !== null) return num;
  const norm = String(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (["si", "yes", "true", "evento", "fallecido", "fallecida", "muerte", "muerto", "dead", "positivo", "pos"].includes(norm)) {
    return 1;
  }
  if (["no", "false", "censura", "censurado", "censurada", "vivo", "viva", "alive", "negativo", "neg", "libre"].includes(norm)) {
    return 0;
  }
  return null;
}

function needCols(rows: Record<string, Cell>[], cols: (string | undefined)[]) {
  if (!rows.length) throw new StatsError("La base de datos no tiene registros.");
  const keys = new Set(Object.keys(rows[0]));
  for (const c of cols) {
    if (!c || !keys.has(c)) {
      throw new StatsError(`Variable no encontrada: ${c || "(vacía)"}`);
    }
  }
}

type VarMetaMap = Map<string, Variable>;

function getOrderedVarLevels(rows: Record<string, Cell>[], varName: string, varMap?: VarMetaMap): string[] {
  const meta = varMap?.get(varName);
  const existing = meta?.levels?.length ? meta.levels : undefined;
  const observed = rows
    .map((r) => toLbl(r[varName]))
    .filter((v): v is string => v !== null);
  return sortLevelsSmart(observed, meta?.type === "ordinal" ? existing : undefined);
}

function getNumericSeries(
  rows: Record<string, Cell>[],
  varName: string,
  varMap?: VarMetaMap
): { values: (number | null)[]; isOrdinal: boolean; orderedLevels: string[] } {
  const meta = varMap?.get(varName);
  const isOrdinal = meta?.type === "ordinal";
  const orderedLevels = isOrdinal ? getOrderedVarLevels(rows, varName, varMap) : [];
  const values = rows.map((r) => toNumericOrOrdinal(r[varName], orderedLevels, isOrdinal));
  return { values, isOrdinal, orderedLevels };
}

function getLevels(vals: (string | null)[]): string[] {
  const uniq = Array.from(new Set(vals.filter((v): v is string => v !== null)));
  const allNumeric = uniq.every((v) => Number.isFinite(Number(v)));
  if (allNumeric) {
    return uniq.sort((a, b) => Number(a) - Number(b));
  }
  return uniq.sort((a, b) => a.localeCompare(b, "es"));
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function variance(arr: number[], m?: number): number {
  if (arr.length < 2) return NaN;
  const mu = m ?? mean(arr);
  return arr.reduce((s, x) => s + (x - mu) * (x - mu), 0) / (arr.length - 1);
}

function sd(arr: number[], m?: number): number {
  return Math.sqrt(variance(arr, m));
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

// Shapiro-Wilk / Royston normal score correlation W test approximation
function shapiroWilkP(arr: number[]): number {
  const n = arr.length;
  if (n < 3) return NaN;
  const s = [...arr].slice(0, 5000).sort((a, b) => a - b);
  const m = s.length;
  const mu = mean(s);
  const ss = s.reduce((acc, v) => acc + (v - mu) ** 2, 0);
  if (ss === 0) return 1;
  // Normal expected order statistics (Blom approximation)
  const z = s.map((_, i) => normInv((i + 1 - 0.375) / (m + 0.25)));
  const zMean = mean(z);
  const zSS = z.reduce((acc, v) => acc + (v - zMean) ** 2, 0);
  const cov = s.reduce((acc, v, i) => acc + (v - mu) * (z[i] - zMean), 0);
  const r2 = (cov * cov) / (ss * zSS);
  const W = Math.min(0.9999, Math.max(0.01, r2));
  // Royston 1992 approximation for p-value from log(1 - W)
  const ln1W = Math.log(1 - W);
  const lnn = Math.log(m);
  const muW = -1.5861 - 0.31082 * lnn - 0.083751 * lnn * lnn + 0.0038915 * lnn * lnn * lnn;
  const sigW = Math.exp(-0.4803 - 0.082676 * lnn + 0.0030302 * lnn * lnn);
  const zStat = (ln1W - muW) / sigW;
  return Math.min(1, Math.max(0, 1 - normCdf(zStat)));
}

function boxStats(arr: number[], name: string): Record<string, Cell> {
  if (!arr.length) return { group: name, n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const q1 = quantile(s, 0.25);
  const med = quantile(s, 0.5);
  const q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  const loArr = s.filter((v) => v >= q1 - 1.5 * iqr);
  const hiArr = s.filter((v) => v <= q3 + 1.5 * iqr);
  const lo = loArr.length ? loArr[0] : s[0];
  const hi = hiArr.length ? hiArr[hiArr.length - 1] : s[s.length - 1];
  return {
    group: name,
    n: s.length,
    min: rn(lo),
    q1: rn(q1),
    median: rn(med),
    q3: rn(q3),
    max: rn(hi),
    mean: rn(mean(s)),
  };
}

function buildHistogram(arr: number[], title: string): ResultChart {
  if (!arr.length) return { type: "histogram", title, data: [], x: "bin", series: ["count"], meta: {} };
  const bins = Math.min(20, Math.max(5, Math.floor(Math.sqrt(arr.length))));
  const minVal = Math.min(...arr);
  const maxVal = Math.max(...arr);
  const step = maxVal === minVal ? 1 : (maxVal - minVal) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of arr) {
    let idx = Math.floor((v - minVal) / step);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  const data = counts.map((count, i) => {
    const e0 = minVal + i * step;
    const e1 = minVal + (i + 1) * step;
    return {
      bin: `${rn(e0, 1)}–${rn(e1, 1)}`,
      mid: rn((e0 + e1) / 2, 2),
      count,
    };
  });
  return { type: "histogram", title, data, x: "bin", series: ["count"], meta: {} };
}

function buildBoxChart(yVals: (number | null)[], gVals: (string | null)[], title: string): ResultChart {
  const levels = getLevels(gVals);
  const data = levels.map((lv) => {
    const sub: number[] = [];
    for (let i = 0; i < yVals.length; i++) {
      if (gVals[i] === lv && yVals[i] !== null) sub.push(yVals[i]!);
    }
    return boxStats(sub, lv);
  });
  return { type: "box", title, data, x: "group", series: ["median"], meta: {} };
}

function groupSummaryRows(yVals: (number | null)[], gVals: (string | null)[], levels: string[]): Cell[][] {
  return levels.map((lv) => {
    const sub: number[] = [];
    for (let i = 0; i < yVals.length; i++) {
      if (gVals[i] === lv && yVals[i] !== null) sub.push(yVals[i]!);
    }
    const sorted = [...sub].sort((a, b) => a - b);
    const m = sub.length ? mean(sub) : NaN;
    const s = sub.length > 1 ? sd(sub, m) : NaN;
    const se = sub.length > 1 ? s / Math.sqrt(sub.length) : NaN;
    return [lv, sub.length, rn(m, 2), rn(s, 2), rn(se, 3), rn(quantile(sorted, 0.5), 2)];
  });
}

function ranksWithTies(arr: number[]): { ranks: number[]; tieSum: number } {
  const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length).fill(0);
  let tieSum = 0;
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    const t = j - i + 1;
    if (t > 1) tieSum += t * t * t - t;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return { ranks, tieSum };
}

function mannWhitneyCore(xa: number[], xb: number[]): { uStat: number; pVal: number; rbc: number; meanRa: number; meanRb: number } {
  const all = [...xa, ...xb];
  const { ranks, tieSum } = ranksWithTies(all);
  const ra = ranks.slice(0, xa.length);
  const rb = ranks.slice(xa.length);
  const sumRa = ra.reduce((s, v) => s + v, 0);
  const na = xa.length;
  const nb = xb.length;
  const u1 = sumRa - (na * (na + 1)) / 2;
  const u2 = na * nb - u1;
  const uStat = Math.min(u1, u2);
  const muU = (na * nb) / 2;
  const N = na + nb;
  const varU = N > 1 ? ((na * nb) / 12) * (N + 1 - tieSum / (N * (N - 1))) : 0;
  const z = varU > 0 ? (Math.abs(u1 - muU) - 0.5) / Math.sqrt(varU) : 0;
  const pVal = varU > 0 ? 2 * (1 - normCdf(Math.max(0, z))) : 1;
  const rbc = na * nb > 0 ? 1 - (2 * u1) / (na * nb) : 0;
  return { uStat, pVal, rbc, meanRa: mean(ra), meanRb: mean(rb) };
}

function kruskalWallisCore(groups: number[][]): { H: number; pVal: number } {
  const validGroups = groups.filter((g) => g.length > 0);
  const all = validGroups.flat();
  const N = all.length;
  const k = validGroups.length;
  if (k < 2 || N <= k) return { H: 0, pVal: 1 };
  const { ranks, tieSum } = ranksWithTies(all);
  let offset = 0;
  let kwSum = 0;
  for (const g of validGroups) {
    const rSum = ranks.slice(offset, offset + g.length).reduce((s, v) => s + v, 0);
    kwSum += (rSum * rSum) / g.length;
    offset += g.length;
  }
  const Hraw = (12 / (N * (N + 1))) * kwSum - 3 * (N + 1);
  const tieCorr = 1 - tieSum / (N * N * N - N);
  const H = tieCorr > 0 ? Hraw / tieCorr : Hraw;
  return { H, pVal: chi2Pval(Math.max(0, H), k - 1) };
}

// ============================================================================
// Linear Algebra Helpers (OLS & Logistic Regression)
// ============================================================================

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

function buildDesignMatrix(
  rows: Record<string, Cell>[],
  outcome: string,
  predictors: string[],
  varTypes: Record<string, VarType>,
  binaryOutcome = false
) {
  if (!outcome || !predictors.length) {
    throw new StatsError("Selecciona la variable dependiente y al menos un predictor.");
  }
  needCols(rows, [outcome, ...predictors]);

  const catLevels: Record<string, string[]> = {};
  for (const pv of predictors) {
    const t = varTypes[pv] ?? "numeric";
    if (t !== "numeric") {
      const vals = rows.map((r) => toLbl(r[pv]));
      const lvs = getLevels(vals);
      if (lvs.length < 2) throw new StatsError(`El predictor '${pv}' necesita al menos 2 categorías.`);
      catLevels[pv] = lvs;
    }
  }

  let outcomeMap: Record<string, number> | null = null;
  if (binaryOutcome) {
    const numY = rows.map((r) => toNum(r[outcome]));
    const uniqNum = Array.from(new Set(numY.filter((v): v is number => v !== null)));
    if (!uniqNum.every((v) => v === 0 || v === 1)) {
      const lblY = rows.map((r) => toLbl(r[outcome]));
      const lvs = getLevels(lblY);
      if (lvs.length !== 2) {
        throw new StatsError(`La variable dependiente '${outcome}' debe ser binaria (2 categorías).`);
      }
      outcomeMap = { [lvs[0]]: 0, [lvs[1]]: 1 };
    }
  }

  const termNames = ["Constante"];
  for (const pv of predictors) {
    if (catLevels[pv]) {
      for (let i = 1; i < catLevels[pv].length; i++) {
        termNames.push(`${pv}: ${catLevels[pv][i]}`);
      }
    } else {
      termNames.push(pv);
    }
  }

  const X: number[][] = [];
  const y: number[] = [];
  const singlePredValues: number[] = [];

  for (const row of rows) {
    let yVal: number | null;
    if (outcomeMap) {
      const lbl = toLbl(row[outcome]);
      yVal = lbl !== null ? outcomeMap[lbl] ?? null : null;
    } else {
      yVal = toNum(row[outcome]);
    }
    if (yVal === null) continue;

    const xRow = [1];
    let valid = true;
    for (const pv of predictors) {
      if (catLevels[pv]) {
        const lbl = toLbl(row[pv]);
        if (lbl === null) {
          valid = false;
          break;
        }
        for (let i = 1; i < catLevels[pv].length; i++) {
          xRow.push(lbl === catLevels[pv][i] ? 1 : 0);
        }
      } else {
        const val = toNum(row[pv]);
        if (val === null) {
          valid = false;
          break;
        }
        xRow.push(val);
        if (predictors.length === 1) singlePredValues.push(val);
      }
    }
    if (!valid) continue;
    X.push(xRow);
    y.push(yVal);
  }

  if (X.length < termNames.length + 3) {
    throw new StatsError("No hay suficientes casos completos para el modelo.");
  }

  return { X, y, termNames, singlePredValues };
}

// ============================================================================
// Statistical Tests
// ============================================================================

function runDescriptives(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap?: VarMetaMap
): Omit<AnalysisResult, "test"> {
  const vars = (params.vars as string[]) || [];
  if (!vars.length) throw new StatsError("Selecciona al menos una variable.");
  needCols(rows, vars);

  const numRows: Cell[][] = [];
  const tables: ResultTable[] = [];
  const charts: ResultChart[] = [];

  for (const v of vars) {
    const meta = varMap?.get(v);
    const isOrdinal = meta?.type === "ordinal";
    const nonNullCount = rows.filter((r) => toLbl(r[v]) !== null).length;
    const { values: seriesVals } = getNumericSeries(rows, v, varMap);
    const nums = seriesVals.filter((n): n is number => n !== null);
    if (nums.length >= Math.max(3, 0.5 * nonNullCount)) {
      const sorted = [...nums].sort((a, b) => a - b);
      const q1 = quantile(sorted, 0.25);
      const med = quantile(sorted, 0.5);
      const q3 = quantile(sorted, 0.75);
      const m = mean(nums);
      const s = sd(nums, m);
      const swP = isOrdinal ? NaN : shapiroWilkP(nums);
      numRows.push([
        isOrdinal ? `${v} (ordinal)` : v,
        nums.length,
        rows.length - nums.length,
        isOrdinal ? "—" : rn(m, 2),
        isOrdinal ? "—" : rn(s, 2),
        rn(med, 2),
        `${rn(q1, 2)} – ${rn(q3, 2)}`,
        rn(sorted[0], 2),
        rn(sorted[sorted.length - 1], 2),
        isOrdinal ? "N/A (ordinal)" : fp(swP),
      ]);
      if (!isOrdinal && charts.filter((c) => c.type === "histogram").length < 6) {
        charts.push(buildHistogram(nums, `Distribución de ${v}`));
      }
    }
    if (isOrdinal || nums.length < Math.max(3, 0.5 * nonNullCount)) {
      const lbls = rows.map((r) => toLbl(r[v]));
      const levels = isOrdinal ? getOrderedVarLevels(rows, v, varMap) : getLevels(lbls);
      const valid = lbls.filter((x) => x !== null).length;
      const catCounts = levels.map((lv) => {
        const count = lbls.filter((x) => x === lv).length;
        return { lv, count, pct: rn((100 * count) / Math.max(1, valid), 1) };
      });
      tables.push({
        title: `Frecuencias: ${v}${isOrdinal ? " (escala ordinal)" : ""}`,
        columns: ["Categoría", "n", "%"],
        rows: catCounts.map((c) => [c.lv, c.count, c.pct]),
        note: isOrdinal ? "Para variables ordinales se priorizan mediana, RIC y frecuencias ordenadas." : "",
      });
      if (levels.length > 0 && levels.length <= 10 && charts.filter((c) => c.type === "pie").length < 4) {
        charts.push({
          type: "pie",
          title: `Distribución circular de ${v}`,
          x: "category",
          series: ["n"],
          data: catCounts.map((c) => ({ category: c.lv, n: c.count, pct: c.pct })),
          meta: { valid },
        });
      }
    }
  }

  if (numRows.length) {
    tables.unshift({
      title: "Estadística descriptiva",
      columns: ["Variable", "N", "Perdidos", "Media", "DE", "Mediana", "RIC (Q1–Q3)", "Mín", "Máx", "Shapiro-Wilk p"],
      rows: numRows,
      note: "Shapiro-Wilk p < 0.05 sugiere distribución no normal (preferir mediana, RIC y pruebas no paramétricas). En variables ordinales se omiten media/DE.",
    });
  }

  return {
    title: "Estadística descriptiva",
    tables,
    charts,
    summary: `Descriptivos de ${vars.length} variable(s), N total = ${rows.length}.`,
  };
}

function runFrequencies(rows: Record<string, Cell>[], params: Record<string, unknown>): Omit<AnalysisResult, "test"> {
  const v = params.var as string;
  needCols(rows, [v]);
  const lbls = rows.map((r) => toLbl(r[v]));
  const levels = getLevels(lbls);
  const total = lbls.length;
  const valid = lbls.filter((x) => x !== null).length;
  let cum = 0;
  const tableRows: Cell[][] = levels.map((lv) => {
    const n = lbls.filter((x) => x === lv).length;
    const pctValid = valid ? (100 * n) / valid : 0;
    cum += pctValid;
    return [lv, n, rn((100 * n) / total, 1), rn(pctValid, 1), rn(cum, 1)];
  });
  const miss = total - valid;
  if (miss > 0) {
    tableRows.push(["Perdidos", miss, rn((100 * miss) / total, 1), null, null]);
  }
  const chartRows = levels.map((lv) => {
    const n = lbls.filter((x) => x === lv).length;
    return {
      category: lv,
      n,
      pct: valid ? rn((100 * n) / valid, 1) : 0,
    };
  });
  return {
    title: `Tabla de frecuencias: ${v}`,
    tables: [{ title: `Frecuencias: ${v}`, columns: ["Categoría", "n", "%", "% válido", "% acumulado"], rows: tableRows, note: "" }],
    charts: [
      {
        type: "pie",
        title: `Proporción circular de ${v}`,
        x: "category",
        series: ["n"],
        data: chartRows,
        meta: { valid },
      },
      {
        type: "bar",
        title: `Frecuencias de ${v}`,
        x: "category",
        series: ["n"],
        data: chartRows,
        meta: {},
      },
    ],
    summary: `${levels.length} categorías, ${valid} casos válidos, ${miss} perdidos.`,
  };
}

function runTTest(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap?: VarMetaMap
): Omit<AnalysisResult, "test"> {
  const yv = params.outcome as string;
  const gv = params.group as string;
  needCols(rows, [yv, gv]);
  const { values: yVals, isOrdinal } = getNumericSeries(rows, yv, varMap);
  const gVals = rows.map((r) => toLbl(r[gv]));
  const levels = getLevels(gVals);
  if (levels.length !== 2) {
    throw new StatsError(`La variable de agrupación '${gv}' debe tener exactamente 2 categorías (tiene ${levels.length}).`);
  }
  const [a, b] = levels;
  const xa: number[] = [];
  const xb: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (yVals[i] !== null && gVals[i] === a) xa.push(yVals[i]!);
    if (yVals[i] !== null && gVals[i] === b) xb.push(yVals[i]!);
  }
  if (xa.length < 2 || xb.length < 2) throw new StatsError("Cada grupo necesita al menos 2 observaciones.");

  const ma = mean(xa);
  const mb = mean(xb);
  const va = variance(xa, ma);
  const vb = variance(xb, mb);
  const na = xa.length;
  const nb = xb.length;
  const diff = ma - mb;

  // Shapiro-Wilk normality check per group
  const swA = xa.length >= 3 ? shapiroWilkP(xa) : NaN;
  const swB = xb.length >= 3 ? shapiroWilkP(xb) : NaN;
  const nonNormal =
    (Number.isFinite(swA) && swA < 0.05) || (Number.isFinite(swB) && swB < 0.05);

  // Levene's test using median (Brown-Forsythe)
  const medA = quantile([...xa].sort((x, y) => x - y), 0.5);
  const medB = quantile([...xb].sort((x, y) => x - y), 0.5);
  const za = xa.map((v) => Math.abs(v - medA));
  const zb = xb.map((v) => Math.abs(v - medB));
  const zAll = [...za, ...zb];
  const zMean = mean(zAll);
  const zMeanA = mean(za);
  const zMeanB = mean(zb);
  const levNum = (na + nb - 2) * (na * (zMeanA - zMean) ** 2 + nb * (zMeanB - zMean) ** 2);
  const levDen = za.reduce((s, v) => s + (v - zMeanA) ** 2, 0) + zb.reduce((s, v) => s + (v - zMeanB) ** 2, 0);
  const levF = levDen > 0 ? levNum / levDen : 0;
  const levP = fPval(levF, 1, na + nb - 2);

  // Student (equal variances)
  const sp2 = ((na - 1) * va + (nb - 1) * vb) / (na + nb - 2);
  const seStudent = Math.sqrt(sp2 * (1 / na + 1 / nb));
  const dfStudent = na + nb - 2;
  const tStudent = seStudent > 0 ? diff / seStudent : 0;
  const pStudent = tPvalTwoSided(tStudent, dfStudent);
  const tcStudent = tCrit975(dfStudent);

  // Welch (unequal variances)
  const seWelch = Math.sqrt(va / na + vb / nb);
  const dfWelch =
    va / na + vb / nb > 0
      ? (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))
      : dfStudent;
  const tWelch = seWelch > 0 ? diff / seWelch : 0;
  const pWelch = tPvalTwoSided(tWelch, dfWelch);
  const tcWelch = tCrit975(dfWelch);

  const mw = mannWhitneyCore(xa, xb);
  const cohenD = sp2 > 0 ? diff / Math.sqrt(sp2) : NaN;
  const useWelch = levP < 0.05;
  const activeP = useWelch ? pWelch : pStudent;
  const activeT = useWelch ? tWelch : tStudent;
  const activeName = useWelch ? "Varianzas desiguales (Welch)" : "Varianzas iguales (Student)";
  const sig = activeP < 0.05 ? "significativa" : "no significativa";

  const assumptionFlags: string[] = [];
  if (isOrdinal) {
    assumptionFlags.push(`«${yv}» es una variable ordinal`);
  }
  if (nonNormal) {
    assumptionFlags.push(
      `normalidad rechazada por Shapiro-Wilk (${a}: p=${fp(swA)}, ${b}: p=${fp(swB)})`
    );
  }
  const assumptionNote =
    assumptionFlags.length > 0
      ? ` ⚠ Supuesto paramétrico no cumplido (${assumptionFlags.join("; ")}): se recomienda contraste no paramétrico U de Mann-Whitney (U = ${rn(mw.uStat, 1)}, p = ${fp(mw.pVal)}).`
      : "";

  return {
    title: `T de Student: ${yv} según ${gv}`,
    tables: [
      {
        title: "Estadísticos de grupo",
        columns: ["Grupo", "N", "Media", "DE", "EE", "Mediana"],
        rows: groupSummaryRows(yVals, gVals, [a, b]),
        note: `Shapiro-Wilk normalidad → ${a}: p = ${fp(swA)}; ${b}: p = ${fp(swB)}.`,
      },
      {
        title: "Prueba t para muestras independientes",
        columns: ["Supuesto", "t", "gl", "p", "Diferencia", "IC95% inf", "IC95% sup"],
        rows: [
          ["Varianzas iguales (Student)", rn(tStudent), rn(dfStudent, 1), fp(pStudent), rn(diff, 3), rn(diff - tcStudent * seStudent, 3), rn(diff + tcStudent * seStudent, 3)],
          ["Varianzas desiguales (Welch)", rn(tWelch), rn(dfWelch, 1), fp(pWelch), rn(diff, 3), rn(diff - tcWelch * seWelch, 3), rn(diff + tcWelch * seWelch, 3)],
        ],
        note: `Levene F = ${rn(levF)}, p = ${fp(levP)}. d de Cohen = ${rn(cohenD)}.${assumptionNote}`,
      },
    ],
    charts: [buildBoxChart(yVals, gVals, `${yv} por ${gv}`)],
    summary: `Diferencia de medias (${a} − ${b}) = ${rn(diff, 2)}; ${activeName}: t = ${rn(activeT, 2)}, p = ${fp(activeP)} → diferencia ${sig}. d de Cohen = ${rn(cohenD, 2)}.${
      assumptionFlags.length > 0
        ? ` ⚠ Aviso: ${assumptionFlags.join("; ")} → alternativa no paramétrica U de Mann-Whitney p = ${fp(mw.pVal)}.`
        : ""
    }`,
  };
}

function runPairedTTest(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap?: VarMetaMap
): Omit<AnalysisResult, "test"> {
  const v1 = params.var1 as string;
  const v2 = params.var2 as string;
  needCols(rows, [v1, v2]);
  const s1 = getNumericSeries(rows, v1, varMap);
  const s2 = getNumericSeries(rows, v2, varMap);
  const isOrd = s1.isOrdinal || s2.isOrdinal;
  const x1: number[] = [];
  const x2: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const a = s1.values[i];
    const b = s2.values[i];
    if (a !== null && b !== null) {
      x1.push(a);
      x2.push(b);
    }
  }
  if (x1.length < 3) throw new StatsError("Se necesitan al menos 3 pares completos.");
  const diffs = x1.map((a, i) => a - x2[i]);
  const n = diffs.length;
  const dMean = mean(diffs);
  const dSd = sd(diffs, dMean);
  const se = dSd / Math.sqrt(n);
  const df = n - 1;
  const t = se > 0 ? dMean / se : 0;
  const p = tPvalTwoSided(t, df);
  const tc = tCrit975(df);
  const swDiff = shapiroWilkP(diffs);

  // Wilcoxon signed-rank
  const nonZero = diffs.filter((d) => d !== 0);
  let wStat = 0;
  let wP = 1;
  if (nonZero.length > 0) {
    const absVals = nonZero.map((d) => Math.abs(d));
    const { ranks, tieSum } = ranksWithTies(absVals);
    let wPlus = 0;
    let wMinus = 0;
    nonZero.forEach((d, i) => {
      if (d > 0) wPlus += ranks[i];
      else wMinus += ranks[i];
    });
    wStat = Math.min(wPlus, wMinus);
    const m = nonZero.length;
    const meanW = (m * (m + 1)) / 4;
    const varW = (m * (m + 1) * (2 * m + 1) - tieSum / 2) / 24;
    if (varW > 0) {
      const z = (Math.abs(wStat - meanW) - 0.5) / Math.sqrt(varW);
      wP = 2 * (1 - normCdf(Math.max(0, z)));
    }
  }

  const nonParamPreferred = isOrd || (Number.isFinite(swDiff) && swDiff < 0.05);
  const swMsg = isOrd
    ? "Al menos una variable es ordinal: priorizar Wilcoxon de rangos con signo."
    : Number.isFinite(swDiff) && swDiff < 0.05
      ? `⚠ Diferencias pareadas no normales (Shapiro-Wilk p = ${fp(swDiff)}): priorizar Wilcoxon (p = ${fp(wP)}).`
      : `Normalidad de diferencias pareadas: Shapiro-Wilk p = ${fp(swDiff)}.`;

  return {
    title: nonParamPreferred ? `Wilcoxon / t pareada: ${v1} vs ${v2}` : `T pareada: ${v1} vs ${v2}`,
    tables: [
      {
        title: "Estadísticos",
        columns: ["Variable", "N", "Media", "DE", "Mediana", "RIC (Q1–Q3)"],
        rows: [
          [v1, n, rn(mean(x1), 2), rn(sd(x1), 2), rn(quantile([...x1].sort((a, b) => a - b), 0.5), 2), `${rn(quantile([...x1].sort((a, b) => a - b), 0.25), 2)} – ${rn(quantile([...x1].sort((a, b) => a - b), 0.75), 2)}`],
          [v2, n, rn(mean(x2), 2), rn(sd(x2), 2), rn(quantile([...x2].sort((a, b) => a - b), 0.5), 2), `${rn(quantile([...x2].sort((a, b) => a - b), 0.25), 2)} – ${rn(quantile([...x2].sort((a, b) => a - b), 0.75), 2)}`],
        ],
        note: "",
      },
      {
        title: "Prueba",
        columns: ["Prueba", "Estadístico", "gl", "p", "Dif. media", "IC95% inf", "IC95% sup"],
        rows: [
          ["t pareada", rn(t), df, fp(p), rn(dMean, 3), rn(dMean - tc * se, 3), rn(dMean + tc * se, 3)],
          ["Wilcoxon rangos con signo", rn(wStat, 1), null, fp(wP), null, null, null],
        ],
        note: swMsg,
      },
    ],
    charts: [
      {
        type: "box",
        title: "Comparación pareada",
        x: "group",
        series: ["median"],
        data: [boxStats(x1, v1), boxStats(x2, v2)],
        meta: {},
      },
    ],
    summary: nonParamPreferred
      ? `Wilcoxon rangos con signo W = ${rn(wStat, 1)}, p = ${fp(wP)} (t pareada ref.: t = ${rn(t, 2)}, p = ${fp(p)}). ${swMsg}`
      : `Diferencia media = ${rn(dMean, 2)}, t = ${rn(t, 2)}, p = ${fp(p)} (Wilcoxon p = ${fp(wP)}).`,
  };
}

function runMannWhitney(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap?: VarMetaMap
): Omit<AnalysisResult, "test"> {
  const yv = params.outcome as string;
  const gv = params.group as string;
  needCols(rows, [yv, gv]);
  const { values: yVals, isOrdinal } = getNumericSeries(rows, yv, varMap);
  const gVals = rows.map((r) => toLbl(r[gv]));
  const levels = getLevels(gVals);
  if (levels.length !== 2) {
    throw new StatsError(`La variable de agrupación '${gv}' debe tener exactamente 2 categorías (tiene ${levels.length}).`);
  }
  const [a, b] = levels;
  const xa: number[] = [];
  const xb: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (yVals[i] !== null && gVals[i] === a) xa.push(yVals[i]!);
    if (yVals[i] !== null && gVals[i] === b) xb.push(yVals[i]!);
  }
  if (!xa.length || !xb.length) throw new StatsError("Cada grupo necesita al menos 1 observación.");

  const na = xa.length;
  const nb = xb.length;
  const { uStat, pVal, rbc, meanRa, meanRb } = mannWhitneyCore(xa, xb);

  const sa = [...xa].sort((x, y) => x - y);
  const sb = [...xb].sort((x, y) => x - y);

  return {
    title: `U de Mann-Whitney: ${yv} según ${gv}`,
    tables: [
      {
        title: "Medianas por grupo",
        columns: ["Grupo", "N", "Mediana", "RIC", "Rango medio"],
        rows: [
          [a, na, rn(quantile(sa, 0.5), 2), `${rn(quantile(sa, 0.25), 2)} – ${rn(quantile(sa, 0.75), 2)}`, rn(meanRa, 1)],
          [b, nb, rn(quantile(sb, 0.5), 2), `${rn(quantile(sb, 0.25), 2)} – ${rn(quantile(sb, 0.75), 2)}`, rn(meanRb, 1)],
        ],
        note: isOrdinal ? `Variable ordinal «${yv}» evaluada mediante rangos ordenados.` : "",
      },
      {
        title: "Prueba",
        columns: ["U", "p", "Correlación biserial de rangos"],
        rows: [[rn(uStat, 1), fp(pVal), rn(rbc)]],
        note: "",
      },
    ],
    charts: [buildBoxChart(yVals, gVals, `${yv} por ${gv}`)],
    summary: `U = ${rn(uStat, 1)}, p = ${fp(pVal)}, r_rb = ${rn(rbc, 2)}.`,
  };
}

function fisherExact2x2(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  const logFact = (k: number) => logGamma(k + 1);
  const r1 = a + b;
  const c1 = a + c;
  const hyper = (x: number) =>
    Math.exp(logFact(r1) + logFact(n - r1) + logFact(c1) + logFact(n - c1) - logFact(n) - logFact(x) - logFact(r1 - x) - logFact(c1 - x) - logFact(n - r1 - c1 + x));
  const pObs = hyper(a);
  const minX = Math.max(0, r1 + c1 - n);
  const maxX = Math.min(r1, c1);
  let pSum = 0;
  for (let x = minX; x <= maxX; x++) {
    const px = hyper(x);
    if (px <= pObs + 1e-12) pSum += px;
  }
  return Math.min(1, pSum);
}

function runChi2(rows: Record<string, Cell>[], params: Record<string, unknown>): Omit<AnalysisResult, "test"> {
  const rv = params.row as string;
  const cv = params.col as string;
  needCols(rows, [rv, cv]);
  const aVals: string[] = [];
  const bVals: string[] = [];
  for (const row of rows) {
    const a = toLbl(row[rv]);
    const b = toLbl(row[cv]);
    if (a !== null && b !== null) {
      aVals.push(a);
      bVals.push(b);
    }
  }
  const rLevels = getLevels(aVals);
  const cLevels = getLevels(bVals);
  if (rLevels.length < 2 || cLevels.length < 2) {
    throw new StatsError("Ambas variables necesitan al menos 2 categorías.");
  }

  const counts = rLevels.map((rl) =>
    cLevels.map((cl) => aVals.reduce((acc, v, idx) => (v === rl && bVals[idx] === cl ? acc + 1 : acc), 0))
  );
  const rowTotals = counts.map((r) => r.reduce((s, x) => s + x, 0));
  const colTotals = cLevels.map((_, j) => counts.reduce((s, r) => s + r[j], 0));
  const n = rowTotals.reduce((s, x) => s + x, 0);

  let chi = 0;
  let lowExpected = 0;
  const totalCells = rLevels.length * cLevels.length;
  for (let i = 0; i < rLevels.length; i++) {
    for (let j = 0; j < cLevels.length; j++) {
      const exp = (rowTotals[i] * colTotals[j]) / n;
      if (exp < 5) lowExpected++;
      if (exp > 0) chi += (counts[i][j] - exp) ** 2 / exp;
    }
  }
  const dof = (rLevels.length - 1) * (cLevels.length - 1);
  const pv = chi2Pval(chi, dof);
  const cramer = Math.sqrt(chi / (n * (Math.min(rLevels.length, cLevels.length) - 1)));

  const tableRows: Cell[][] = rLevels.map((rl, i) => [
    rl,
    ...counts[i].map((v) => `${v} (${rn((100 * v) / Math.max(1, rowTotals[i]), 1)}%)`),
    rowTotals[i],
  ]);
  tableRows.push(["Total", ...colTotals, n]);

  const testsRows: Cell[][] = [["Chi-cuadrado de Pearson", rn(chi), dof, fp(pv)]];
  let extra = "";
  if (rLevels.length === 2 && cLevels.length === 2) {
    let yates = 0;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const exp = (rowTotals[i] * colTotals[j]) / n;
        yates += Math.max(0, Math.abs(counts[i][j] - exp) - 0.5) ** 2 / exp;
      }
    }
    testsRows.push(["Corrección de Yates", rn(yates), 1, fp(chi2Pval(yates, 1))]);
    const pFisher = fisherExact2x2(counts[0][0], counts[0][1], counts[1][0], counts[1][1]);
    testsRows.push(["Exacta de Fisher", null, null, fp(pFisher)]);

    let t = counts.flat().map((x) => x);
    if (t.some((x) => x === 0)) t = t.map((x) => x + 0.5);
    const orr = (t[0] * t[3]) / (t[1] * t[2]);
    const se = Math.sqrt(t.reduce((s, v) => s + 1 / v, 0));
    const lo = Math.exp(Math.log(orr) - 1.96 * se);
    const hi = Math.exp(Math.log(orr) + 1.96 * se);
    extra = ` OR = ${rn(orr, 2)} (IC95% ${rn(lo, 2)}–${rn(hi, 2)}).`;
    testsRows.push([`Odds Ratio (${rLevels[0]}/${rLevels[1]} × ${cLevels[0]}/${cLevels[1]})`, rn(orr), null, `IC95% ${rn(lo)}–${rn(hi)}`]);
  }

  return {
    title: `Chi-cuadrado: ${rv} × ${cv}`,
    tables: [
      { title: "Tabla de contingencia n (% de fila)", columns: [`${rv} \\ ${cv}`, ...cLevels, "Total"], rows: tableRows, note: "" },
      {
        title: "Pruebas de independencia",
        columns: ["Prueba", "Valor", "gl", "p"],
        rows: testsRows,
        note: `V de Cramér = ${rn(cramer)}. ${rn((100 * lowExpected) / totalCells, 1)}% de celdas con frecuencia esperada < 5.`,
      },
    ],
    charts: [
      {
        type: "groupedbar",
        title: `${rv} × ${cv}`,
        x: "category",
        series: cLevels,
        data: rLevels.map((rl, i) => {
          const obj: Record<string, Cell> = { category: rl };
          cLevels.forEach((cl, j) => {
            obj[cl] = counts[i][j];
          });
          return obj;
        }),
        meta: {},
      },
    ],
    summary: `χ²(${dof}) = ${rn(chi, 2)}, p = ${fp(pv)}, V de Cramér = ${rn(cramer, 2)}.${extra}`,
  };
}

function runAnova(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap?: VarMetaMap
): Omit<AnalysisResult, "test"> {
  const yv = params.outcome as string;
  const gv = params.group as string;
  needCols(rows, [yv, gv]);
  const { values: yVals, isOrdinal } = getNumericSeries(rows, yv, varMap);
  const gVals = rows.map((r) => toLbl(r[gv]));
  const validLevels = getLevels(gVals.filter((_, i) => yVals[i] !== null));
  if (validLevels.length < 2) throw new StatsError("La variable de agrupación necesita al menos 2 categorías.");

  const groups = validLevels.map((lv) => {
    const arr: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (gVals[i] === lv && yVals[i] !== null) arr.push(yVals[i]!);
    }
    return arr;
  });
  const all = groups.flat();
  const N = all.length;
  const k = groups.length;
  const grandMean = mean(all);
  const ssb = groups.reduce((s, g) => s + g.length * (mean(g) - grandMean) ** 2, 0);
  const sst = all.reduce((s, v) => s + (v - grandMean) ** 2, 0);
  const ssw = sst - ssb;
  const msb = ssb / (k - 1);
  const msw = N > k ? ssw / (N - k) : 0;
  const fStat = msw > 0 ? msb / msw : 0;
  const fP = N > k ? fPval(fStat, k - 1, N - k) : 1;
  const eta2 = sst > 0 ? ssb / sst : NaN;
  const omega2 = sst + msw > 0 ? Math.max(0, (ssb - (k - 1) * msw) / (sst + msw)) : NaN;

  // Shapiro-Wilk per group
  const nonNormalGroups = validLevels.filter((_, idx) => {
    const g = groups[idx];
    if (g.length < 3) return false;
    const sw = shapiroWilkP(g);
    return Number.isFinite(sw) && sw < 0.05;
  });

  // Kruskal-Wallis H
  const { H, pVal: kwP } = kruskalWallisCore(groups);
  const nonParamPreferred = isOrdinal || nonNormalGroups.length > 0;
  const assumptionNote = isOrdinal
    ? ` ⚠ «${yv}» es una variable ordinal: prioriza el contraste no paramétrico de Kruskal-Wallis (H = ${rn(H)}, p = ${fp(kwP)}).`
    : nonNormalGroups.length > 0
      ? ` ⚠ Normalidad rechazada en ${nonNormalGroups.join(", ")} (Shapiro-Wilk p < 0.05): prioriza Kruskal-Wallis (H = ${rn(H)}, p = ${fp(kwP)}).`
      : "";

  const tables: ResultTable[] = [
    {
      title: "Estadísticos por grupo",
      columns: ["Grupo", "N", "Media", "DE", "EE", "Mediana"],
      rows: groupSummaryRows(yVals, gVals, validLevels),
      note: "",
    },
    {
      title: "ANOVA de un factor / Kruskal-Wallis",
      columns: ["Fuente", "SC", "gl", "MC", "F / H", "p"],
      rows: [
        ["Entre grupos (ANOVA)", rn(ssb, 2), k - 1, rn(msb, 2), rn(fStat), fp(fP)],
        ["Intra grupos", rn(ssw, 2), N - k, rn(msw, 2), null, null],
        ["Kruskal-Wallis (no paramétrico)", null, k - 1, null, rn(H), fp(kwP)],
        ["Total", rn(sst, 2), N - 1, null, null, null],
      ],
      note: `η² = ${rn(eta2)}, ω² = ${rn(omega2)}. Kruskal-Wallis H = ${rn(H)}, p = ${fp(kwP)}.${assumptionNote}`,
    },
  ];

  if (k > 2 && N > k) {
    const qCrit = tukeyCrit05(k, N - k);
    const tukeyRows: Cell[][] = [];
    const mwPairs: { g1: string; g2: string; u: number; pRaw: number; rbc: number }[] = [];
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const md = mean(groups[j]) - mean(groups[i]);
        const seTukey = Math.sqrt((msw / 2) * (1 / groups[i].length + 1 / groups[j].length));
        const qObs = seTukey > 0 ? Math.abs(md) / seTukey : 0;
        const pAdj = tukeyPval(qObs, k, N - k);
        const margin = qCrit * seTukey;
        tukeyRows.push([
          validLevels[i],
          validLevels[j],
          rn(md),
          fp(pAdj),
          rn(md - margin),
          rn(md + margin),
          pAdj < 0.05 ? "Sí" : "No",
        ]);
        if (groups[i].length > 0 && groups[j].length > 0) {
          const mwRes = mannWhitneyCore(groups[i], groups[j]);
          mwPairs.push({ g1: validLevels[i], g2: validLevels[j], u: mwRes.uStat, pRaw: mwRes.pVal, rbc: mwRes.rbc });
        }
      }
    }
    tables.push({
      title: "Post hoc: Tukey HSD",
      columns: ["Grupo 1", "Grupo 2", "Dif. media", "p ajustada", "IC inf", "IC sup", "Rechaza H0"],
      rows: tukeyRows,
      note: nonParamPreferred ? "Post hoc paramétrico de referencia (interpretar con cautela si los datos son ordinales o no normales)." : "",
    });
    if (mwPairs.length > 0) {
      const holmP = holmAdjust(mwPairs.map((m) => m.pRaw));
      tables.push({
        title: "Post hoc no paramétrico: Mann-Whitney pareado (corrección de Holm)",
        columns: ["Grupo 1", "Grupo 2", "U", "p bruta", "p ajustada (Holm)", "r biserial", "Significativo"],
        rows: mwPairs.map((m, idx) => [
          m.g1,
          m.g2,
          rn(m.u, 1),
          fp(m.pRaw),
          fp(holmP[idx]),
          rn(m.rbc, 3),
          holmP[idx] < 0.05 ? "Sí" : "No",
        ]),
        note: "Recomendado tras Kruskal-Wallis o cuando existen variables ordinales / no normales.",
      });
    }
  }

  return {
    title: nonParamPreferred ? `Kruskal-Wallis / ANOVA: ${yv} según ${gv}` : `ANOVA: ${yv} según ${gv}`,
    tables,
    charts: [buildBoxChart(yVals, gVals, `${yv} por ${gv}`)],
    summary: nonParamPreferred
      ? `Kruskal-Wallis H(${k - 1}) = ${rn(H, 2)}, p = ${fp(kwP)} (ANOVA ref.: F = ${rn(fStat, 2)}, p = ${fp(fP)}).${assumptionNote}`
      : `F(${k - 1}, ${N - k}) = ${rn(fStat, 2)}, p = ${fp(fP)}, η² = ${rn(eta2, 3)}, ω² = ${rn(omega2, 3)} (Kruskal-Wallis p = ${fp(kwP)}).`,
  };
}

function pearsonPair(x: number[], y: number[]): { r: number; p: number } {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  const den = Math.sqrt(sx * sy);
  const rVal = den > 0 ? Math.max(-1, Math.min(1, num / den)) : 0;
  const t = Math.abs(rVal) >= 1 ? 1e6 : rVal * Math.sqrt((n - 2) / (1 - rVal * rVal));
  return { r: rVal, p: tPvalTwoSided(t, n - 2) };
}

function runCorrelation(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap?: VarMetaMap
): Omit<AnalysisResult, "test"> {
  const vars = (params.vars as string[]) || [];
  const rawMethod = params.method as string;
  const method = rawMethod === "spearman" ? "spearman" : rawMethod === "kendall" ? "kendall" : "pearson";
  const methodLabel = method === "pearson" ? "Pearson" : method === "spearman" ? "Spearman" : "Kendall (τ-b)";
  const sym = method === "pearson" ? "r" : method === "spearman" ? "ρ" : "τ";
  if (vars.length < 2) throw new StatsError("Selecciona al menos 2 variables numéricas u ordinales.");
  needCols(rows, vars);

  const series: Record<string, (number | null)[]> = {};
  const ordinalVars: string[] = [];
  const nonNormalVars: string[] = [];
  for (const v of vars) {
    const res = getNumericSeries(rows, v, varMap);
    series[v] = res.values;
    if (res.isOrdinal) ordinalVars.push(v);
    else {
      const valid = res.values.filter((n): n is number => n !== null);
      if (valid.length >= 3) {
        const sw = shapiroWilkP(valid);
        if (Number.isFinite(sw) && sw < 0.05) nonNormalVars.push(v);
      }
    }
  }

  const calcPair = (x: number[], y: number[]): { r: number; p: number } => {
    if (method === "pearson") return pearsonPair(x, y);
    if (method === "spearman") return pearsonPair(ranksWithTies(x).ranks, ranksWithTies(y).ranks);
    const kRes = kendallTauB(x, y);
    return { r: kRes.tau, p: kRes.p };
  };

  const matRows: Cell[][] = vars.map((v1) => {
    const row: Cell[] = [v1];
    for (const v2 of vars) {
      if (v1 === v2) {
        row.push("1");
        continue;
      }
      const x: number[] = [];
      const y: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        if (series[v1][i] !== null && series[v2][i] !== null) {
          x.push(series[v1][i]!);
          y.push(series[v2][i]!);
        }
      }
      if (x.length < 3) {
        row.push("—");
        continue;
      }
      const res = calcPair(x, y);
      row.push(`${rn(res.r)} (p=${fp(res.p)})`);
    }
    return row;
  });

  const heatmapData: Record<string, Cell>[] = [];
  const pairCandidates: Array<{
    v1: string;
    v2: string;
    x: number[];
    y: number[];
    r: number;
    p: number;
  }> = [];

  for (let i1 = 0; i1 < vars.length; i1++) {
    const v1 = vars[i1];
    for (let i2 = 0; i2 < vars.length; i2++) {
      const v2 = vars[i2];
      if (v1 === v2) {
        heatmapData.push({ rowVar: v1, colVar: v2, r: 1, p: 0, n: rows.length });
        continue;
      }
      const x: number[] = [];
      const y: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        if (series[v1][i] !== null && series[v2][i] !== null) {
          x.push(series[v1][i]!);
          y.push(series[v2][i]!);
        }
      }
      if (x.length < 3) {
        heatmapData.push({ rowVar: v1, colVar: v2, r: null, p: null, n: x.length });
        continue;
      }
      const res = calcPair(x, y);
      heatmapData.push({
        rowVar: v1,
        colVar: v2,
        r: rn(res.r, 3),
        p: rn(res.p, 4),
        n: x.length,
      });
      if (i1 < i2 && Number.isFinite(res.r)) {
        pairCandidates.push({ v1, v2, x, y, r: res.r, p: res.p });
      }
    }
  }

  const charts: ResultChart[] = [];
  let summary = `Matriz de correlación (${methodLabel}).`;

  if (heatmapData.length > 0) {
    charts.push({
      type: "heatmap",
      title: `Mapa de calor de correlación (${methodLabel} ${sym})`,
      x: "colVar",
      series: vars,
      data: heatmapData,
      meta: { method },
    });
  }

  const buildPairScatter = (pair: { v1: string; v2: string; x: number[]; y: number[]; r: number; p: number }): ResultChart => {
    const mx = mean(pair.x);
    const my = mean(pair.y);
    const sxy = pair.x.reduce((s, xi, idx) => s + (xi - mx) * (pair.y[idx] - my), 0);
    const sxx = pair.x.reduce((s, xi) => s + (xi - mx) ** 2, 0);
    const slope = sxx > 0 ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    return {
      type: "scatter",
      title: `${pair.v2} vs ${pair.v1} (${sym} = ${rn(pair.r, 3)}, p = ${fp(pair.p)})`,
      x: "x",
      series: ["y"],
      data: pair.x.slice(0, 800).map((xi, idx) => ({ x: rn(xi), y: rn(pair.y[idx]) })),
      meta: {
        slope: rn(slope, 4),
        intercept: rn(intercept, 4),
        xlabel: pair.v1,
        ylabel: pair.v2,
        xmin: rn(Math.min(...pair.x)),
        xmax: rn(Math.max(...pair.x)),
        r: rn(pair.r, 3),
        p: fp(pair.p),
      },
    };
  };

  if (vars.length === 2 && pairCandidates.length === 1) {
    const pair = pairCandidates[0];
    charts.unshift(buildPairScatter(pair));
    let ciTxt = "";
    if (method !== "kendall" && pair.x.length >= 4 && Math.abs(pair.r) < 0.9999) {
      const z = 0.5 * Math.log((1 + pair.r) / (1 - pair.r));
      const seZ = 1 / Math.sqrt(pair.x.length - 3);
      const lo = Math.tanh(z - 1.96 * seZ);
      const hi = Math.tanh(z + 1.96 * seZ);
      ciTxt = ` (IC 95%: ${rn(lo, 3)} – ${rn(hi, 3)})`;
    }
    summary = `${sym} = ${rn(pair.r, 3)}${ciTxt}, p = ${fp(pair.p)}, N = ${pair.x.length}.`;
  } else if (pairCandidates.length > 0) {
    const topPairs = [...pairCandidates].sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 3);
    for (const pair of topPairs) {
      charts.push(buildPairScatter(pair));
    }
  }

  const assumptionNotes: string[] = [];
  if (method === "pearson") {
    if (ordinalVars.length > 0) {
      assumptionNotes.push(
        `⚠ Variables ordinales detectadas (${ordinalVars.join(", ")}): Pearson asume escala de intervalo y normalidad; utiliza Spearman (ρ) o Kendall (τ-b).`
      );
    }
    if (nonNormalVars.length > 0) {
      assumptionNotes.push(
        `⚠ Desviación de normalidad (Shapiro-Wilk p < 0.05) en ${nonNormalVars.join(", ")}: se recomienda ρ de Spearman o τ-b de Kendall.`
      );
    }
  }
  const corrNote = assumptionNotes.join(" ");
  if (corrNote) {
    summary += ` ${corrNote}`;
  }

  return {
    title: `Correlación de ${methodLabel}`,
    tables: [{ title: "Coeficientes de correlación", columns: ["", ...vars], rows: matRows, note: corrNote }],
    charts,
    summary,
  };
}

function runLinReg(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varTypes: Record<string, VarType>
): Omit<AnalysisResult, "test"> {
  const outcome = params.outcome as string;
  const predictors = (params.predictors as string[]) || [];
  const { X, y, termNames, singlePredValues } = buildDesignMatrix(rows, outcome, predictors, varTypes, false);

  const n = X.length;
  const p = termNames.length;
  // XtX = X^T * X
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty: number[] = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < p; k++) XtX[j][k] += X[i][j] * X[i][k];
    }
  }
  const inv = invertMatrix(XtX);
  if (!inv) throw new StatsError("Matriz singular: colinealidad perfecta entre predictores.");

  const beta = matMulVec(inv, Xty);
  const yMean = mean(y);
  const fitted: number[] = [];
  const resids: number[] = [];
  let sse = 0;
  let sst = 0;
  let absErr = 0;
  for (let i = 0; i < n; i++) {
    const yHat = X[i].reduce((s, v, j) => s + v * beta[j], 0);
    const r = y[i] - yHat;
    fitted.push(yHat);
    resids.push(r);
    sse += r * r;
    absErr += Math.abs(r);
    sst += (y[i] - yMean) ** 2;
  }
  const ssr = sst - sse;
  const dfModel = p - 1;
  const dfResid = n - p;
  const mse = sse / dfResid;
  const rmse = Math.sqrt(sse / n);
  const mae = absErr / n;
  const r2 = sst > 0 ? ssr / sst : 0;
  const adjR2 = 1 - ((1 - r2) * (n - 1)) / dfResid;
  const fStat = dfModel > 0 && mse > 0 ? ssr / dfModel / mse : 0;
  const fP = dfModel > 0 ? fPval(fStat, dfModel, dfResid) : 1;
  const aic = n * Math.log(sse / n) + 2 * p + n * (1 + Math.log(2 * Math.PI));
  const tc = tCrit975(dfResid);

  // Residual diagnostics: Shapiro-Wilk, Durbin-Watson, Breusch-Pagan (auxiliary OLS on e^2)
  const swResP = n >= 3 ? shapiroWilkP(resids) : NaN;
  let dwNum = 0;
  for (let i = 1; i < n; i++) dwNum += (resids[i] - resids[i - 1]) ** 2;
  const dwStat = sse > 0 ? dwNum / sse : NaN;
  let bpStat = NaN;
  let bpP = NaN;
  if (n > p + 2 && sse > 0) {
    const sigma2 = sse / n;
    const gVec = resids.map((r) => (r * r) / sigma2 - 1);
    const Xtg = new Array(p).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) Xtg[j] += X[i][j] * gVec[i];
    const bAux = matMulVec(inv, Xtg);
    let ssAux = 0;
    for (let i = 0; i < n; i++) {
      const gHat = X[i].reduce((s, v, j) => s + v * bAux[j], 0);
      ssAux += gHat * gHat;
    }
    bpStat = 0.5 * ssAux;
    if (dfModel > 0) bpP = chi2Pval(bpStat, dfModel);
  }

  // 5-fold cross-validation
  let cvR2: number | null = null;
  let cvRmse: number | null = null;
  if (n >= 15) {
    const kFold = 5;
    const oofPred = new Array(n).fill(NaN);
    for (let fold = 0; fold < kFold; fold++) {
      const trIdx: number[] = [];
      const teIdx: number[] = [];
      for (let i = 0; i < n; i++) (i % kFold === fold ? teIdx : trIdx).push(i);
      const XtXcv: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
      const Xtycv: number[] = new Array(p).fill(0);
      for (const i of trIdx) {
        for (let a = 0; a < p; a++) {
          Xtycv[a] += X[i][a] * y[i];
          for (let b = 0; b < p; b++) XtXcv[a][b] += X[i][a] * X[i][b];
        }
      }
      const invCv = invertMatrix(XtXcv);
      if (!invCv) continue;
      const bCv = matMulVec(invCv, Xtycv);
      for (const i of teIdx) oofPred[i] = X[i].reduce((s, v, j) => s + v * bCv[j], 0);
    }
    if (oofPred.every((v) => Number.isFinite(v))) {
      let cvSse = 0;
      for (let i = 0; i < n; i++) cvSse += (y[i] - oofPred[i]) ** 2;
      cvRmse = Math.sqrt(cvSse / n);
      cvR2 = sst > 0 ? 1 - cvSse / sst : 0;
    }
  }

  // Compute VIF for multiple predictors (p > 2)
  const vifs: (number | null)[] = new Array(p).fill(null);
  if (p > 2) {
    const colMeans = Array.from({ length: p }, (_, j) => mean(X.map((r) => r[j])));
    const R: number[][] = Array.from({ length: p - 1 }, () => new Array(p - 1).fill(0));
    for (let a = 1; a < p; a++) {
      for (let b = 1; b < p; b++) {
        let sxy = 0;
        let sxx = 0;
        let syy = 0;
        for (let i = 0; i < n; i++) {
          const da = X[i][a] - colMeans[a];
          const db = X[i][b] - colMeans[b];
          sxy += da * db;
          sxx += da * da;
          syy += db * db;
        }
        R[a - 1][b - 1] = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : a === b ? 1 : 0;
      }
    }
    const invR = invertMatrix(R);
    if (invR) {
      for (let a = 1; a < p; a++) vifs[a] = rn(Math.max(1, invR[a - 1][a - 1]), 2);
    }
  }

  const coefRowsWithVif: Cell[][] = termNames.map((t, j) => {
    const se = Math.sqrt(Math.max(0, mse * inv[j][j]));
    const tStat = se > 0 ? beta[j] / se : 0;
    const pVal = tPvalTwoSided(tStat, dfResid);
    return [
      t,
      rn(beta[j], 4),
      rn(se, 4),
      rn(tStat, 3),
      fp(pVal),
      rn(beta[j] - tc * se, 4),
      rn(beta[j] + tc * se, 4),
      vifs[j] ?? "—",
    ];
  });

  const charts: ResultChart[] = [];
  if (predictors.length === 1 && (varTypes[predictors[0]] ?? "numeric") === "numeric" && singlePredValues.length === n) {
    charts.push({
      type: "scatter",
      title: `${outcome} vs ${predictors[0]}`,
      x: "x",
      series: ["y"],
      data: singlePredValues.slice(0, 800).map((xv, i) => ({ x: rn(xv), y: rn(y[i]) })),
      meta: {
        slope: rn(beta[1], 4),
        intercept: rn(beta[0], 4),
        xlabel: predictors[0],
        ylabel: outcome,
        xmin: rn(Math.min(...singlePredValues)),
        xmax: rn(Math.max(...singlePredValues)),
      },
    });
  }
  charts.push({
    type: "scatter",
    title: "Diagnóstico: Residuos vs Valores ajustados",
    x: "x",
    series: ["y"],
    data: fitted.slice(0, 800).map((yh, i) => ({ x: rn(yh, 3), y: rn(resids[i], 3) })),
    meta: {
      slope: 0,
      intercept: 0,
      xlabel: "Valores ajustados (ŷ)",
      ylabel: "Residuos (y − ŷ)",
      xmin: rn(Math.min(...fitted), 3),
      xmax: rn(Math.max(...fitted), 3),
    },
  });

  return {
    title: `Regresión lineal: ${outcome}`,
    tables: [
      {
        title: "Resumen del modelo",
        columns: ["N", "R²", "R² ajustado", "F", "p (F)", "AIC"],
        rows: [[n, rn(r2), rn(adjR2), rn(fStat), fp(fP), rn(aic, 1)]],
        note: "",
      },
      {
        title: "Coeficientes",
        columns: ["Término", "B", "EE", "t", "p", "IC95% inf", "IC95% sup", "FIV"],
        rows: coefRowsWithVif,
        note: p > 2 ? "FIV (Factor de Inflación de la Varianza) > 5 sugiere colinealidad relevante." : "",
      },
      {
        title: "Diagnóstico de residuos y validación cruzada (5-fold)",
        columns: ["RMSE", "MAE", "Shapiro-Wilk res. (p)", "Breusch-Pagan (p)", "Durbin-Watson", "R² CV (5-fold)", "RMSE CV"],
        rows: [[rn(rmse, 3), rn(mae, 3), fp(swResP), fp(bpP), rn(dwStat, 2), cvR2 !== null ? rn(cvR2, 3) : "—", cvRmse !== null ? rn(cvRmse, 3) : "—"]],
        note: "Breusch-Pagan p < 0.05 sugiere heterocedasticidad; Durbin-Watson ≈ 2 indica independencia de residuos.",
      },
    ],
    charts,
    summary: `R² = ${rn(r2, 3)} (ajustado ${rn(adjR2, 3)}), RMSE = ${rn(rmse, 3)}, F = ${rn(fStat, 2)}, p = ${fp(fP)}, N = ${n}.`,
  };
}

function runLogReg(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varTypes: Record<string, VarType>
): Omit<AnalysisResult, "test"> {
  const outcome = params.outcome as string;
  const predictors = (params.predictors as string[]) || [];
  const { X, y, termNames } = buildDesignMatrix(rows, outcome, predictors, varTypes, true);

  const n = X.length;
  const p = termNames.length;
  const events = y.reduce((s, v) => s + v, 0);
  if (events === 0 || events === n) {
    throw new StatsError("La variable dependiente binaria debe contener ambos valores (0 y 1).");
  }

  let beta = new Array(p).fill(0);
  let invInfo: number[][] | null = null;

  for (let iter = 0; iter < 50; iter++) {
    const grad = new Array(p).fill(0);
    const info: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) {
      const eta = Math.max(-20, Math.min(20, X[i].reduce((s, v, j) => s + v * beta[j], 0)));
      const pi = 1 / (1 + Math.exp(-eta));
      const w = Math.max(1e-8, pi * (1 - pi));
      for (let j = 0; j < p; j++) {
        grad[j] += X[i][j] * (y[i] - pi);
        for (let k = 0; k < p; k++) info[j][k] += X[i][j] * X[i][k] * w;
      }
    }
    const inv = invertMatrix(info);
    if (!inv) throw new StatsError("El modelo no convergió (separación perfecta o matriz singular).");
    invInfo = inv;
    const step = matMulVec(inv, grad);
    const maxStep = Math.max(...step.map((v) => Math.abs(v)));
    beta = beta.map((b, j) => b + step[j]);
    if (maxStep < 1e-7) break;
  }

  if (!invInfo) throw new StatsError("El modelo no convergió.");

  let llModel = 0;
  const probs: number[] = [];
  for (let i = 0; i < n; i++) {
    const eta = Math.max(-20, Math.min(20, X[i].reduce((s, v, j) => s + v * beta[j], 0)));
    const pi = Math.min(1 - 1e-15, Math.max(1e-15, 1 / (1 + Math.exp(-eta))));
    probs.push(pi);
    llModel += y[i] * Math.log(pi) + (1 - y[i]) * Math.log(1 - pi);
  }
  // Model C-statistic (AUC)
  const posProbs = probs.filter((_, i) => y[i] === 1);
  const negProbs = probs.filter((_, i) => y[i] === 0);
  let concordant = 0;
  for (const pp of posProbs) {
    for (const np of negProbs) {
      if (pp > np) concordant += 1;
      else if (pp === np) concordant += 0.5;
    }
  }
  const aucModel = posProbs.length && negProbs.length ? concordant / (posProbs.length * negProbs.length) : 0.5;

  const pNull = events / n;
  const llNull = events * Math.log(pNull) + (n - events) * Math.log(1 - pNull);
  const pseudoR2 = llNull !== 0 ? 1 - llModel / llNull : 0;
  const coxSnell = 1 - Math.exp((2 / n) * (llNull - llModel));
  const maxCoxSnell = 1 - Math.exp((2 / n) * llNull);
  const nagelkerke = maxCoxSnell > 0 ? coxSnell / maxCoxSnell : 0;
  const brier = probs.reduce((s, pr, i) => s + (y[i] - pr) ** 2, 0) / n;
  const aic = -2 * llModel + 2 * p;
  const lrStat = Math.max(0, 2 * (llModel - llNull));
  const lrP = p > 1 ? chi2Pval(lrStat, p - 1) : 1;

  // Hosmer-Lemeshow calibration bins (up to 10)
  const ordPairs = probs.map((pr, i) => ({ pr, y: y[i] })).sort((a, b) => a.pr - b.pr);
  const gBins = Math.min(10, Math.max(2, Math.floor(n / 10)));
  let hlChi2 = 0;
  const calibPts: Record<string, Cell>[] = [];
  for (let g = 0; g < gBins; g++) {
    const start = Math.floor((g * n) / gBins);
    const end = Math.floor(((g + 1) * n) / gBins);
    const slice = ordPairs.slice(start, end);
    if (!slice.length) continue;
    const obsEv = slice.reduce((s, o) => s + o.y, 0);
    const expEv = slice.reduce((s, o) => s + o.pr, 0);
    const ng = slice.length;
    const meanP = expEv / ng;
    if (expEv > 0 && expEv < ng) {
      hlChi2 += ((obsEv - expEv) ** 2) / (expEv * (1 - meanP));
    }
    calibPts.push({
      pred: `${rn(meanP * 100, 1)}%`,
      Modelo: rn((obsEv / ng) * 100, 1),
      Ideal: rn(meanP * 100, 1),
    });
  }
  const hlP = gBins > 2 ? chi2Pval(hlChi2, gBins - 2) : 1;

  // 5-fold CV AUC
  let cvAuc: number | null = null;
  if (n >= 20 && events >= 5 && n - events >= 5) {
    const kFold = 5;
    const oof = new Array(n).fill(NaN);
    for (let fold = 0; fold < kFold; fold++) {
      const trIdx: number[] = [];
      const teIdx: number[] = [];
      for (let i = 0; i < n; i++) (i % kFold === fold ? teIdx : trIdx).push(i);
      let bCv = new Array(p).fill(0);
      let ok = true;
      for (let iter = 0; iter < 30; iter++) {
        const grad = new Array(p).fill(0);
        const info: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
        for (const i of trIdx) {
          const eta = Math.max(-20, Math.min(20, X[i].reduce((s, v, j) => s + v * bCv[j], 0)));
          const pi = 1 / (1 + Math.exp(-eta));
          const w = Math.max(1e-8, pi * (1 - pi));
          for (let j = 0; j < p; j++) {
            grad[j] += X[i][j] * (y[i] - pi);
            for (let k = 0; k < p; k++) info[j][k] += X[i][j] * X[i][k] * w;
          }
        }
        const inv = invertMatrix(info);
        if (!inv) { ok = false; break; }
        const step = matMulVec(inv, grad);
        bCv = bCv.map((b, j) => b + step[j]);
        if (Math.max(...step.map((v) => Math.abs(v))) < 1e-6) break;
      }
      if (!ok) continue;
      for (const i of teIdx) {
        const eta = Math.max(-20, Math.min(20, X[i].reduce((s, v, j) => s + v * bCv[j], 0)));
        oof[i] = 1 / (1 + Math.exp(-eta));
      }
    }
    if (oof.every((v) => Number.isFinite(v))) {
      const posCv = oof.filter((_, i) => y[i] === 1);
      const negCv = oof.filter((_, i) => y[i] === 0);
      let cSum = 0;
      for (const pp of posCv) for (const np of negCv) cSum += pp > np ? 1 : pp === np ? 0.5 : 0;
      cvAuc = posCv.length && negCv.length ? cSum / (posCv.length * negCv.length) : null;
    }
  }

  const coefRows: Cell[][] = [];
  const orChart: Record<string, Cell>[] = [];

  termNames.forEach((t, j) => {
    const se = Math.sqrt(Math.max(0, invInfo![j][j]));
    const z = se > 0 ? beta[j] / se : 0;
    const pVal = 2 * (1 - normCdf(Math.abs(z)));
    const or = Math.exp(beta[j]);
    const lo = Math.exp(beta[j] - 1.96 * se);
    const hi = Math.exp(beta[j] + 1.96 * se);
    coefRows.push([t, rn(beta[j], 4), rn(se, 4), rn(z, 3), fp(pVal), rn(or), `${rn(lo)} – ${rn(hi)}`]);
    if (t !== "Constante") {
      orChart.push({ category: t, OR: rn(or), lo: rn(lo), hi: rn(hi) });
    }
  });

  return {
    title: `Regresión logística: ${outcome}`,
    tables: [
      {
        title: "Resumen del modelo",
        columns: ["N", "Eventos", "Pseudo R² (McFadden)", "AUC (Estadístico C)", "AIC", "p (LR)"],
        rows: [[n, events, rn(pseudoR2), rn(aucModel, 3), rn(aic, 1), fp(lrP)]],
        note: "",
      },
      {
        title: "Coeficientes (Odds Ratios)",
        columns: ["Término", "B", "EE", "z", "p", "OR", "IC95% OR"],
        rows: coefRows,
        note: "",
      },
      {
        title: "Calibración y validación interna",
        columns: ["R² Nagelkerke", "Brier Score", "Hosmer-Lemeshow χ²", "p (H-L)", "AUC CV (5-fold)"],
        rows: [[rn(nagelkerke, 3), rn(brier, 4), rn(hlChi2, 2), fp(hlP), cvAuc !== null ? rn(cvAuc, 3) : "—"]],
        note: "Hosmer-Lemeshow p > 0.05 indica buena calibración; menor Brier Score indica mejor calibración probabilística.",
      },
    ],
    charts: [
      {
        type: "bar",
        title: "Odds Ratios",
        x: "category",
        series: ["OR"],
        data: orChart,
        meta: { refline: 1 },
      },
      ...(calibPts.length >= 2
        ? [
            {
              type: "line" as const,
              title: "Curva de calibración (probabilidad predicha vs observada %)",
              x: "pred",
              series: ["Modelo", "Ideal"],
              data: calibPts,
              meta: {},
            },
          ]
        : []),
    ],
    summary: `Pseudo R² = ${rn(pseudoR2, 3)}, Nagelkerke = ${rn(nagelkerke, 3)}, AUC = ${rn(aucModel, 3)}, Brier = ${rn(brier, 4)}, p (razón de verosimilitud) = ${fp(lrP)}, N = ${n}.`,
  };
}

function runKaplanMeier(rows: Record<string, Cell>[], params: Record<string, unknown>): Omit<AnalysisResult, "test"> {
  const tv = params.time as string;
  const ev = params.event as string;
  const gv = (params.group as string) || "";
  needCols(rows, gv ? [tv, ev, gv] : [tv, ev]);

  const obs: { t: number; e: number; g: string }[] = [];
  for (const row of rows) {
    const t = toNum(row[tv]);
    const e = toEvent01(row[ev]);
    const g = gv ? toLbl(row[gv]) : "Todos";
    if (t !== null && e !== null && g !== null) {
      if (e !== 0 && e !== 1) {
        throw new StatsError(`La variable de evento '${ev}' debe codificarse 0 (censura) / 1 (evento).`);
      }
      obs.push({ t, e, g });
    }
  }
  if (!obs.length) throw new StatsError("No hay observaciones válidas para el análisis de supervivencia.");

  const levels = getLevels(obs.map((o) => o.g));
  const summaryRows: Cell[][] = [];
  const curves: Record<string, Map<number, { s: number; lo: number; hi: number }>> = {};
  const allTimes = new Set<number>([0]);

  const greenwoodLogLogCi = (surv: number, cumVar: number): { lo: number; hi: number } => {
    if (surv <= 0) return { lo: 0, hi: 0 };
    if (surv >= 1 || cumVar <= 0) return { lo: 1, hi: 1 };
    const absLnS = Math.abs(Math.log(surv));
    if (absLnS < 1e-12) return { lo: 1, hi: 1 };
    const seLnMinusLnS = Math.sqrt(cumVar) / absLnS;
    const lo = Math.max(0, Math.min(1, Math.pow(surv, Math.exp(1.96 * seLnMinusLnS))));
    const hi = Math.max(0, Math.min(1, Math.pow(surv, Math.exp(-1.96 * seLnMinusLnS))));
    return { lo, hi };
  };

  for (const lv of levels) {
    const sub = obs.filter((o) => o.g === lv).sort((a, b) => a.t - b.t);
    const times = Array.from(new Set(sub.map((o) => o.t))).sort((a, b) => a - b);
    let atRisk = sub.length;
    let surv = 1.0;
    let cumVar = 0;
    let lastCi = { lo: 1.0, hi: 1.0 };
    const curve = new Map<number, { s: number; lo: number; hi: number }>([[0, { s: 1.0, lo: 1.0, hi: 1.0 }]]);
    let medTime: number | null = null;
    let totalEvents = 0;

    for (const ti of times) {
      allTimes.add(ti);
      const atTime = sub.filter((o) => o.t === ti);
      const d = atTime.filter((o) => o.e === 1).length;
      totalEvents += d;
      if (d > 0 && atRisk > 0) {
        if (atRisk - d > 0) {
          cumVar += d / (atRisk * (atRisk - d));
        }
        surv *= 1 - d / atRisk;
      }
      lastCi = greenwoodLogLogCi(surv, cumVar);
      curve.set(ti, { s: surv, lo: lastCi.lo, hi: lastCi.hi });
      if (medTime === null && surv <= 0.5) medTime = ti;
      atRisk -= atTime.length;
    }
    curves[lv] = curve;
    summaryRows.push([
      lv,
      sub.length,
      totalEvents,
      medTime !== null ? rn(medTime, 2) : "No alcanzada",
      rn(100 * surv, 1),
      `${rn(100 * lastCi.lo, 1)}% – ${rn(100 * lastCi.hi, 1)}%`,
    ]);
  }

  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);
  const lastVal: Record<string, { s: number; lo: number; hi: number }> = Object.fromEntries(
    levels.map((lv) => [lv, { s: 1.0, lo: 1.0, hi: 1.0 }])
  );
  const chartData = sortedTimes.map((tt) => {
    const pt: Record<string, Cell> = { t: rn(tt, 2) };
    for (const lv of levels) {
      if (curves[lv].has(tt)) lastVal[lv] = curves[lv].get(tt)!;
      pt[lv] = rn(lastVal[lv].s, 4);
      pt[`${lv}__ci_lo`] = rn(lastVal[lv].lo, 4);
      pt[`${lv}__ci_hi`] = rn(lastVal[lv].hi, 4);
    }
    return pt;
  });

  const tables: ResultTable[] = [
    {
      title: "Resumen de supervivencia",
      columns: ["Grupo", "N", "Eventos", "Mediana de supervivencia", "S(t) final %", "IC 95% S(t) final"],
      rows: summaryRows,
      note: "Intervalos de confianza del 95% calculados mediante transformación log-log de Greenwood.",
    },
  ];

  const totalEv = obs.filter((o) => o.e === 1).length;
  let summary = `${totalEv} eventos en ${obs.length} sujetos.`;

  // Multi-group Log-Rank Test
  if (levels.length > 1) {
    const eventTimes = Array.from(new Set(obs.filter((o) => o.e === 1).map((o) => o.t))).sort((a, b) => a - b);
    const k = levels.length;
    const O = new Array(k).fill(0);
    const E = new Array(k).fill(0);
    const V: number[][] = Array.from({ length: k - 1 }, () => new Array(k - 1).fill(0));

    for (const ti of eventTimes) {
      const nRisk = levels.map((lv) => obs.filter((o) => o.g === lv && o.t >= ti).length);
      const dGroup = levels.map((lv) => obs.filter((o) => o.g === lv && o.t === ti && o.e === 1).length);
      const nTot = nRisk.reduce((s, v) => s + v, 0);
      const dTot = dGroup.reduce((s, v) => s + v, 0);
      if (nTot <= 1 || dTot === 0) continue;

      for (let g = 0; g < k; g++) {
        O[g] += dGroup[g];
        E[g] += (nRisk[g] * dTot) / nTot;
      }
      const factor = (dTot * (nTot - dTot)) / (nTot * nTot * (nTot - 1));
      for (let i = 0; i < k - 1; i++) {
        for (let j = 0; j < k - 1; j++) {
          const cov = i === j ? nRisk[i] * (nTot - nRisk[i]) : -nRisk[i] * nRisk[j];
          V[i][j] += factor * cov;
        }
      }
    }
    const diffVec = Array.from({ length: k - 1 }, (_, i) => O[i] - E[i]);
    const invV = invertMatrix(V);
    let chi = 0;
    if (invV) {
      const prod = matMulVec(invV, diffVec);
      chi = Math.max(0, diffVec.reduce((s, v, i) => s + v * prod[i], 0));
    }
    const pLogRank = chi2Pval(chi, k - 1);
    tables.push({
      title: "Prueba de log-rank",
      columns: ["χ²", "gl", "p"],
      rows: [[rn(chi), k - 1, fp(pLogRank)]],
      note: "",
    });
    summary += ` Log-rank χ² = ${rn(chi, 2)}, p = ${fp(pLogRank)}.`;
  }

  return {
    title: `Kaplan-Meier: ${tv}${gv ? ` según ${gv}` : ""}`,
    tables,
    charts: [
      {
        type: "survival",
        title: "Curva de supervivencia",
        x: "t",
        series: levels,
        data: chartData,
        meta: {
          hasConfidenceIntervals: true,
          ciMethod: "Greenwood log-log (95%)",
        },
      },
    ],
    summary,
  };
}

function runTable1(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varTypes: Record<string, VarType>,
  varMap?: VarMetaMap
): Omit<AnalysisResult, "test"> {
  const gv = (params.group as string) || "";
  const vars = (params.vars as string[]) || [];
  if (!vars.length) throw new StatsError("Selecciona variables para la Tabla 1.");
  needCols(rows, gv ? [gv, ...vars] : vars);

  const gVals = gv ? rows.map((r) => toLbl(r[gv])) : null;
  const levels = gVals ? getLevels(gVals) : [];
  const cols = [
    "Variable",
    `Total (N=${rows.length})`,
    ...levels.map((lv) => `${lv} (n=${gVals!.filter((x) => x === lv).length})`),
    ...(levels.length ? ["p"] : []),
  ];

  const tableRows: Cell[][] = [];
  let usedParametric = false;
  let usedNonParametric = false;

  const formatMedianIqr = (arr: number[]) => {
    if (!arr.length) return "—";
    const s = [...arr].sort((a, b) => a - b);
    return `${rn(quantile(s, 0.5), 1)} (${rn(quantile(s, 0.25), 1)}–${rn(quantile(s, 0.75), 1)})`;
  };

  for (const v of vars) {
    const vType = varTypes[v] ?? varMap?.get(v)?.type ?? "numeric";
    if (vType === "numeric" || vType === "ordinal") {
      const series = getNumericSeries(rows, v, varMap);
      const nums = series.values.filter((n): n is number => n !== null);
      const grpArrs = levels.map((lv) => {
        const arr: number[] = [];
        if (!gVals) return arr;
        for (let i = 0; i < rows.length; i++) {
          const val = series.values[i];
          if (gVals[i] === lv && val !== null) arr.push(val);
        }
        return arr;
      });

      let nonNormal = vType === "ordinal";
      if (!nonNormal && nums.length >= 3) {
        const swAll = shapiroWilkP(nums);
        if (Number.isFinite(swAll) && swAll < 0.05) nonNormal = true;
      }
      if (!nonNormal && grpArrs.length >= 2) {
        for (const ga of grpArrs) {
          if (ga.length >= 3) {
            const swG = shapiroWilkP(ga);
            if (Number.isFinite(swG) && swG < 0.05) {
              nonNormal = true;
              break;
            }
          }
        }
      }

      if (nonNormal) {
        usedNonParametric = true;
        const rowLabel = vType === "ordinal" ? `${v}, mediana (RIC) [ordinal]` : `${v}, mediana (RIC)`;
        const row: Cell[] = [rowLabel, formatMedianIqr(nums)];
        if (levels.length && gVals) {
          for (const arr of grpArrs) {
            row.push(formatMedianIqr(arr));
          }
          const ok = grpArrs.filter((a) => a.length > 0);
          let pv: number | null = null;
          if (ok.length === 2 && ok[0].length >= 1 && ok[1].length >= 1) {
            pv = mannWhitneyCore(ok[0], ok[1]).pVal;
          } else if (ok.length > 2) {
            pv = kruskalWallisCore(ok).pVal;
          }
          row.push(fp(pv));
        }
        tableRows.push(row);
      } else {
        usedParametric = true;
        const row: Cell[] = [`${v}, media ± DE`, nums.length ? `${rn(mean(nums), 1)} ± ${rn(sd(nums), 1)}` : "—"];
        if (levels.length && gVals) {
          for (const arr of grpArrs) {
            row.push(arr.length ? `${rn(mean(arr), 1)} ± ${rn(sd(arr), 1)}` : "—");
          }
          const ok = grpArrs.filter((a) => a.length > 1);
          let pv: number | null = null;
          if (ok.length === 2) {
            const [a, b] = ok;
            const va = variance(a);
            const vb = variance(b);
            const se = Math.sqrt(va / a.length + vb / b.length);
            const df =
              (va / a.length + vb / b.length) ** 2 /
              ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1));
            pv = se > 0 ? tPvalTwoSided((mean(a) - mean(b)) / se, df) : 1;
          } else if (ok.length > 2) {
            const all = ok.flat();
            const gm = mean(all);
            const ssb = ok.reduce((s, g) => s + g.length * (mean(g) - gm) ** 2, 0);
            const sst = all.reduce((s, x) => s + (x - gm) ** 2, 0);
            const msb = ssb / (ok.length - 1);
            const msw = (sst - ssb) / (all.length - ok.length);
            pv = msw > 0 ? fPval(msb / msw, ok.length - 1, all.length - ok.length) : 1;
          }
          row.push(fp(pv));
        }
        tableRows.push(row);
      }
    } else {
      const cVals = rows.map((r) => toLbl(r[v]));
      const cLevels = getLevels(cVals);
      let pv: number | null = null;
      if (levels.length && gVals) {
        const validPairs: { c: string; g: string }[] = [];
        for (let i = 0; i < rows.length; i++) {
          if (cVals[i] !== null && gVals[i] !== null) validPairs.push({ c: cVals[i]!, g: gVals[i]! });
        }
        if (cLevels.length > 1 && levels.length > 1 && validPairs.length > 0) {
          const ct = cLevels.map((cl) => levels.map((gl) => validPairs.filter((p) => p.c === cl && p.g === gl).length));
          const rTot = ct.map((r) => r.reduce((s, x) => s + x, 0));
          const cTot = levels.map((_, j) => ct.reduce((s, r) => s + r[j], 0));
          const n = rTot.reduce((s, x) => s + x, 0);
          let chi = 0;
          for (let i = 0; i < cLevels.length; i++) {
            for (let j = 0; j < levels.length; j++) {
              const exp = (rTot[i] * cTot[j]) / n;
              if (exp > 0) chi += (ct[i][j] - exp) ** 2 / exp;
            }
          }
          pv = chi2Pval(chi, (cLevels.length - 1) * (levels.length - 1));
        }
      }
      tableRows.push([`${v}, n (%)`, "", ...levels.map(() => ""), ...(levels.length ? [fp(pv)] : [])]);
      const validTotal = cVals.filter((x) => x !== null).length;
      for (const lv of cLevels) {
        const n = cVals.filter((x) => x === lv).length;
        const row: Cell[] = [`   ${lv}`, `${n} (${rn((100 * n) / Math.max(1, validTotal), 1)}%)`];
        if (gVals) {
          for (const gl of levels) {
            const sub = cVals.filter((_, i) => gVals[i] === gl && cVals[i] !== null);
            const k = sub.filter((x) => x === lv).length;
            row.push(`${k} (${rn((100 * k) / Math.max(1, sub.length), 1)}%)`);
          }
          row.push("");
        }
        tableRows.push(row);
      }
    }
  }

  const noteParts: string[] = [];
  if (usedParametric) noteParts.push("Continuas normales: media ± DE (t de Welch o ANOVA).");
  if (usedNonParametric) {
    noteParts.push(
      "Ordinales o no normales (Shapiro-Wilk p < 0.05): mediana (RIC) con prueba U de Mann-Whitney o Kruskal-Wallis."
    );
  }
  noteParts.push("Categóricas: n (%) con χ² de Pearson.");

  return {
    title: `Tabla 1: características basales${gv ? ` según ${gv}` : ""}`,
    tables: [
      {
        title: "Tabla 1",
        columns: cols,
        rows: tableRows,
        note: noteParts.join(" "),
      },
    ],
    charts: [],
    summary: `Tabla 1 con ${vars.length} variables${gv ? ` estratificada por ${gv}` : ""}${
      usedNonParametric ? " (ajuste no paramétrico automático para ordinales/asimétricas)" : ""
    }.`,
  };
}

// ============================================================================
// Additional Biomedical & Clinical Biostatistics Tests
// ============================================================================

function wilsonCI(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function parseBinaryFlag(v: Cell | undefined, positiveLevel?: string): 0 | 1 | null {
  const lbl = toLbl(v);
  if (lbl === null) return null;
  if (positiveLevel !== undefined) return lbl === positiveLevel ? 1 : 0;
  const low = lbl.toLowerCase();
  if (low === "1" || low === "sí" || low === "si" || low === "yes" || low === "true" || low === "positivo") return 1;
  if (low === "0" || low === "no" || low === "false" || low === "negativo") return 0;
  return null;
}

function resolveBinaryColumn(
  rows: Record<string, Cell>[],
  col: string
): { values: (0 | 1 | null)[]; posLabel: string; negLabel: string } {
  const lbls = rows.map((r) => toLbl(r[col]));
  const levels = getLevels(lbls);
  if (levels.length !== 2) {
    throw new StatsError(`La variable '${col}' debe tener exactamente 2 categorías (tiene ${levels.length}).`);
  }
  const allStandard = lbls.every((l) => l === null || parseBinaryFlag({ x: l }.x) !== null);
  if (allStandard && levels.includes("0") && levels.includes("1")) {
    return {
      values: lbls.map((l) => (l === null ? null : l === "1" ? 1 : 0)),
      posLabel: "1",
      negLabel: "0",
    };
  }
  const negLabel = levels[0];
  const posLabel = levels[1];
  return {
    values: lbls.map((l) => (l === null ? null : l === posLabel ? 1 : 0)),
    posLabel,
    negLabel,
  };
}

function runEpidemiology2x2(rows: Record<string, Cell>[], params: Record<string, unknown>): Omit<AnalysisResult, "test"> {
  const expCol = params.exposure as string;
  const outCol = params.outcome as string;
  needCols(rows, [expCol, outCol]);

  const exp = resolveBinaryColumn(rows, expCol);
  const out = resolveBinaryColumn(rows, outCol);

  let a = 0; // Exp=1, Out=1
  let b = 0; // Exp=1, Out=0
  let c = 0; // Exp=0, Out=1
  let d = 0; // Exp=0, Out=0
  for (let i = 0; i < rows.length; i++) {
    const e = exp.values[i];
    const o = out.values[i];
    if (e === null || o === null) continue;
    if (e === 1 && o === 1) a++;
    else if (e === 1 && o === 0) b++;
    else if (e === 0 && o === 1) c++;
    else d++;
  }
  const n1 = a + b;
  const n0 = c + d;
  const N = n1 + n0;
  if (n1 === 0 || n0 === 0) throw new StatsError("Se requieren observaciones en ambos grupos de exposición.");

  const ie = a / n1;
  const i0 = c / n0;
  const rr = i0 > 0 ? ie / i0 : NaN;
  const seLnRr = a > 0 && c > 0 ? Math.sqrt(1 / a - 1 / n1 + 1 / c - 1 / n0) : NaN;
  const rrLo = Number.isFinite(seLnRr) ? Math.exp(Math.log(rr) - 1.96 * seLnRr) : NaN;
  const rrHi = Number.isFinite(seLnRr) ? Math.exp(Math.log(rr) + 1.96 * seLnRr) : NaN;

  const or = b > 0 && c > 0 ? (a * d) / (b * c) : NaN;
  const seLnOr = a > 0 && b > 0 && c > 0 && d > 0 ? Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d) : NaN;
  const orLo = Number.isFinite(seLnOr) ? Math.exp(Math.log(or) - 1.96 * seLnOr) : NaN;
  const orHi = Number.isFinite(seLnOr) ? Math.exp(Math.log(or) + 1.96 * seLnOr) : NaN;

  const arr = i0 - ie; // Reducción Absoluta del Riesgo (positiva si protege)
  const seArr = Math.sqrt((ie * (1 - ie)) / n1 + (i0 * (1 - i0)) / n0);
  const arrLo = arr - 1.96 * seArr;
  const arrHi = arr + 1.96 * seArr;
  const nnt = Math.abs(arr) > 1e-6 ? Math.ceil(1 / Math.abs(arr)) : null;
  const nntLabel = arr >= 0 ? "NNT (a tratar)" : "NNH (a dañar)";

  const fee = rr > 1 ? ((rr - 1) / rr) * 100 : rr < 1 ? ((1 - rr) * 100) : 0;
  const feeLabel = rr >= 1 ? "Fracción etiológica en expuestos" : "Fracción prevenible en expuestos";

  // Chi-square
  const m1 = a + c;
  const m0 = b + d;
  const chi2 =
    m1 > 0 && m0 > 0 ? (N * Math.pow(a * d - b * c, 2)) / (n1 * n0 * m1 * m0) : 0;
  const pVal = chi2Pval(chi2, 1);

  const rrr = Number.isFinite(rr) ? (1 - rr) * 100 : NaN;
  const rrrLo = Number.isFinite(rrHi) ? (1 - rrHi) * 100 : NaN;
  const rrrHi = Number.isFinite(rrLo) ? (1 - rrLo) * 100 : NaN;

  return {
    title: `Epidemiología 2×2: ${expCol} → ${outCol}`,
    tables: [
      {
        title: "Tabla de incidencia 2×2",
        columns: [expCol, `${outCol} = ${out.posLabel}`, `${outCol} = ${out.negLabel}`, "Total", "Incidencia (%)"],
        rows: [
          [`Expuesto (${exp.posLabel})`, a, b, n1, `${rn(ie * 100, 1)}%`],
          [`No expuesto (${exp.negLabel})`, c, d, n0, `${rn(i0 * 100, 1)}%`],
          ["Total", m1, m0, N, `${rn(((m1) / N) * 100, 1)}%`],
        ],
        note: `χ²(1) = ${rn(chi2, 2)}, p = ${fp(pVal)}.`,
      },
      {
        title: "Medidas de asociación e impacto clínico",
        columns: ["Medida", "Estimación", "IC 95%"],
        rows: [
          ["Riesgo Relativo (RR)", rn(rr, 3), Number.isFinite(rrLo) ? `${rn(rrLo, 3)} – ${rn(rrHi, 3)}` : "—"],
          ["Odds Ratio (OR)", rn(or, 3), Number.isFinite(orLo) ? `${rn(orLo, 3)} – ${rn(orHi, 3)}` : "—"],
          [
            arr >= 0 ? "Reducción Absoluta del Riesgo (RAR)" : "Aumento Absoluto del Riesgo (RAE)",
            `${rn(Math.abs(arr) * 100, 2)}%`,
            `${rn(arrLo * 100, 2)}% – ${rn(arrHi * 100, 2)}%`,
          ],
          [
            rr <= 1 ? "Reducción Relativa del Riesgo (RRR)" : "Aumento Relativo del Riesgo (RRI)",
            Number.isFinite(rrr) ? `${rn(Math.abs(rrr), 1)}%` : "—",
            Number.isFinite(rrrLo) ? `${rn(rrrLo, 1)}% – ${rn(rrrHi, 1)}%` : "—",
          ],
          [nntLabel, nnt ?? "∞ (sin diferencia)", "—"],
          [feeLabel, `${rn(fee, 1)}%`, "—"],
        ],
        note: "IC 95% de RR (Katz), OR (Woolf), RRR = 1 − RR y diferencia de riesgos (Wald).",
      },
    ],
    charts: [
      {
        type: "bar",
        title: `Incidencia de ${outCol} (%)`,
        x: "grupo",
        series: ["Incidencia (%)"],
        data: [
          { grupo: `${expCol}: ${exp.posLabel}`, "Incidencia (%)": rn(ie * 100, 1) },
          { grupo: `${expCol}: ${exp.negLabel}`, "Incidencia (%)": rn(i0 * 100, 1) },
        ],
        meta: {},
      },
    ],
    summary: `RR = ${rn(rr, 2)} (IC 95%: ${rn(rrLo, 2)}–${rn(rrHi, 2)}), OR = ${rn(or, 2)}, ${nntLabel} = ${nnt ?? "∞"}, p = ${fp(pVal)}.`,
  };
}

function runDiagnosticTest(rows: Record<string, Cell>[], params: Record<string, unknown>): Omit<AnalysisResult, "test"> {
  const testCol = params.test_var as string;
  const goldCol = params.gold_standard as string;
  needCols(rows, [testCol, goldCol]);

  const testB = resolveBinaryColumn(rows, testCol);
  const goldB = resolveBinaryColumn(rows, goldCol);

  let tp = 0;
  let fpCnt = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < rows.length; i++) {
    const t = testB.values[i];
    const g = goldB.values[i];
    if (t === null || g === null) continue;
    if (t === 1 && g === 1) tp++;
    else if (t === 1 && g === 0) fpCnt++;
    else if (t === 0 && g === 1) fn++;
    else tn++;
  }

  const sick = tp + fn;
  const healthy = fpCnt + tn;
  const testPos = tp + fpCnt;
  const testNeg = fn + tn;
  const N = sick + healthy;
  if (!sick || !healthy) throw new StatsError("El estándar de oro necesita casos positivos y negativos.");

  const sens = tp / sick;
  const spec = tn / healthy;
  const ppv = testPos > 0 ? tp / testPos : 0;
  const npv = testNeg > 0 ? tn / testNeg : 0;
  const acc = (tp + tn) / N;
  const prev = sick / N;

  const sensCI = wilsonCI(tp, sick);
  const specCI = wilsonCI(tn, healthy);
  const ppvCI = wilsonCI(tp, testPos);
  const npvCI = wilsonCI(tn, testNeg);
  const accCI = wilsonCI(tp + tn, N);

  const lrPos = spec < 1 ? sens / (1 - spec) : NaN;
  const lrNeg = spec > 0 ? (1 - sens) / spec : NaN;
  const seLnLrPos = tp > 0 && fpCnt > 0 ? Math.sqrt(1 / tp - 1 / sick + 1 / fpCnt - 1 / healthy) : NaN;
  const lrPosCI =
    Number.isFinite(lrPos) && Number.isFinite(seLnLrPos)
      ? `${rn(Math.exp(Math.log(lrPos) - 1.96 * seLnLrPos), 2)} – ${rn(Math.exp(Math.log(lrPos) + 1.96 * seLnLrPos), 2)}`
      : "—";
  const seLnLrNeg = fn > 0 && tn > 0 ? Math.sqrt(1 / fn - 1 / sick + 1 / tn - 1 / healthy) : NaN;
  const lrNegCI =
    Number.isFinite(lrNeg) && lrNeg > 0 && Number.isFinite(seLnLrNeg)
      ? `${rn(Math.exp(Math.log(lrNeg) - 1.96 * seLnLrNeg), 3)} – ${rn(Math.exp(Math.log(lrNeg) + 1.96 * seLnLrNeg), 3)}`
      : "—";
  const dor = fpCnt > 0 && fn > 0 ? (tp * tn) / (fpCnt * fn) : NaN;
  const seDor = tp > 0 && fpCnt > 0 && fn > 0 && tn > 0 ? Math.sqrt(1 / tp + 1 / fpCnt + 1 / fn + 1 / tn) : NaN;
  const dorCI =
    Number.isFinite(dor) && Number.isFinite(seDor)
      ? `${rn(Math.exp(Math.log(dor) - 1.96 * seDor), 2)} – ${rn(Math.exp(Math.log(dor) + 1.96 * seDor), 2)}`
      : "—";
  const youden = sens + spec - 1;

  return {
    title: `Evaluación de prueba diagnóstica: ${testCol} vs ${goldCol}`,
    tables: [
      {
        title: "Tabla de contingencia diagnóstica",
        columns: [testCol, `${goldCol} (+)`, `${goldCol} (−)`, "Total"],
        rows: [
          [`Prueba + (${testB.posLabel})`, tp, fpCnt, testPos],
          [`Prueba − (${testB.negLabel})`, fn, tn, testNeg],
          ["Total", sick, healthy, N],
        ],
        note: `Prevalencia en la muestra: ${rn(prev * 100, 1)}% (${sick}/${N}).`,
      },
      {
        title: "Rendimiento diagnóstico (IC 95% Wilson / Simel)",
        columns: ["Métrica", "Valor", "IC 95%"],
        rows: [
          ["Sensibilidad", `${rn(sens * 100, 1)}%`, `${rn(sensCI[0] * 100, 1)}% – ${rn(sensCI[1] * 100, 1)}%`],
          ["Especificidad", `${rn(spec * 100, 1)}%`, `${rn(specCI[0] * 100, 1)}% – ${rn(specCI[1] * 100, 1)}%`],
          ["Valor Predictivo Positivo (VPP)", `${rn(ppv * 100, 1)}%`, `${rn(ppvCI[0] * 100, 1)}% – ${rn(ppvCI[1] * 100, 1)}%`],
          ["Valor Predictivo Negativo (VPN)", `${rn(npv * 100, 1)}%`, `${rn(npvCI[0] * 100, 1)}% – ${rn(npvCI[1] * 100, 1)}%`],
          ["Exactitud global", `${rn(acc * 100, 1)}%`, `${rn(accCI[0] * 100, 1)}% – ${rn(accCI[1] * 100, 1)}%`],
          ["Razón de verosimilitud positiva (LR+)", Number.isFinite(lrPos) ? rn(lrPos, 2) : "∞", lrPosCI],
          ["Razón de verosimilitud negativa (LR−)", Number.isFinite(lrNeg) ? rn(lrNeg, 3) : "—", lrNegCI],
          ["Odds Ratio Diagnóstica (DOR)", Number.isFinite(dor) ? rn(dor, 2) : "∞", dorCI],
          ["Índice de Youden (J)", rn(youden, 3), "—"],
        ],
        note: "LR+ > 10 aporta confirmación fuerte; LR− < 0.1 descarta fuertemente la enfermedad (IC 95% LR por método de Simel).",
      },
    ],
    charts: [
      {
        type: "bar",
        title: "Métricas diagnósticas (%)",
        x: "metrica",
        series: ["Porcentaje"],
        data: [
          { metrica: "Sensibilidad", Porcentaje: rn(sens * 100, 1) },
          { metrica: "Especificidad", Porcentaje: rn(spec * 100, 1) },
          { metrica: "VPP", Porcentaje: rn(ppv * 100, 1) },
          { metrica: "VPN", Porcentaje: rn(npv * 100, 1) },
          { metrica: "Exactitud", Porcentaje: rn(acc * 100, 1) },
        ],
        meta: {},
      },
    ],
    summary: `Sensibilidad = ${rn(sens * 100, 1)}%, Especificidad = ${rn(spec * 100, 1)}%, VPP = ${rn(ppv * 100, 1)}%, VPN = ${rn(npv * 100, 1)}%, LR+ = ${Number.isFinite(lrPos) ? rn(lrPos, 2) : "∞"}.`,
  };
}

function runRocAuc(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap?: VarMetaMap
): Omit<AnalysisResult, "test"> {
  const markerCol = params.marker as string;
  const outCol = params.outcome as string;
  needCols(rows, [markerCol, outCol]);

  const outB = resolveBinaryColumn(rows, outCol);
  const markerSeries = getNumericSeries(rows, markerCol, varMap);
  const pairs: { score: number; y: 0 | 1 }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const sc = markerSeries.values[i];
    const y = outB.values[i];
    if (sc !== null && y !== null) pairs.push({ score: sc, y });
  }
  const pos = pairs.filter((p) => p.y === 1);
  const neg = pairs.filter((p) => p.y === 0);
  if (pos.length < 2 || neg.length < 2) {
    throw new StatsError("Se necesitan al menos 2 casos positivos y 2 negativos para construir la curva ROC.");
  }

  // Determine direction (>= vs <=)
  const dirHigh = mean(pos.map((p) => p.score)) >= mean(neg.map((p) => p.score));
  const thresholds = Array.from(new Set(pairs.map((p) => p.score))).sort((a, b) => (dirHigh ? b - a : a - b));

  const points: { fpr: number; tpr: number; cutoff: number; youden: number }[] = [
    { fpr: 0, tpr: 0, cutoff: dirHigh ? thresholds[0] + 1 : thresholds[0] - 1, youden: 0 },
  ];
  let best = { fpr: 0, tpr: 0, cutoff: thresholds[0], youden: -1 };

  for (const th of thresholds) {
    let tp = 0;
    let fpCnt = 0;
    for (const p of pairs) {
      const pred = dirHigh ? p.score >= th : p.score <= th;
      if (pred) {
        if (p.y === 1) tp++;
        else fpCnt++;
      }
    }
    const tpr = tp / pos.length;
    const fpr = fpCnt / neg.length;
    const youden = tpr + (1 - fpr) - 1;
    points.push({ fpr, tpr, cutoff: th, youden });
    if (youden > best.youden) best = { fpr, tpr, cutoff: th, youden };
  }
  points.push({ fpr: 1, tpr: 1, cutoff: thresholds[thresholds.length - 1], youden: 0 });
  points.sort((a, b) => a.fpr - b.fpr || a.tpr - b.tpr);

  // Trapezoidal AUC
  let auc = 0;
  for (let i = 1; i < points.length; i++) {
    auc += (points[i].fpr - points[i - 1].fpr) * ((points[i].tpr + points[i - 1].tpr) / 2);
  }

  // Hanley-McNeil SE
  const n1 = pos.length;
  const n0 = neg.length;
  const q1 = auc / (2 - auc);
  const q2 = (2 * auc * auc) / (1 + auc);
  const se = Math.sqrt(
    (auc * (1 - auc) + (n1 - 1) * (q1 - auc * auc) + (n0 - 1) * (q2 - auc * auc)) / (n1 * n0)
  );
  const ciLo = Math.max(0, auc - 1.96 * se);
  const ciHi = Math.min(1, auc + 1.96 * se);
  const z = se > 0 ? (auc - 0.5) / se : 0;
  const pVal = 2 * (1 - normCdf(Math.abs(z)));

  // Downsample curve cleanly to <= 120 points for fast responsive chart rendering
  const step = Math.max(1, Math.floor(points.length / 120));
  const chartPts = points
    .filter((_, idx) => idx === 0 || idx === points.length - 1 || idx % step === 0)
    .map((pt) => ({
      fpr: rn(pt.fpr, 3),
      tpr: rn(pt.tpr, 3),
      cutoff: rn(pt.cutoff, 2),
    }));

  const discLabel =
    auc >= 0.9 ? "Excelente" : auc >= 0.8 ? "Buena" : auc >= 0.7 ? "Aceptable" : auc >= 0.6 ? "Discreta" : "Pobre";

  return {
    title: `Curva ROC: ${markerCol} para predecir ${outCol}`,
    tables: [
      {
        title: "Área bajo la curva (AUC) y punto de corte óptimo",
        columns: ["N", "Positivos", "AUC", "EE", "IC 95% AUC", "p (vs 0.5)", "Capacidad"],
        rows: [[pairs.length, n1, rn(auc, 3), rn(se, 3), `${rn(ciLo, 3)} – ${rn(ciHi, 3)}`, fp(pVal), discLabel]],
        note: `Dirección: valores ${dirHigh ? "mayores (≥)" : "menores (≤)"} indican ${outCol} = ${outB.posLabel}.`,
      },
      {
        title: "Punto de corte óptimo (Índice de Youden)",
        columns: ["Punto de corte", "Sensibilidad", "Especificidad", "Índice J"],
        rows: [
          [
            `${dirHigh ? "≥" : "≤"} ${rn(best.cutoff, 2)}`,
            `${rn(best.tpr * 100, 1)}%`,
            `${rn((1 - best.fpr) * 100, 1)}%`,
            rn(best.youden, 3),
          ],
        ],
        note: "Maximiza Sensibilidad + Especificidad − 1 (Hanley-McNeil para EE del AUC).",
      },
    ],
    charts: [
      {
        type: "roc",
        title: `Curva ROC (${markerCol})`,
        x: "fpr",
        series: ["tpr"],
        data: chartPts,
        meta: { auc: rn(auc, 3) },
      },
    ],
    summary: `AUC = ${rn(auc, 3)} (IC 95%: ${rn(ciLo, 3)}–${rn(ciHi, 3)}, p = ${fp(pVal)}). Corte óptimo: ${rn(best.cutoff, 2)} (Sens. ${rn(best.tpr * 100, 1)}%, Esp. ${rn((1 - best.fpr) * 100, 1)}%).`,
  };
}

function runKappaAgreement(rows: Record<string, Cell>[], params: Record<string, unknown>): Omit<AnalysisResult, "test"> {
  const v1 = params.var1 as string;
  const v2 = params.var2 as string;
  needCols(rows, [v1, v2]);

  const pairs: [string, string][] = [];
  for (const r of rows) {
    const a = toLbl(r[v1]);
    const b = toLbl(r[v2]);
    if (a !== null && b !== null) pairs.push([a, b]);
  }
  const N = pairs.length;
  if (N < 3) throw new StatsError("No hay suficientes observaciones emparejadas para calcular κ de Cohen.");

  const categories = getLevels(pairs.flat());
  const k = categories.length;
  const idxMap = Object.fromEntries(categories.map((c, i) => [c, i]));
  const mat: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const [a, b] of pairs) mat[idxMap[a]][idxMap[b]]++;

  const rowSums = mat.map((row) => row.reduce((s, x) => s + x, 0));
  const colSums = Array.from({ length: k }, (_, j) => mat.reduce((s, row) => s + row[j], 0));

  let diag = 0;
  let pe = 0;
  for (let i = 0; i < k; i++) {
    diag += mat[i][i];
    pe += (rowSums[i] / N) * (colSums[i] / N);
  }
  const po = diag / N;
  const kappa = pe < 1 ? (po - pe) / (1 - pe) : 1;

  // Fleiss / Cohen asymptotic SE
  let pii = 0;
  for (let i = 0; i < k; i++) {
    const pi = rowSums[i] / N;
    const pj = colSums[i] / N;
    pii += pi * pj * (pi + pj);
  }
  const se = pe < 1 ? Math.sqrt(Math.max(0, (pe + pe * pe - pii) / (N * (1 - pe) * (1 - pe)))) : 0;
  const z = se > 0 ? kappa / se : 0;
  const pVal = 2 * (1 - normCdf(Math.abs(z)));
  const ciLo = kappa - 1.96 * se;
  const ciHi = kappa + 1.96 * se;

  const landis =
    kappa < 0
      ? "Pobre (< 0)"
      : kappa <= 0.2
        ? "Leve (0.01–0.20)"
        : kappa <= 0.4
          ? "Aceptable (0.21–0.40)"
          : kappa <= 0.6
            ? "Moderada (0.41–0.60)"
            : kappa <= 0.8
              ? "Sustancial (0.61–0.80)"
              : "Casi perfecta (0.81–1.00)";

  return {
    title: `Concordancia interobservador (κ de Cohen): ${v1} vs ${v2}`,
    tables: [
      {
        title: "Estimación de concordancia",
        columns: ["N", "Acuerdo observado", "Acuerdo esperado", "κ de Cohen", "EE", "IC 95%", "p", "Landis & Koch"],
        rows: [
          [
            N,
            `${rn(po * 100, 1)}%`,
            `${rn(pe * 100, 1)}%`,
            rn(kappa, 3),
            rn(se, 3),
            `${rn(ciLo, 3)} – ${rn(ciHi, 3)}`,
            fp(pVal),
            landis,
          ],
        ],
        note: "Interpretación según escala clínica de Landis & Koch (1977).",
      },
      {
        title: `Matriz de concordancia (${v1} × ${v2})`,
        columns: [v1, ...categories, "Total"],
        rows: categories.map((cat, i) => [cat, ...mat[i], rowSums[i]]),
        note: "",
      },
    ],
    charts: [],
    summary: `κ de Cohen = ${rn(kappa, 3)} (IC 95%: ${rn(ciLo, 3)}–${rn(ciHi, 3)}, p = ${fp(pVal)}) → concordancia ${landis}.`,
  };
}

function runMcNemar(rows: Record<string, Cell>[], params: Record<string, unknown>): Omit<AnalysisResult, "test"> {
  const v1 = params.var1 as string;
  const v2 = params.var2 as string;
  needCols(rows, [v1, v2]);

  const b1 = resolveBinaryColumn(rows, v1);
  const b2 = resolveBinaryColumn(rows, v2);

  let a = 0; // 1 -> 1
  let b = 0; // 1 -> 0
  let c = 0; // 0 -> 1
  let d = 0; // 0 -> 0
  for (let i = 0; i < rows.length; i++) {
    const x1 = b1.values[i];
    const x2 = b2.values[i];
    if (x1 === null || x2 === null) continue;
    if (x1 === 1 && x2 === 1) a++;
    else if (x1 === 1 && x2 === 0) b++;
    else if (x1 === 0 && x2 === 1) c++;
    else d++;
  }
  const N = a + b + c + d;
  if (N < 2) throw new StatsError("No hay pares válidos para la prueba de McNemar.");

  const disc = b + c;
  const chiRaw = disc > 0 ? ((b - c) * (b - c)) / disc : 0;
  const chiYates = disc > 0 ? Math.pow(Math.max(0, Math.abs(b - c) - 1), 2) / disc : 0;
  const pChi = chi2Pval(chiYates, 1);

  // Exact two-sided binomial p-value on discordant pairs
  let pExact = 1;
  if (disc > 0 && disc <= 200) {
    const kMin = Math.min(b, c);
    let tail = 0;
    const logHalfN = disc * Math.log(0.5);
    for (let k = 0; k <= kMin; k++) {
      const logComb = logGamma(disc + 1) - logGamma(k + 1) - logGamma(disc - k + 1);
      tail += Math.exp(logComb + logHalfN);
    }
    pExact = Math.min(1, 2 * tail);
  } else {
    pExact = chi2Pval(chiRaw, 1);
  }

  const prop1 = ((a + b) / N) * 100;
  const prop2 = ((a + c) / N) * 100;

  return {
    title: `Prueba de McNemar (medidas binarias pareadas): ${v1} vs ${v2}`,
    tables: [
      {
        title: "Tabla de pares concordantes y discordantes",
        columns: [v1, `${v2} = ${b2.posLabel}`, `${v2} = ${b2.negLabel}`, "Total"],
        rows: [
          [`${v1} = ${b1.posLabel}`, a, b, a + b],
          [`${v1} = ${b1.negLabel}`, c, d, c + d],
          ["Total", a + c, b + d, N],
        ],
        note: `Pares discordantes: b = ${b}, c = ${c} (total = ${disc}).`,
      },
      {
        title: "Contraste de McNemar",
        columns: ["N pares", `% ${v1}`, `% ${v2}`, "χ² (Edwards)", "p (McNemar)", "p exacto binomial"],
        rows: [[N, `${rn(prop1, 1)}%`, `${rn(prop2, 1)}%`, rn(chiYates, 3), fp(pChi), fp(pExact)]],
        note: "Se recomienda p exacto binomial cuando hay menos de 25 pares discordantes.",
      },
    ],
    charts: [
      {
        type: "bar",
        title: "Proporción de positivos (%)",
        x: "momento",
        series: ["Porcentaje"],
        data: [
          { momento: v1, Porcentaje: rn(prop1, 1) },
          { momento: v2, Porcentaje: rn(prop2, 1) },
        ],
        meta: {},
      },
    ],
    summary: `Cambio pareado de ${rn(prop1, 1)}% a ${rn(prop2, 1)}% (N=${N}); χ² de McNemar = ${rn(chiYates, 2)}, p = ${fp(pChi)} (p exacto = ${fp(pExact)}).`,
  };
}

function runFriedman(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varMap?: VarMetaMap
): Omit<AnalysisResult, "test"> {
  const vars = (params.vars as string[]) || [];
  if (vars.length < 3) {
    throw new StatsError("La prueba de Friedman requiere al menos 3 variables numéricas u ordinales medidas en los mismos sujetos.");
  }
  needCols(rows, vars);

  const seriesByVar = vars.map((v) => getNumericSeries(rows, v, varMap).values);
  const complete: number[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const vals = seriesByVar.map((s) => s[i]);
    if (vals.every((v) => v !== null)) complete.push(vals as number[]);
  }
  const N = complete.length;
  const k = vars.length;
  if (N < 3) throw new StatsError("Se necesitan al menos 3 sujetos con datos completos en todos los momentos.");

  const rankSums = new Array(k).fill(0);
  let tieAdjTotal = 0;
  for (const subj of complete) {
    const { ranks, tieSum } = ranksWithTies(subj);
    tieAdjTotal += tieSum;
    for (let j = 0; j < k; j++) rankSums[j] += ranks[j];
  }

  const meanRank = (k + 1) / 2;
  const ssr = rankSums.reduce((s, rj) => s + Math.pow(rj / N - meanRank, 2), 0);
  const denom = (k * (k + 1)) / 12 - tieAdjTotal / (N * k * (k - 1));
  const chiF = denom > 0 ? (N * ssr) / denom : 0;
  const pVal = chi2Pval(chiF, k - 1);
  const kendallW = chiF / (N * (k - 1));

  const descRows: Cell[][] = vars.map((v, j) => {
    const arr = complete.map((subj) => subj[j]).sort((a, b) => a - b);
    const m = mean(arr);
    return [
      v,
      N,
      rn(rankSums[j] / N, 2),
      rn(quantile(arr, 0.5), 2),
      `${rn(quantile(arr, 0.25), 2)} – ${rn(quantile(arr, 0.75), 2)}`,
      `${rn(m, 2)} ± ${rn(sd(arr, m), 2)}`,
    ];
  });

  const boxData = vars.map((v, j) => boxStats(complete.map((subj) => subj[j]), v));

  // Pairwise Wilcoxon signed-rank post-hoc with Holm adjustment
  const pairPh: { v1: string; v2: string; w: number; pRaw: number }[] = [];
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      const diffs = complete.map((subj) => subj[b] - subj[a]).filter((d) => d !== 0);
      let wStat = 0;
      let pRaw = 1;
      if (diffs.length > 0) {
        const { ranks, tieSum } = ranksWithTies(diffs.map((d) => Math.abs(d)));
        let wPlus = 0;
        let wMinus = 0;
        diffs.forEach((d, idx) => {
          if (d > 0) wPlus += ranks[idx];
          else wMinus += ranks[idx];
        });
        wStat = Math.min(wPlus, wMinus);
        const m = diffs.length;
        const meanW = (m * (m + 1)) / 4;
        const varW = (m * (m + 1) * (2 * m + 1) - tieSum / 2) / 24;
        if (varW > 0) {
          const z = (Math.abs(wStat - meanW) - 0.5) / Math.sqrt(varW);
          pRaw = 2 * (1 - normCdf(Math.max(0, z)));
        }
      }
      pairPh.push({ v1: vars[a], v2: vars[b], w: wStat, pRaw });
    }
  }
  const holmP = holmAdjust(pairPh.map((r) => r.pRaw));

  return {
    title: `ANOVA no paramétrico de Friedman (${vars.join(", ")})`,
    tables: [
      {
        title: "Descriptivos por momento / condición",
        columns: ["Variable", "N", "Rango medio", "Mediana", "RIC (Q1–Q3)", "Media ± DE"],
        rows: descRows,
        note: "",
      },
      {
        title: "Estadístico de Friedman",
        columns: ["N sujetos", "Condiciones (k)", "χ² de Friedman", "gl", "p", "W de Kendall"],
        rows: [[N, k, rn(chiF, 3), k - 1, fp(pVal), rn(kendallW, 3)]],
        note: "W de Kendall mide la concordancia / tamaño del efecto (0.1 pequeño, 0.3 moderado, ≥0.5 grande).",
      },
      {
        title: "Post hoc pareado: Wilcoxon con corrección de Holm",
        columns: ["Condición 1", "Condición 2", "W", "p bruta", "p ajustada (Holm)", "Significativo"],
        rows: pairPh.map((r, idx) => [r.v1, r.v2, rn(r.w, 1), fp(r.pRaw), fp(holmP[idx]), holmP[idx] < 0.05 ? "Sí" : "No"]),
        note: "Comparaciones pareadas no paramétricas ajustadas por multiplicidad (Holm).",
      },
    ],
    charts: [{ type: "box", title: "Comparación de medidas repetidas", data: boxData, x: "group", series: ["median"], meta: {} }],
    summary: `χ² de Friedman(${k - 1}) = ${rn(chiF, 2)}, p = ${fp(pVal)}, W de Kendall = ${rn(kendallW, 3)} (N = ${N}).`,
  };
}

function runCoxPh(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varTypes: Record<string, VarType>
): Omit<AnalysisResult, "test"> {
  const tv = params.time as string;
  const ev = params.event as string;
  const predictors = (params.predictors as string[]) || [];
  if (!predictors.length) throw new StatsError("Selecciona al menos una covariable predictora para el modelo de Cox.");
  needCols(rows, [tv, ev, ...predictors]);

  const catLevels: Record<string, string[]> = {};
  for (const pv of predictors) {
    const t = varTypes[pv] ?? "numeric";
    if (t !== "numeric") {
      const lvs = getLevels(rows.map((r) => toLbl(r[pv])));
      if (lvs.length < 2) throw new StatsError(`El predictor '${pv}' necesita al menos 2 categorías.`);
      catLevels[pv] = lvs;
    }
  }

  const termNames: string[] = [];
  for (const pv of predictors) {
    if (catLevels[pv]) {
      for (let i = 1; i < catLevels[pv].length; i++) termNames.push(`${pv}: ${catLevels[pv][i]}`);
    } else {
      termNames.push(pv);
    }
  }

  const obs: { t: number; e: number; x: number[] }[] = [];
  for (const r of rows) {
    const tVal = toNum(r[tv]);
    const eVal = toEvent01(r[ev]);
    if (tVal === null || eVal === null || (eVal !== 0 && eVal !== 1) || tVal < 0) continue;
    const xRow: number[] = [];
    let valid = true;
    for (const pv of predictors) {
      if (catLevels[pv]) {
        const lbl = toLbl(r[pv]);
        if (lbl === null) {
          valid = false;
          break;
        }
        for (let i = 1; i < catLevels[pv].length; i++) xRow.push(lbl === catLevels[pv][i] ? 1 : 0);
      } else {
        const num = toNum(r[pv]);
        if (num === null) {
          valid = false;
          break;
        }
        xRow.push(num);
      }
    }
    if (valid) obs.push({ t: tVal, e: eVal, x: xRow });
  }

  const n = obs.length;
  const p = termNames.length;
  const totalEvents = obs.filter((o) => o.e === 1).length;
  if (n < p + 5 || totalEvents < 3) {
    throw new StatsError("Insuficientes eventos o casos completos para ajustar la regresión de Cox.");
  }

  // Sort descending by time so risk set accumulations are O(N) per iteration
  obs.sort((a, b) => b.t - a.t);

  // Standardize numeric predictors internally for numerical stability, then rescale back
  const means = Array.from({ length: p }, (_, j) => mean(obs.map((o) => o.x[j])));
  const sds = Array.from({ length: p }, (_, j) => {
    const s = sd(obs.map((o) => o.x[j]), means[j]);
    return s > 1e-8 ? s : 1;
  });
  const Xstd = obs.map((o) => o.x.map((v, j) => (v - means[j]) / sds[j]));

  const evalPartialLL = (beta: number[]) => {
    let ll = 0;
    const grad = new Array(p).fill(0);
    const info: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));

    let s0 = 0;
    const s1 = new Array(p).fill(0);
    const s2: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));

    let i = 0;
    while (i < n) {
      const currT = obs[i].t;
      let j = i;
      while (j < n && obs[j].t === currT) {
        const eta = Math.max(-20, Math.min(20, Xstd[j].reduce((s, v, k) => s + v * beta[k], 0)));
        const w = Math.exp(eta);
        s0 += w;
        for (let a = 0; a < p; a++) {
          s1[a] += w * Xstd[j][a];
          for (let b = 0; b < p; b++) s2[a][b] += w * Xstd[j][a] * Xstd[j][b];
        }
        j++;
      }
      // Events at currT (Breslow)
      let dCount = 0;
      for (let m = i; m < j; m++) {
        if (obs[m].e === 1) {
          dCount++;
          const eta = Math.max(-20, Math.min(20, Xstd[m].reduce((s, v, k) => s + v * beta[k], 0)));
          ll += eta - Math.log(s0);
          for (let a = 0; a < p; a++) grad[a] += Xstd[m][a] - s1[a] / s0;
        }
      }
      if (dCount > 0 && s0 > 0) {
        for (let a = 0; a < p; a++) {
          const xBarA = s1[a] / s0;
          for (let b = 0; b < p; b++) {
            const xBarB = s1[b] / s0;
            info[a][b] += dCount * (s2[a][b] / s0 - xBarA * xBarB);
          }
        }
      }
      i = j;
    }
    return { ll, grad, info };
  };

  let betaStd = new Array(p).fill(0);
  const llNull = evalPartialLL(betaStd).ll;
  let invInfoStd: number[][] | null = null;
  let llModel = llNull;

  for (let iter = 0; iter < 35; iter++) {
    const { ll, grad, info } = evalPartialLL(betaStd);
    llModel = ll;
    const inv = invertMatrix(info);
    if (!inv) break;
    invInfoStd = inv;
    const step = matMulVec(inv, grad);
    const maxStep = Math.max(...step.map((v) => Math.abs(v)));
    betaStd = betaStd.map((b, k) => b + step[k]);
    if (maxStep < 1e-6) break;
  }
  if (!invInfoStd) throw new StatsError("El modelo de Cox no convergió por colinealidad o separación.");
  llModel = evalPartialLL(betaStd).ll;

  const beta = betaStd.map((b, j) => b / sds[j]);
  const seArr = Array.from({ length: p }, (_, j) => Math.sqrt(Math.max(0, invInfoStd![j][j])) / sds[j]);
  const lrStat = Math.max(0, 2 * (llModel - llNull));
  const lrP = chi2Pval(lrStat, p);

  // Harrell's C-index
  const riskScores = obs.map((o) => o.x.reduce((s, v, j) => s + v * beta[j], 0));
  let conc = 0;
  let compPairs = 0;
  for (let a = 0; a < n; a++) {
    if (obs[a].e !== 1) continue;
    for (let b = 0; b < n; b++) {
      if (obs[b].t > obs[a].t || (obs[b].t === obs[a].t && obs[b].e === 0)) {
        compPairs++;
        if (riskScores[a] > riskScores[b]) conc += 1;
        else if (riskScores[a] === riskScores[b]) conc += 0.5;
      }
    }
  }
  const cIndex = compPairs > 0 ? conc / compPairs : 0.5;

  // Schoenfeld residuals proportional hazards test
  const eventTimes: number[] = [];
  const rawSch: number[][] = [];
  let s0Sch = 0;
  const s1Sch = new Array(p).fill(0);
  let idxS = 0;
  while (idxS < n) {
    const currT = obs[idxS].t;
    let jS = idxS;
    while (jS < n && obs[jS].t === currT) {
      const eta = Math.max(-20, Math.min(20, Xstd[jS].reduce((s, v, k) => s + v * betaStd[k], 0)));
      const w = Math.exp(eta);
      s0Sch += w;
      for (let a = 0; a < p; a++) s1Sch[a] += w * Xstd[jS][a];
      jS++;
    }
    for (let m = idxS; m < jS; m++) {
      if (obs[m].e === 1 && s0Sch > 0) {
        eventTimes.push(currT);
        rawSch.push(Xstd[m].map((v, a) => v - s1Sch[a] / s0Sch));
      }
    }
    idxS = jS;
  }

  const phRows: Cell[][] = [];
  let globalPhChi2 = 0;
  const phWarnings: string[] = [];
  if (rawSch.length >= 4) {
    const scaledSch = rawSch.map((rVec) => matMulVec(invInfoStd!, rVec).map((v) => v * rawSch.length));
    const timeAscRanks = ranksWithTies(eventTimes.map((t) => t)).ranks;
    const tRankNorm = timeAscRanks.map((rk) => rk / Math.max(1, eventTimes.length));
    const tRankMean = mean(tRankNorm);
    const tRankVar = tRankNorm.reduce((s, v) => s + (v - tRankMean) ** 2, 0);

    for (let j = 0; j < p; j++) {
      const rj = scaledSch.map((row) => row[j]);
      const rjMean = mean(rj);
      const rjVar = rj.reduce((s, v) => s + (v - rjMean) ** 2, 0);
      let cov = 0;
      for (let m = 0; m < rj.length; m++) cov += (tRankNorm[m] - tRankMean) * (rj[m] - rjMean);
      const rho = tRankVar > 0 && rjVar > 0 ? cov / Math.sqrt(tRankVar * rjVar) : 0;
      const chi1 = Math.max(0, (rj.length - 1) * rho * rho);
      const pPh = chi2Pval(chi1, 1);
      globalPhChi2 += chi1;
      phRows.push([termNames[j], rn(rho, 3), rn(chi1, 3), 1, fp(pPh), pPh < 0.05 ? "Posible violación" : "Cumple"]);
      if (pPh < 0.05) phWarnings.push(termNames[j]);
    }
    const globalPhP = chi2Pval(globalPhChi2, p);
    phRows.push(["GLOBAL", "—", rn(globalPhChi2, 3), p, fp(globalPhP), globalPhP < 0.05 ? "Posible violación" : "Cumple"]);
  }

  const coefRows: Cell[][] = [];
  const hrChart: Record<string, Cell>[] = [];
  termNames.forEach((name, j) => {
    const se = seArr[j];
    const z = se > 0 ? beta[j] / se : 0;
    const pVal = 2 * (1 - normCdf(Math.abs(z)));
    const hr = Math.exp(beta[j]);
    const lo = Math.exp(beta[j] - 1.96 * se);
    const hi = Math.exp(beta[j] + 1.96 * se);
    coefRows.push([name, rn(beta[j], 4), rn(se, 4), rn(z, 3), fp(pVal), rn(hr, 3), `${rn(lo, 3)} – ${rn(hi, 3)}`]);
    hrChart.push({ variable: name, HR: rn(hr, 3) });
  });

  const phNote = phWarnings.length
    ? `⚠ Residuos de Schoenfeld p < 0.05 en: ${phWarnings.join(", ")} (revisar supuesto de riesgos proporcionales).`
    : "Supuesto de riesgos proporcionales verificado sin desviaciones significativas (p ≥ 0.05).";

  return {
    title: `Regresión de riesgos proporcionales de Cox: ${tv} (${ev})`,
    tables: [
      {
        title: "Ajuste global del modelo",
        columns: ["N", "Eventos", "Concordancia (C-index)", "χ² (Razón de verosimilitud)", "gl", "p global"],
        rows: [[n, totalEvents, rn(cIndex, 3), rn(lrStat, 2), p, fp(lrP)]],
        note: "Estimación mediante verosimilitud parcial de Cox con manejo de empates de Breslow.",
      },
      {
        title: "Hazard Ratios ajustados (HR)",
        columns: ["Covariable", "β", "EE", "Wald z", "p", "HR", "IC 95% HR"],
        rows: coefRows,
        note: "HR > 1 indica mayor riesgo instantáneo del evento; HR < 1 indica efecto protector.",
      },
      ...(phRows.length
        ? [
            {
              title: "Diagnóstico de riesgos proporcionales (Residuos de Schoenfeld)",
              columns: ["Covariable", "ρ (con rango tiempo)", "χ²", "gl", "p", "Supuesto PH"],
              rows: phRows,
              note: phNote,
            },
          ]
        : []),
    ],
    charts: [
      {
        type: "bar",
        title: "Hazard Ratios (HR) ajustados",
        x: "variable",
        series: ["HR"],
        data: hrChart,
        meta: { refline: 1 },
      },
    ],
    summary: `Modelo de Cox (N=${n}, ${totalEvents} eventos): C-index = ${rn(cIndex, 3)}, χ² = ${rn(lrStat, 2)}, p global = ${fp(lrP)}.${phWarnings.length ? ` ${phNote}` : ""}`,
  };
}

function runPoissonReg(
  rows: Record<string, Cell>[],
  params: Record<string, unknown>,
  varTypes: Record<string, VarType>
): Omit<AnalysisResult, "test"> {
  const outcome = params.outcome as string;
  const predictors = (params.predictors as string[]) || [];
  const { X, y, termNames } = buildDesignMatrix(rows, outcome, predictors, varTypes, false);

  if (y.some((v) => v < 0)) {
    throw new StatsError(`La variable de conteo '${outcome}' no puede tener valores negativos en regresión de Poisson.`);
  }

  const n = X.length;
  const p = termNames.length;
  const yMean = Math.max(1e-3, mean(y));
  let beta = new Array(p).fill(0);
  beta[0] = Math.log(yMean);
  let invInfo: number[][] | null = null;

  for (let iter = 0; iter < 40; iter++) {
    const grad = new Array(p).fill(0);
    const info: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) {
      const eta = Math.max(-15, Math.min(15, X[i].reduce((s, v, j) => s + v * beta[j], 0)));
      const mu = Math.exp(eta);
      for (let j = 0; j < p; j++) {
        grad[j] += X[i][j] * (y[i] - mu);
        for (let k = 0; k < p; k++) info[j][k] += X[i][j] * X[i][k] * mu;
      }
    }
    const inv = invertMatrix(info);
    if (!inv) throw new StatsError("El modelo de Poisson no convergió (matriz singular).");
    invInfo = inv;
    const step = matMulVec(inv, grad);
    const maxStep = Math.max(...step.map((v) => Math.abs(v)));
    beta = beta.map((b, j) => b + step[j]);
    if (maxStep < 1e-7) break;
  }
  if (!invInfo) throw new StatsError("El modelo de Poisson no convergió.");

  let llModel = 0;
  let llNull = 0;
  let deviance = 0;
  let pearsonChi2 = 0;
  for (let i = 0; i < n; i++) {
    const eta = Math.max(-15, Math.min(15, X[i].reduce((s, v, j) => s + v * beta[j], 0)));
    const mu = Math.exp(eta);
    llModel += y[i] * eta - mu - logGamma(y[i] + 1);
    llNull += y[i] * Math.log(yMean) - yMean - logGamma(y[i] + 1);
    deviance += 2 * (y[i] > 0 ? y[i] * Math.log(y[i] / mu) - (y[i] - mu) : mu);
    pearsonChi2 += mu > 0 ? ((y[i] - mu) ** 2) / mu : 0;
  }
  const dfResid = Math.max(1, n - p);
  const phiDisp = pearsonChi2 / dfResid;
  const dispWarn =
    phiDisp > 1.5
      ? ` ⚠ Sobredispersión detectada (φ = χ² Pearson/gl = ${rn(phiDisp, 2)} > 1.5): considera usar Regresión Binomial Negativa (negbin_reg).`
      : ` Dispersión Pearson φ = ${rn(phiDisp, 2)} (adecuada para Poisson).`;
  const pseudoR2 = llNull !== 0 ? 1 - llModel / llNull : 0;
  const aic = -2 * llModel + 2 * p;
  const lrStat = Math.max(0, 2 * (llModel - llNull));
  const lrP = p > 1 ? chi2Pval(lrStat, p - 1) : 1;

  const coefRows: Cell[][] = [];
  const irrChart: Record<string, Cell>[] = [];
  termNames.forEach((t, j) => {
    const se = Math.sqrt(Math.max(0, invInfo![j][j]));
    const z = se > 0 ? beta[j] / se : 0;
    const pVal = 2 * (1 - normCdf(Math.abs(z)));
    const irr = Math.exp(beta[j]);
    const lo = Math.exp(beta[j] - 1.96 * se);
    const hi = Math.exp(beta[j] + 1.96 * se);
    coefRows.push([t, rn(beta[j], 4), rn(se, 4), rn(z, 3), fp(pVal), rn(irr, 3), `${rn(lo, 3)} – ${rn(hi, 3)}`]);
    if (t !== "Constante") irrChart.push({ category: t, IRR: rn(irr, 3) });
  });

  return {
    title: `Regresión de Poisson (tasas e incidencia): ${outcome}`,
    tables: [
      {
        title: "Resumen del modelo",
        columns: ["N", "Devianza", "Pseudo R²", "AIC", "p (LR)"],
        rows: [[n, rn(deviance, 2), rn(pseudoR2, 3), rn(aic, 1), fp(lrP)]],
        note: dispWarn.trim(),
      },
      {
        title: "Coeficientes (Razones de Tasas de Incidencia · IRR)",
        columns: ["Término", "β", "EE", "z", "p", "IRR", "IC 95% IRR"],
        rows: coefRows,
        note: "IRR > 1 indica aumento proporcional en la tasa/conteo esperado.",
      },
    ],
    charts: [
      {
        type: "bar",
        title: "Razones de Tasas de Incidencia (IRR)",
        x: "category",
        series: ["IRR"],
        data: irrChart,
        meta: { refline: 1 },
      },
    ],
    summary: `Pseudo R² = ${rn(pseudoR2, 3)}, Devianza = ${rn(deviance, 1)}, φ = ${rn(phiDisp, 2)}, p (LR) = ${fp(lrP)}, N = ${n}.${phiDisp > 1.5 ? dispWarn : ""}`,
  };
}

export const TEST_DOCS = `- descriptives: {"vars": [numéricas u ordinales / categóricas]}
- frequencies: {"var": ".."}
- table1: {"group": categórica opcional, "vars": [..]} (adapta automáticamente a mediana/RIC y Mann-Whitney/Kruskal si es ordinal o Shapiro-Wilk p < 0.05)
- outlier_detection: {"vars": [numéricas], "z_threshold": 3.0 opcional} (IQR 1.5x, |z| modificado MAD y Tukey)
- missing_analysis: {"vars": [opcionales]} (valores perdidos por variable, completitud de casos y patrón de ausencia)
- ttest (2 grupos independientes, solo numérica normal): {"outcome": numérica, "group": categórica 2 niveles}
- paired_ttest (incluye Wilcoxon no paramétrico): {"var1": numérica u ordinal, "var2": numérica u ordinal}
- mannwhitney (no paramétrica recomendada para ordinales o no normales): {"outcome": numérica u ordinal, "group": categórica 2 niveles}
- anova (incluye Kruskal-Wallis H + post-hoc Holm para ordinales o no normales): {"outcome": numérica u ordinal, "group": categórica}
- rm_anova (ANOVA medidas repetidas intra-sujeto + Greenhouse-Geisser + Holm): {"vars": [m1, m2, m3]}
- friedman (≥3 medidas repetidas no paramétricas + post-hoc Wilcoxon-Holm): {"vars": [var1, var2, var3]}
- chi2: {"row": categórica/ordinal, "col": categórica/ordinal} (incluye OR si 2x2)
- mcnemar (medidas binarias pareadas): {"var1": binaria, "var2": binaria}
- epidemiology_2x2 (RR, OR, RAR, RRR, NNT/NNH): {"exposure": binaria, "outcome": binaria}
- incidence_prevalence (prevalencia/incidencia acumulada con IC 95% Wilson y tasa por persona-tiempo): {"event": binaria, "time": numérica opcional, "group": categórica opcional}
- kappa_agreement (concordancia κ de Cohen): {"var1": categórica/ordinal, "var2": categórica/ordinal}
- icc (Coeficiente de Correlación Intraclase para ≥2 evaluadores/medidas numéricas): {"vars": [m1, m2, ...], "icc_type": "ICC2_1"|"ICC3_1"|"ICC2_k"}
- diagnostic_test (Sensibilidad, Especificidad, VPP, VPN, LR+ / LR− con IC 95%): {"test_var": binaria, "gold_standard": binaria}
- roc_auc (Curva ROC, AUC y corte óptimo Youden): {"marker": numérica u ordinal, "outcome": binaria}
- correlation: {"vars": [numéricas u ordinales], "method": "pearson"|"spearman"|"kendall"}
- linreg (diagnóstico de residuos + CV 5-fold): {"outcome": numérica, "predictors": [..]}
- logreg (calibración Hosmer-Lemeshow, Brier, CV 5-fold): {"outcome": binaria, "predictors": [..]}
- poisson_reg (conteos/tasas IRR + chequeo sobredispersión): {"outcome": numérica_conteo, "predictors": [..]}
- negbin_reg (conteos sobredispersos IRR + θ): {"outcome": numérica_conteo, "predictors": [..]}
- kaplan_meier (con IC 95% Greenwood log-log): {"time": numérica, "event": 0/1, "group": categórica opcional}
- cox_ph (regresión de Cox multivariable HR + residuos Schoenfeld PH): {"time": numérica, "event": 0/1, "predictors": [..]}
- sample_size (tamaño muestral y cálculo de potencia): {"calc_mode": "sample_size"|"power", "design": "two_proportions"|"two_means"|"correlation"|"cohort_rr", ...}
- multiple_testing (corrección Benjamini-Hochberg FDR, Holm, Bonferroni): {"mode": "screen"|"pvalues", "outcome": ..., "predictors": [...], "method": "fdr_bh"|"holm"|"bonferroni"}
- ts_trend_seasonal (tendencia Mann-Kendall, Sen, descomposición estacional): {"outcome": numérica, "time": opcional, "period": entero}
- ts_arima (ACF, Ljung-Box, ADF, ARIMA(p,d,q) y pronóstico): {"outcome": numérica, "time": opcional, "p": 1, "d": 1, "q": 0, "forecast_steps": 6, "auto_order": true|false}`;

export function runStatTest(
  test: TestName,
  rows: Record<string, Cell>[],
  variables: Variable[],
  params: Record<string, unknown>
): AnalysisResult {
  if (test === "sample_size") {
    return { test, ...runSampleSizeAdv(params) };
  }
  if (test === "multiple_testing" && params.mode === "pvalues") {
    const varMapEmpty: VarMetaMap = new Map(variables.map((v) => [v.name, v]));
    return {
      test,
      ...runMultipleTesting(
        rows,
        params,
        varMapEmpty,
        (xa, xb) => mannWhitneyCore(xa, xb).pVal,
        (groups) => kruskalWallisCore(groups).pVal
      ),
    };
  }
  if (!rows.length) throw new StatsError("La base de datos no tiene registros.");
  const varTypes: Record<string, VarType> = Object.fromEntries(variables.map((v) => [v.name, v.type]));
  const varMap: VarMetaMap = new Map(variables.map((v) => [v.name, v]));

  let res: Omit<AnalysisResult, "test">;
  switch (test) {
    case "descriptives":
      res = runDescriptives(rows, params, varMap);
      break;
    case "frequencies":
      res = runFrequencies(rows, params);
      break;
    case "outlier_detection":
      res = runOutlierDetection(rows, params, varMap);
      break;
    case "missing_analysis":
      res = runMissingAnalysis(rows, params, varMap);
      break;
    case "ttest":
      res = runTTest(rows, params, varMap);
      break;
    case "paired_ttest":
      res = runPairedTTest(rows, params, varMap);
      break;
    case "mannwhitney":
      res = runMannWhitney(rows, params, varMap);
      break;
    case "chi2":
      res = runChi2(rows, params);
      break;
    case "anova":
      res = runAnova(rows, params, varMap);
      break;
    case "rm_anova":
      res = runRmAnova(rows, params, varMap);
      break;
    case "correlation":
      res = runCorrelation(rows, params, varMap);
      break;
    case "linreg":
      res = runLinReg(rows, params, varTypes);
      break;
    case "logreg":
      res = runLogReg(rows, params, varTypes);
      break;
    case "kaplan_meier":
      res = runKaplanMeier(rows, params);
      break;
    case "table1":
      res = runTable1(rows, params, varTypes, varMap);
      break;
    case "friedman":
      res = runFriedman(rows, params, varMap);
      break;
    case "mcnemar":
      res = runMcNemar(rows, params);
      break;
    case "epidemiology_2x2":
      res = runEpidemiology2x2(rows, params);
      break;
    case "incidence_prevalence":
      res = runIncidencePrevalence(rows, params);
      break;
    case "diagnostic_test":
      res = runDiagnosticTest(rows, params);
      break;
    case "roc_auc":
      res = runRocAuc(rows, params, varMap);
      break;
    case "kappa_agreement":
      res = runKappaAgreement(rows, params);
      break;
    case "icc":
      res = runIcc(rows, params, varMap);
      break;
    case "cox_ph":
      res = runCoxPh(rows, params, varTypes);
      break;
    case "poisson_reg":
      res = runPoissonReg(rows, params, varTypes);
      break;
    case "negbin_reg":
      res = runNegBinReg(rows, params, varTypes);
      break;
    case "multiple_testing":
      res = runMultipleTesting(
        rows,
        params,
        varMap,
        (xa, xb) => mannWhitneyCore(xa, xb).pVal,
        (groups) => kruskalWallisCore(groups).pVal
      );
      break;
    case "ts_trend_seasonal":
      res = runTsTrendSeasonal(rows, params);
      break;
    case "ts_arima":
      res = runTsArima(rows, params);
      break;
    default:
      throw new StatsError(`Prueba desconocida: ${String(test)}`);
  }

  return { test, ...res };
}
