import { z } from "zod";
import type { TestName } from "../src/lib/types.ts";

export const ANALYSIS_SPEC_VERSION = "1.0" as const;

export const VALID_TEST_NAMES: [TestName, ...TestName[]] = [
  "descriptives",
  "frequencies",
  "outlier_detection",
  "missing_analysis",
  "ttest",
  "paired_ttest",
  "mannwhitney",
  "chi2",
  "anova",
  "rm_anova",
  "correlation",
  "icc",
  "linreg",
  "logreg",
  "kaplan_meier",
  "table1",
  "friedman",
  "mcnemar",
  "epidemiology_2x2",
  "incidence_prevalence",
  "diagnostic_test",
  "roc_auc",
  "kappa_agreement",
  "cox_ph",
  "poisson_reg",
  "negbin_reg",
  "sample_size",
  "multiple_testing",
  "ts_trend_seasonal",
  "ts_arima",
];

const varNameSchema = z
  .string()
  .trim()
  .min(1, "Debe especificarse un nombre de variable.")
  .max(160, "Nombre de variable demasiado largo.");

const optionalVarNameSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  varNameSchema.optional()
);

const varListSchema = z.array(varNameSchema).min(1, "Selecciona al menos una variable.").max(60);

const specOptionsSchema = z.object({
  seed: z.number().int().min(0).max(2_147_483_647).default(42),
  alpha: z.number().min(0.0001).max(0.25).default(0.05),
  confLevel: z.number().min(0.75).max(0.999).default(0.95),
  tieMethod: z.enum(["efron", "breslow"]).default("efron"),
});

const defaultOptions = () => ({ seed: 42, alpha: 0.05, confLevel: 0.95, tieMethod: "efron" as const });

export const AnalysisSpecSchema = z.discriminatedUnion("test", [
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("descriptives"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ vars: varListSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("frequencies"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ var: varNameSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("outlier_detection"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({
      vars: varListSchema,
      z_threshold: z.number().min(2).max(6).default(3),
    }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("missing_analysis"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({
      vars: z.array(varNameSchema).max(120).optional(),
    }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("ttest"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ outcome: varNameSchema, group: varNameSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("paired_ttest"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ var1: varNameSchema, var2: varNameSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("mannwhitney"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ outcome: varNameSchema, group: varNameSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("chi2"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ row: varNameSchema, col: varNameSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("anova"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ outcome: varNameSchema, group: varNameSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("rm_anova"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ vars: z.array(varNameSchema).min(3, "ANOVA de medidas repetidas requiere al menos 3 variables.").max(30) }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("correlation"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({
      vars: z.array(varNameSchema).min(2, "Selecciona al menos 2 variables.").max(40),
      method: z.enum(["pearson", "spearman", "kendall"]).default("pearson"),
    }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("icc"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({
      vars: z.array(varNameSchema).min(2, "ICC requiere al menos 2 evaluadores o mediciones.").max(20),
      icc_type: z.enum(["agreement", "consistency"]).default("agreement"),
    }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("linreg"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ outcome: varNameSchema, predictors: varListSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("logreg"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ outcome: varNameSchema, predictors: varListSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("poisson_reg"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ outcome: varNameSchema, predictors: varListSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("negbin_reg"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ outcome: varNameSchema, predictors: varListSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("kaplan_meier"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ time: varNameSchema, event: varNameSchema, group: optionalVarNameSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("cox_ph"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ time: varNameSchema, event: varNameSchema, predictors: varListSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("table1"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ group: optionalVarNameSchema, vars: varListSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("friedman"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ vars: z.array(varNameSchema).min(3, "Friedman requiere al menos 3 variables.").max(30) }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("mcnemar"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ var1: varNameSchema, var2: varNameSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("epidemiology_2x2"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ exposure: varNameSchema, outcome: varNameSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("incidence_prevalence"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({
      outcome: varNameSchema,
      group: optionalVarNameSchema,
      time: optionalVarNameSchema,
    }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("diagnostic_test"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ test_var: varNameSchema, gold_standard: varNameSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("roc_auc"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ marker: varNameSchema, outcome: varNameSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("kappa_agreement"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({ var1: varNameSchema, var2: varNameSchema }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("sample_size"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({
      calc_mode: z.enum(["sample_size", "power"]).default("sample_size"),
      design: z.enum(["two_proportions", "two_means", "correlation", "cohort_rr"]).default("two_proportions"),
      alpha: z.number().min(0.001).max(0.25).default(0.05),
      power: z.number().min(0.5).max(0.99).default(0.8),
      ratio: z.number().min(0.1).max(10).default(1),
      n1: z.number().int().min(3).max(500_000).default(50).optional(),
      p1: z.number().min(0.001).max(0.999).default(0.3).optional(),
      p2: z.number().min(0.001).max(0.999).default(0.15).optional(),
      diff: z.number().positive().default(5).optional(),
      sd_val: z.number().positive().default(10).optional(),
      r_val: z.number().min(-0.99).max(0.99).default(0.3).optional(),
      rr_val: z.number().min(1.05).max(20).default(2.0).optional(),
    }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("multiple_testing"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({
      mode: z.enum(["screen", "pvalues"]).default("screen"),
      group: optionalVarNameSchema,
      vars: z.array(varNameSchema).max(60).optional(),
      pvalues: z.array(z.number().min(0).max(1)).max(500).optional(),
      labels: z.array(z.string().max(120)).max(500).optional(),
      method: z.enum(["fdr_bh", "holm", "bonferroni"]).default("fdr_bh"),
    }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("ts_trend_seasonal"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({
      outcome: varNameSchema,
      time: optionalVarNameSchema,
      period: z.number().int().min(2).max(365).default(12),
    }),
  }),
  z.object({
    specVersion: z.literal(ANALYSIS_SPEC_VERSION).default(ANALYSIS_SPEC_VERSION),
    test: z.literal("ts_arima"),
    options: specOptionsSchema.default(defaultOptions),
    params: z.object({
      outcome: varNameSchema,
      time: optionalVarNameSchema,
      p: z.number().int().min(0).max(5).default(1),
      d: z.number().int().min(0).max(2).default(1),
      q: z.number().int().min(0).max(5).default(1),
      forecast_steps: z.number().int().min(1).max(60).default(6),
      auto_order: z.boolean().default(true),
    }),
  }),
]);

export type AnalysisSpec = z.infer<typeof AnalysisSpecSchema>;

export function buildValidatedAnalysisSpec(
  test: TestName,
  rawParams: Record<string, unknown> = {},
  rawOptions?: { seed?: number; alpha?: number; confLevel?: number; tieMethod?: "efron" | "breslow" }
): AnalysisSpec {
  const cleanParams: Record<string, unknown> = { ...rawParams };
  delete cleanParams.test;

  const numFieldMap: Partial<Record<TestName, string[]>> = {
    sample_size: ["alpha", "power", "ratio", "n1", "p1", "p2", "diff", "sd_val", "r_val", "rr_val"],
    outlier_detection: ["z_threshold"],
    ts_trend_seasonal: ["period"],
    ts_arima: ["p", "d", "q", "forecast_steps"],
  };
  const numKeys = numFieldMap[test];
  if (numKeys) {
    for (const numKey of numKeys) {
      if (numKey in cleanParams && cleanParams[numKey] !== undefined && cleanParams[numKey] !== "") {
        const parsed = Number(cleanParams[numKey]);
        if (Number.isFinite(parsed)) cleanParams[numKey] = parsed;
      }
    }
  }
  if (test === "multiple_testing" && Array.isArray(cleanParams.pvalues)) {
    cleanParams.pvalues = cleanParams.pvalues
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && x >= 0 && x <= 1);
  }
  if (test === "ts_arima" && typeof cleanParams.auto_order === "string") {
    cleanParams.auto_order = cleanParams.auto_order === "true";
  }

  return AnalysisSpecSchema.parse({
    specVersion: ANALYSIS_SPEC_VERSION,
    test,
    options: rawOptions ?? {},
    params: cleanParams,
  });
}

export function extractReferencedVariables(spec: AnalysisSpec): string[] {
  const refs = new Set<string>();
  const p = spec.params as Record<string, unknown>;
  for (const key of [
    "var",
    "var1",
    "var2",
    "outcome",
    "group",
    "row",
    "col",
    "time",
    "event",
    "exposure",
    "test_var",
    "gold_standard",
    "marker",
  ]) {
    const val = p[key];
    if (typeof val === "string" && val.trim()) refs.add(val.trim());
  }
  for (const arrKey of ["vars", "predictors"]) {
    const arr = p[arrKey];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === "string" && item.trim()) refs.add(item.trim());
      }
    }
  }
  return Array.from(refs);
}
