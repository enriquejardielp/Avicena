import type { Cell, TestName, Variable } from "./types.ts";

function normToken(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

const KNOWN_ORDINAL_SEQUENCES: string[][] = [
  ["ninguno", "leve", "moderado", "grave", "muy grave"],
  ["ninguna", "leve", "moderada", "severa", "muy severa"],
  ["ausente", "leve", "moderado", "grave"],
  ["ausente", "leve", "moderada", "severa"],
  ["leve", "moderado", "grave"],
  ["leve", "moderada", "severa"],
  ["leve", "moderado", "severo"],
  ["muy bajo", "bajo", "medio", "alto", "muy alto"],
  ["bajo", "medio", "alto"],
  ["baja", "media", "alta"],
  ["nunca", "rara vez", "a veces", "frecuentemente", "siempre"],
  ["nunca", "casi nunca", "a veces", "casi siempre", "siempre"],
  ["nada", "poco", "moderado", "bastante", "mucho"],
  ["malo", "regular", "bueno", "muy bueno", "excelente"],
  ["mala", "regular", "buena", "muy buena", "excelente"],
  ["totalmente en desacuerdo", "en desacuerdo", "neutral", "de acuerdo", "totalmente de acuerdo"],
  ["i", "ii", "iii", "iv", "v"],
  ["estadio 0", "estadio i", "estadio ii", "estadio iii", "estadio iv"],
  ["estadio i", "estadio ii", "estadio iii", "estadio iv"],
  ["nyha i", "nyha ii", "nyha iii", "nyha iv"],
  ["clase i", "clase ii", "clase iii", "clase iv"],
  ["grado 0", "grado 1", "grado 2", "grado 3", "grado 4", "grado 5"],
  ["ecog 0", "ecog 1", "ecog 2", "ecog 3", "ecog 4", "ecog 5"],
];

export function matchKnownOrdinalScale(values: string[]): string[] | null {
  const uniqueNorms = Array.from(new Set(values.map(normToken).filter(Boolean)));
  if (uniqueNorms.length < 2) return null;

  for (const seq of KNOWN_ORDINAL_SEQUENCES) {
    if (uniqueNorms.every((t) => seq.includes(t))) {
      const byNorm = new Map<string, string>();
      for (const raw of values) {
        const key = normToken(raw);
        if (key && !byNorm.has(key)) byNorm.set(key, raw.trim());
      }
      return seq.filter((k) => byNorm.has(k)).map((k) => byNorm.get(k)!);
    }
  }
  return null;
}

export function sortLevelsSmart(rawLevels: string[], existingOrder?: string[]): string[] {
  const uniq = Array.from(new Set(rawLevels.map((l) => l.trim()).filter(Boolean)));
  if (uniq.length <= 1) return uniq;

  if (existingOrder && existingOrder.length > 0) {
    const orderIdx = new Map(existingOrder.map((v, i) => [normToken(v), i]));
    const matched = uniq.filter((u) => orderIdx.has(normToken(u)));
    if (matched.length === uniq.length) {
      return [...uniq].sort((a, b) => (orderIdx.get(normToken(a)) ?? 0) - (orderIdx.get(normToken(b)) ?? 0));
    }
  }

  if (uniq.every((v) => Number.isFinite(Number(v.replace(",", "."))))) {
    return [...uniq].sort((a, b) => Number(a.replace(",", ".")) - Number(b.replace(",", ".")));
  }

  // Leading integer codes like "1 - Leve", "2 - Moderado", "3 - Grave"
  const leadingNum = (s: string): number | null => {
    const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[-:.)]/);
    return m ? Number(m[1]) : null;
  };
  if (uniq.every((v) => leadingNum(v) !== null)) {
    return [...uniq].sort((a, b) => (leadingNum(a) ?? 0) - (leadingNum(b) ?? 0));
  }

  const known = matchKnownOrdinalScale(uniq);
  if (known) return known;

  return [...uniq].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Converts a cell to a numeric value. If the variable is ordinal and has string levels
 * (e.g. "Leve" / "Moderado" / "Grave"), maps each level deterministically to its 1-based rank.
 */
export function toNumericOrOrdinal(
  v: Cell | undefined,
  orderedLevels?: string[],
  isOrdinal = false
): number | null {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const direct = Number(s.replace(",", "."));
  if (Number.isFinite(direct)) return direct;

  if (isOrdinal) {
    if (orderedLevels && orderedLevels.length > 0) {
      const idx = orderedLevels.findIndex((lv) => normToken(lv) === normToken(s));
      if (idx >= 0) return idx + 1;
    }
    const lead = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[-:.)]/);
    if (lead) {
      const n = Number(lead[1]);
      if (Number.isFinite(n)) return n;
    }
    const token = normToken(s);
    for (const seq of KNOWN_ORDINAL_SEQUENCES) {
      const idx = seq.indexOf(token);
      if (idx >= 0) return idx + 1;
    }
  }
  return null;
}

function erfApprox(x: number): number {
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
  return 0.5 * (1 + erfApprox(x / Math.SQRT2));
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

export function shapiroWilkPValue(arr: number[]): number {
  const n = arr.length;
  if (n < 3) return NaN;
  const s = [...arr].slice(0, 5000).sort((a, b) => a - b);
  const m = s.length;
  const mu = s.reduce((acc, v) => acc + v, 0) / m;
  const ss = s.reduce((acc, v) => acc + (v - mu) ** 2, 0);
  if (ss === 0) return 1;
  const z = s.map((_, i) => normInv((i + 1 - 0.375) / (m + 0.25)));
  const zMean = z.reduce((acc, v) => acc + v, 0) / m;
  const zSS = z.reduce((acc, v) => acc + (v - zMean) ** 2, 0);
  const cov = s.reduce((acc, v, i) => acc + (v - mu) * (z[i] - zMean), 0);
  const r2 = (cov * cov) / (ss * zSS);
  const W = Math.min(0.9999, Math.max(0.01, r2));
  const ln1W = Math.log(1 - W);
  const lnn = Math.log(m);
  const muW = -1.5861 - 0.31082 * lnn - 0.083751 * lnn * lnn + 0.0038915 * lnn * lnn * lnn;
  const sigW = Math.exp(-0.4803 - 0.082676 * lnn + 0.0030302 * lnn * lnn);
  const zStat = (ln1W - muW) / sigW;
  return Math.min(1, Math.max(0, 1 - normCdf(zStat)));
}

export interface AssumptionAssessment {
  severity: "ok" | "info" | "warning";
  title: string;
  reasons: string[];
  recommendedTest?: TestName;
  recommendedCorrMethod?: "spearman";
  recommendedActionLabel?: string;
}

export function assessTestAssumptions(input: {
  test: TestName;
  rows: Record<string, Cell>[];
  variables: Variable[];
  outcome: string;
  groupVar: string;
  secondVar: string;
  multiVars: string[];
  corrMethod: "pearson" | "spearman" | "kendall";
}): AssumptionAssessment | null {
  const { test, rows, variables, outcome, groupVar, secondVar, multiVars, corrMethod } = input;
  if (!rows.length) return null;

  const varByName = new Map(variables.map((v) => [v.name, v]));

  const getVals = (varName: string): number[] => {
    const meta = varByName.get(varName);
    const isOrd = meta?.type === "ordinal";
    const levels = meta?.levels?.length ? meta.levels : undefined;
    const out: number[] = [];
    for (const r of rows) {
      const n = toNumericOrOrdinal(r[varName], levels, isOrd);
      if (n !== null) out.push(n);
    }
    return out;
  };

  const fmtP = (p: number) => (!Number.isFinite(p) ? "—" : p < 0.001 ? "<0.001" : p.toFixed(3));

  if (test === "ttest") {
    const outVar = varByName.get(outcome);
    if (!outVar) return null;
    const reasons: string[] = [];

    if (outVar.type === "ordinal") {
      reasons.push(`«${outVar.name}» es una variable ordinal: las pruebas paramétricas de medias (t de Student) no son adecuadas.`);
    }

    if (groupVar) {
      const grpMeta = varByName.get(groupVar);
      const levels = grpMeta?.levels?.length ? grpMeta.levels : [];
      const gBuckets = new Map<string, number[]>();
      for (const r of rows) {
        const g = r[groupVar];
        const y = toNumericOrOrdinal(r[outcome], outVar.levels, outVar.type === "ordinal");
        if (g !== null && g !== undefined && String(g).trim() !== "" && y !== null) {
          const key = String(g).trim();
          const list = gBuckets.get(key) ?? [];
          list.push(y);
          gBuckets.set(key, list);
        }
      }
      for (const [grp, vals] of gBuckets.entries()) {
        if (vals.length >= 3) {
          const sw = shapiroWilkPValue(vals);
          if (Number.isFinite(sw) && sw < 0.05) {
            reasons.push(`El grupo «${grp}» en «${outcome}» incumple normalidad (Shapiro-Wilk p = ${fmtP(sw)}).`);
          } else if (vals.length < 15 && levels.length <= 2) {
            reasons.push(`Tamaño muestral pequeño en «${grp}» (n = ${vals.length} < 15): verifica normalidad o usa alternativa no paramétrica.`);
          }
        }
      }
    }

    if (reasons.length > 0) {
      return {
        severity: "warning",
        title: "Supuestos paramétricos de la t de Student comprometidos",
        reasons,
        recommendedTest: "mannwhitney",
        recommendedActionLabel: "Cambiar a U de Mann-Whitney",
      };
    }
    return {
      severity: "ok",
      title: "Supuesto de normalidad compatible",
      reasons: [`«${outcome}» no muestra desviación significativa de normalidad (Shapiro-Wilk p ≥ 0.05).`],
    };
  }

  if (test === "mannwhitney") {
    const outVar = varByName.get(outcome);
    if (outVar?.type === "ordinal") {
      return {
        severity: "info",
        title: "Prueba recomendada para variable ordinal",
        reasons: [`U de Mann-Whitney compara rangos y medianas sin requerir normalidad en «${outVar.name}».`],
      };
    }
    return null;
  }

  if (test === "paired_ttest") {
    const v1 = varByName.get(outcome);
    const v2 = varByName.get(secondVar);
    if (!v1 || !v2) return null;
    const reasons: string[] = [];
    if (v1.type === "ordinal" || v2.type === "ordinal") {
      reasons.push("Al menos una medida repetida es ordinal: prioriza el resultado de Wilcoxon de rangos con signo.");
    } else {
      const diffs: number[] = [];
      for (const r of rows) {
        const a = toNumericOrOrdinal(r[v1.name], v1.levels, false);
        const b = toNumericOrOrdinal(r[v2.name], v2.levels, false);
        if (a !== null && b !== null) diffs.push(a - b);
      }
      if (diffs.length >= 3) {
        const sw = shapiroWilkPValue(diffs);
        if (Number.isFinite(sw) && sw < 0.05) {
          reasons.push(`Las diferencias pareadas (${v1.name} − ${v2.name}) no siguen distribución normal (Shapiro-Wilk p = ${fmtP(sw)}).`);
        } else if (diffs.length < 15) {
          reasons.push(`Solo hay ${diffs.length} pares completos (< 15): considera la prueba no paramétrica de Wilcoxon incluida en la tabla.`);
        }
      }
    }
    if (reasons.length > 0) {
      return {
        severity: "warning",
        title: "Preferir lectura no paramétrica (Wilcoxon)",
        reasons,
      };
    }
    return {
      severity: "ok",
      title: "Diferencias pareadas compatibles con normalidad",
      reasons: [`Las diferencias (${v1.name} − ${v2.name}) cumplen normalidad (Shapiro-Wilk p ≥ 0.05).`],
    };
  }

  if (test === "anova") {
    const outVar = varByName.get(outcome);
    if (!outVar) return null;
    const reasons: string[] = [];
    if (outVar.type === "ordinal") {
      reasons.push(`«${outVar.name}» es una variable ordinal: utiliza el contraste no paramétrico de Kruskal-Wallis incluido en la salida.`);
    }
    if (groupVar) {
      const gBuckets = new Map<string, number[]>();
      for (const r of rows) {
        const g = r[groupVar];
        const y = toNumericOrOrdinal(r[outcome], outVar.levels, outVar.type === "ordinal");
        if (g !== null && g !== undefined && String(g).trim() !== "" && y !== null) {
          const key = String(g).trim();
          const list = gBuckets.get(key) ?? [];
          list.push(y);
          gBuckets.set(key, list);
        }
      }
      for (const [grp, vals] of gBuckets.entries()) {
        if (vals.length >= 3) {
          const sw = shapiroWilkPValue(vals);
          if (Number.isFinite(sw) && sw < 0.05) {
            reasons.push(`El grupo «${grp}» incumple normalidad (Shapiro-Wilk p = ${fmtP(sw)}).`);
          }
        }
      }
    }
    if (reasons.length > 0) {
      return {
        severity: "warning",
        title: "Supuestos del ANOVA paramétrico comprometidos",
        reasons: [
          ...reasons,
          "Avicena calculará automáticamente Kruskal-Wallis H como alternativa no paramétrica válida junto al ANOVA.",
        ],
      };
    }
    return {
      severity: "ok",
      title: "Supuesto de normalidad por grupo compatible",
      reasons: [`Los grupos en «${outcome}» no rechazan normalidad (Shapiro-Wilk p ≥ 0.05).`],
    };
  }

  if (test === "correlation" && corrMethod === "pearson" && multiVars.length >= 2) {
    const reasons: string[] = [];
    for (const vn of multiVars) {
      const meta = varByName.get(vn);
      if (meta?.type === "ordinal") {
        reasons.push(`«${vn}» es una variable ordinal: Pearson asume escala continua normal; usa Spearman (ρ).`);
      } else {
        const vals = getVals(vn);
        if (vals.length >= 3) {
          const sw = shapiroWilkPValue(vals);
          if (Number.isFinite(sw) && sw < 0.05) {
            reasons.push(`«${vn}» no sigue distribución normal (Shapiro-Wilk p = ${fmtP(sw)}).`);
          }
        }
      }
    }
    if (reasons.length > 0) {
      return {
        severity: "warning",
        title: "Pearson no es óptimo para variables ordinales o no normales",
        reasons,
        recommendedCorrMethod: "spearman",
        recommendedActionLabel: "Cambiar a Spearman (ρ)",
      };
    }
    return {
      severity: "ok",
      title: "Variables compatibles con correlación paramétrica (Pearson)",
      reasons: ["Las variables seleccionadas son numéricas sin desvío significativo de normalidad."],
    };
  }

  if (test === "linreg" && outcome) {
    const outVar = varByName.get(outcome);
    if (outVar?.type === "ordinal") {
      return {
        severity: "warning",
        title: "Desenlace ordinal en regresión lineal",
        reasons: [
          `«${outcome}» está tipificada como ordinal. La regresión lineal OLS asume desenlace continuo e intervalos equidistantes; considera contraste no paramétrico (Kruskal-Wallis / Spearman) o dicotomización clínica con regresión logística.`,
        ],
      };
    }
  }

  if (test === "rm_anova" && multiVars.length >= 3) {
    const reasons: string[] = [];
    for (const vn of multiVars) {
      const meta = varByName.get(vn);
      if (meta?.type === "ordinal") {
        reasons.push(`«${vn}» es ordinal: ANOVA de medidas repetidas asume escala continua normal.`);
      } else {
        const vals = getVals(vn);
        if (vals.length >= 3) {
          const sw = shapiroWilkPValue(vals);
          if (Number.isFinite(sw) && sw < 0.05) {
            reasons.push(`«${vn}» incumple normalidad (Shapiro-Wilk p = ${fmtP(sw)}).`);
          }
        }
      }
    }
    if (reasons.length > 0) {
      return {
        severity: "warning",
        title: "Supuestos de ANOVA de medidas repetidas comprometidos",
        reasons,
        recommendedTest: "friedman",
        recommendedActionLabel: "Cambiar a prueba de Friedman",
      };
    }
    return {
      severity: "ok",
      title: "Medidas compatibles con ANOVA de medidas repetidas",
      reasons: ["Las medidas repetidas son continuas sin desvío marcado de normalidad (se aplicará corrección de Greenhouse-Geisser si es necesario)."],
    };
  }

  if (test === "poisson_reg" && outcome) {
    const vals = getVals(outcome);
    if (vals.length >= 5) {
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      const v = vals.reduce((s, x) => s + (x - m) ** 2, 0) / (vals.length - 1);
      if (m > 0 && v / m > 1.5) {
        return {
          severity: "warning",
          title: "Posible sobredispersión en los conteos observados",
          reasons: [
            `La varianza marginal (${v.toFixed(2)}) supera en ${(v / m).toFixed(2)}× a la media (${m.toFixed(2)}). Si persiste sobredispersión tras ajustar covariables, prefiere Binomial Negativa.`,
          ],
          recommendedTest: "negbin_reg",
          recommendedActionLabel: "Cambiar a Binomial Negativa",
        };
      }
    }
  }

  if ((test === "ts_arima" || test === "ts_trend_seasonal") && outcome) {
    const vals = getVals(outcome);
    const minReq = test === "ts_arima" ? 10 : 6;
    if (vals.length < minReq) {
      return {
        severity: "warning",
        title: "Serie temporal corta",
        reasons: [`Se detectaron ${vals.length} observaciones válidas en «${outcome}»; se requieren al menos ${minReq} puntos temporales.`],
      };
    }
  }

  return null;
}
