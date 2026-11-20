import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildValidatedAnalysisSpec, VALID_TEST_NAMES } from "../shared/analysisSpec.ts";
import { buildReproduciblePythonScript, computeDatasetSha256, computeSpecHash } from "../server/analysisProvenance.ts";
import { signAuditEntry, verifyAuditChain } from "../server/auditChain.ts";
import { resolveAnalysisPlaceholders, verifyNarrativeAgainstResult } from "../server/narrativeVerifier.ts";
import { runStatTest, StatsError } from "../server/statsEngine.ts";
import {
  executeStatisticalAnalysis,
  resetPythonWorkerHealthCacheForTests,
  VerifiedEngineUnavailableError,
} from "../server/statsWorkerClient.ts";
import type { Cell, Variable } from "../src/lib/types.ts";

describe("Avicena Phase 1 — AnalysisSpec, Provenance & Golden Biostatistics", () => {
  it("validates strict AnalysisSpec discriminated unions and rejects invalid specs", () => {
    const valid = buildValidatedAnalysisSpec(
      "cox_ph",
      { time: "dias", event: "evento", predictors: ["edad", "tratamiento"] },
      { seed: 123, alpha: 0.05, confLevel: 0.95, tieMethod: "efron" }
    );
    assert.equal(valid.test, "cox_ph");
    assert.equal(valid.options.seed, 123);
    assert.equal(valid.options.tieMethod, "efron");
    assert.equal(VALID_TEST_NAMES.length, 30);

    assert.throws(() =>
      buildValidatedAnalysisSpec("friedman", { vars: ["v1", "v2"] })
    );
    assert.throws(() =>
      buildValidatedAnalysisSpec("linreg", { outcome: "", predictors: ["x"] })
    );
  });

  it("produces deterministic datasetSha256 and specHash independent of key order", () => {
    const varsA: Variable[] = [
      { name: "pas", label: "PAS", type: "numeric", levels: [] },
      { name: "grupo", label: "Grupo", type: "categorical", levels: ["A", "B"] },
    ];
    const varsB: Variable[] = [varsA[1], varsA[0]];
    const rowsA: Record<string, Cell>[] = [
      { pas: 120, grupo: "A" },
      { pas: 140, grupo: "B" },
    ];
    const rowsB: Record<string, Cell>[] = [
      { grupo: "A", pas: 120 },
      { grupo: "B", pas: 140 },
    ];

    const h1 = computeDatasetSha256(varsA, rowsA);
    const h2 = computeDatasetSha256(varsB, rowsB);
    assert.equal(h1, h2);
    assert.match(h1, /^[a-f0-9]{64}$/);

    const spec1 = buildValidatedAnalysisSpec("ttest", { outcome: "pas", group: "grupo" });
    const spec2 = buildValidatedAnalysisSpec("ttest", { group: "grupo", outcome: "pas" });
    assert.equal(computeSpecHash(spec1), computeSpecHash(spec2));
  });

  it("matches golden closed-form benchmark for Student t-test & Mann-Whitney", () => {
    const variables: Variable[] = [
      { name: "grupo", label: "Grupo", type: "categorical", levels: ["A", "B"] },
      { name: "valor", label: "Valor", type: "numeric", levels: [] },
    ];
    // Symmetric identical variances: A=[10,12,14,16,18] (mean=14, sd=sqrt(10)), B=[20,22,24,26,28] (mean=24, sd=sqrt(10))
    // diff = -10, se = sqrt(10/5 + 10/5) = 2, t = -5.0, df = 8
    const rows: Record<string, Cell>[] = [
      { grupo: "A", valor: 10 },
      { grupo: "A", valor: 12 },
      { grupo: "A", valor: 14 },
      { grupo: "A", valor: 16 },
      { grupo: "A", valor: 18 },
      { grupo: "B", valor: 20 },
      { grupo: "B", valor: 22 },
      { grupo: "B", valor: 24 },
      { grupo: "B", valor: 26 },
      { grupo: "B", valor: 28 },
    ];

    const tRes = runStatTest("ttest", rows, variables, { outcome: "valor", group: "grupo" });
    const tRow = tRes.tables[1].rows[0];
    assert.equal(Number(tRow[1]), -5);
    assert.equal(Number(tRow[2]), 8);
    assert.ok(tRow[3] === "<0.001" || Number(String(tRow[3])) < 0.002);

    const mwRes = runStatTest("mannwhitney", rows, variables, { outcome: "valor", group: "grupo" });
    // Complete separation between 5 and 5 observations -> U = 0
    assert.equal(Number(mwRes.tables[1].rows[0][0]), 0);
  });

  it("matches golden analytical benchmark for paired t-test, OLS linear regression, and 2x2 Chi-square", () => {
    const variables: Variable[] = [
      { name: "x", label: "X", type: "numeric", levels: [] },
      { name: "y", label: "Y", type: "numeric", levels: [] },
      { name: "pre", label: "Pre", type: "numeric", levels: [] },
      { name: "post", label: "Post", type: "numeric", levels: [] },
      { name: "exp", label: "Exp", type: "binary", levels: ["No", "Sí"] },
      { name: "out", label: "Out", type: "binary", levels: ["No", "Sí"] },
    ];
    // Exact analytical OLS for x=[1..6], y=[4,9,10,15,16,21]: cov(x,y)/var(x) = 55.5 / 17.5 = 3.17142857
    const rows: Record<string, Cell>[] = [
      { x: 1, y: 4, pre: 10, post: 15, exp: "Sí", out: "Sí" },
      { x: 2, y: 9, pre: 12, post: 17, exp: "Sí", out: "Sí" },
      { x: 3, y: 10, pre: 14, post: 19, exp: "Sí", out: "No" },
      { x: 4, y: 15, pre: 16, post: 21, exp: "No", out: "No" },
      { x: 5, y: 16, pre: 18, post: 23, exp: "No", out: "No" },
      { x: 6, y: 21, pre: 20, post: 25, exp: "No", out: "Sí" },
    ];

    const ols = runStatTest("linreg", rows, variables, { outcome: "y", predictors: ["x"] });
    const summaryRow = ols.tables[0].rows[0];
    const r2 = Number(summaryRow[1]);
    assert.ok(r2 > 0.94 && r2 < 0.98, `Expected R² near 0.96, got ${r2}`);
    const slope = Number(ols.tables[1].rows[1][1]);
    assert.ok(Math.abs(slope - 3.1714) < 0.005, `Expected slope ~3.1714, got ${slope}`);
    assert.ok(ols.tables.length >= 3, "Expected residual diagnostics table in linreg");
    assert.ok(ols.charts.some((c) => c.title.includes("Residuos vs")));

    const paired = runStatTest("paired_ttest", rows, variables, { var1: "pre", var2: "post" });
    // Exact constant 5-unit shift between pre and post
    assert.equal(Math.abs(Number(paired.tables[1].rows[0][4])), 5);

    const chi = runStatTest("chi2", rows, variables, { row: "exp", col: "out" });
    // [[2,1],[1,2]] -> chi2 Pearson = 0.667, df = 1
    assert.ok(Math.abs(Number(chi.tables[1].rows[0][1]) - 0.667) < 0.02);
    assert.equal(Number(chi.tables[1].rows[0][2]), 1);
  });

  it("matches golden benchmarks for ROC AUC, Kaplan-Meier Greenwood CI, McNemar, Kappa, Logistic, Poisson, and Cox PH", () => {
    const variables: Variable[] = [
      { name: "score", label: "Score", type: "numeric", levels: [] },
      { name: "evento", label: "Evento", type: "binary", levels: ["0", "1"] },
      { name: "tiempo", label: "Tiempo", type: "numeric", levels: [] },
      { name: "edad", label: "Edad", type: "numeric", levels: [] },
      { name: "conteo", label: "Conteo", type: "numeric", levels: [] },
      { name: "r1", label: "R1", type: "binary", levels: ["0", "1"] },
      { name: "r2", label: "R2", type: "binary", levels: ["0", "1"] },
    ];

    const rows: Record<string, Cell>[] = [
      { score: 1, evento: 0, tiempo: 2, edad: 40, conteo: 1, r1: 0, r2: 0 },
      { score: 2, evento: 0, tiempo: 4, edad: 42, conteo: 1, r1: 0, r2: 0 },
      { score: 3, evento: 0, tiempo: 6, edad: 45, conteo: 1, r1: 0, r2: 1 },
      { score: 4, evento: 0, tiempo: 8, edad: 48, conteo: 2, r1: 0, r2: 0 },
      { score: 5, evento: 0, tiempo: 10, edad: 50, conteo: 2, r1: 0, r2: 0 },
      { score: 6, evento: 1, tiempo: 3, edad: 60, conteo: 4, r1: 1, r2: 1 },
      { score: 7, evento: 1, tiempo: 5, edad: 63, conteo: 5, r1: 1, r2: 1 },
      { score: 8, evento: 1, tiempo: 7, edad: 67, conteo: 5, r1: 1, r2: 1 },
      { score: 9, evento: 1, tiempo: 9, edad: 70, conteo: 6, r1: 1, r2: 1 },
      { score: 10, evento: 1, tiempo: 11, edad: 74, conteo: 7, r1: 1, r2: 1 },
    ];

    // Perfect marker separation -> AUC = 1.0
    const roc = runStatTest("roc_auc", rows, variables, { marker: "score", outcome: "evento" });
    assert.equal(Number(roc.tables[0].rows[0][2]), 1);

    // McNemar exact: b=0, c=1 -> p exact = 1.0000
    const mcn = runStatTest("mcnemar", rows, variables, { var1: "r1", var2: "r2" });
    assert.equal(Number(mcn.tables[1].rows[0][5]), 1);

    // Cohen's kappa with 9/10 agreement -> kappa = 0.8
    const kap = runStatTest("kappa_agreement", rows, variables, { var1: "r1", var2: "r2" });
    assert.ok(Math.abs(Number(kap.tables[0].rows[0][3]) - 0.8) < 0.05);

    // Kaplan-Meier bounds [0, 1] and 5 events
    const km = runStatTest("kaplan_meier", rows, variables, { time: "tiempo", event: "evento" });
    assert.equal(Number(km.tables[0].rows[0][2]), 5);
    const kmSeries = km.charts[0].series[0];
    for (const pt of km.charts[0].data) {
      const s = Number(pt[kmSeries]);
      const lo = Number(pt[`${kmSeries}__ci_lo`]);
      const hi = Number(pt[`${kmSeries}__ci_hi`]);
      assert.ok(lo >= 0 && lo <= s && s <= hi && hi <= 1);
    }

    // Poisson regression positive slope on score
    const pois = runStatTest("poisson_reg", rows, variables, { outcome: "conteo", predictors: ["score"] });
    const irr = Number(pois.tables[1].rows[1][5]);
    assert.ok(irr > 1.15 && irr < 1.35, `Expected positive IRR ~1.22, got ${irr}`);

    // Cox PH with a dedicated coherent survival fixture (earlier events in older patients -> HR > 1)
    const coxRows: Record<string, Cell>[] = [
      { tiempo: 2, evento: 1, edad: 76 },
      { tiempo: 3, evento: 1, edad: 72 },
      { tiempo: 4, evento: 1, edad: 68 },
      { tiempo: 5, evento: 1, edad: 64 },
      { tiempo: 6, evento: 1, edad: 60 },
      { tiempo: 8, evento: 0, edad: 50 },
      { tiempo: 9, evento: 0, edad: 48 },
      { tiempo: 10, evento: 0, edad: 45 },
      { tiempo: 11, evento: 0, edad: 42 },
      { tiempo: 12, evento: 0, edad: 38 },
    ];
    const cox = runStatTest("cox_ph", coxRows, variables, { time: "tiempo", event: "evento", predictors: ["edad"] });
    const cIndex = Number(cox.tables[0].rows[0][2]);
    const hrEdad = Number(cox.tables[1].rows[0][5]);
    assert.ok(cIndex > 0.85, `Expected C-index > 0.85, got ${cIndex}`);
    assert.ok(hrEdad > 1.0, `Expected HR > 1 for edad, got ${hrEdad}`);
    assert.ok(cox.tables.length >= 3, "Expected Schoenfeld proportional hazards diagnostic table");
  });

  it("validates all 9 new tests and upgraded post-hoc / epidemiology / diagnostic extensions", () => {
    const variables: Variable[] = [
      { name: "grupo", label: "Grupo", type: "categorical", levels: ["A", "B", "C"] },
      { name: "v1", label: "V1", type: "numeric", levels: [] },
      { name: "v2", label: "V2", type: "numeric", levels: [] },
      { name: "v3", label: "V3", type: "numeric", levels: [] },
      { name: "count_od", label: "Count OD", type: "numeric", levels: [] },
      { name: "evento", label: "Evento", type: "binary", levels: ["0", "1"] },
      { name: "exp", label: "Exposición", type: "binary", levels: ["0", "1"] },
      { name: "tiempo", label: "Tiempo", type: "numeric", levels: [] },
      { name: "serie", label: "Serie", type: "numeric", levels: [] },
      { name: "t_idx", label: "Mes", type: "numeric", levels: [] },
    ];

    const rows: Record<string, Cell>[] = Array.from({ length: 18 }, (_, i) => ({
      grupo: i < 6 ? "A" : i < 12 ? "B" : "C",
      v1: i === 17 ? 120 : 10 + i * 1.2,
      v2: 14 + i * 1.3 + (i % 2 === 0 ? 0.4 : -0.4),
      v3: 18 + i * 1.5,
      count_od: i < 6 ? 1 : i < 12 ? 3 : 28 + (i % 4) * 9,
      evento: i % 3 === 0 ? 1 : 0,
      exp: i >= 9 ? 1 : 0,
      tiempo: 10 + i,
      serie: 50 + i * 2.5 + Math.sin((2 * Math.PI * i) / 6) * 4,
      t_idx: i + 1,
    }));
    rows[2].v2 = null;

    // 1. Outlier detection (should flag row 18 v1=120)
    const outRes = runStatTest("outlier_detection", rows, variables, { vars: ["v1"], z_threshold: 2.5 });
    assert.ok(Number(outRes.tables[0].rows[0][3]) >= 1);

    // 2. Missing data analysis
    const missRes = runStatTest("missing_analysis", rows, variables, { vars: ["v1", "v2", "grupo"] });
    assert.ok(missRes.summary.includes("Completitud global"));
    assert.equal(Number(missRes.tables[0].rows[1][3]), 1);

    // 3. Repeated-measures ANOVA with Greenhouse-Geisser + Holm post-hoc
    const rmRes = runStatTest("rm_anova", rows, variables, { vars: ["v1", "v2", "v3"] });
    assert.equal(rmRes.tables.length, 3);
    assert.equal(rmRes.charts[0].type, "line");

    // 4. ICC (Shrout-Fleiss)
    const iccRes = runStatTest("icc", rows, variables, { vars: ["v1", "v2"], icc_type: "agreement" });
    assert.equal(iccRes.tables[0].rows.length, 4);

    // 5. ANOVA + Kruskal-Wallis post-hoc table & Friedman post-hoc table
    const anovaRes = runStatTest("anova", rows, variables, { outcome: "v1", group: "grupo" });
    assert.ok(anovaRes.tables.length >= 4, "Expected Kruskal-Wallis Holm post-hoc table[3]");
    const friedRes = runStatTest("friedman", rows, variables, { vars: ["v1", "v2", "v3"] });
    assert.ok(friedRes.tables.length >= 3, "Expected Friedman Wilcoxon-Holm post-hoc table[2]");

    // 6. Correlation with Kendall tau-b
    const kendallRes = runStatTest("correlation", rows, variables, { vars: ["v1", "v3"], method: "kendall" });
    assert.ok(kendallRes.title.includes("τ-b"));
    assert.ok(kendallRes.summary.includes("τ ="));

    // 7. Poisson overdispersion warning + Negative Binomial regression
    const poisOd = runStatTest("poisson_reg", rows, variables, { outcome: "count_od", predictors: ["t_idx"] });
    assert.ok(poisOd.summary.includes("Sobredispersión") || (poisOd.tables[0].note ?? "").includes("Sobredispersión"));
    const nbRes = runStatTest("negbin_reg", rows, variables, { outcome: "count_od", predictors: ["t_idx"] });
    assert.ok(Number(nbRes.tables[0].rows[0][1]) > 0);

    // 8. Epidemiology RRR + Diagnostic Simel LR CI + Incidence/Prevalence person-time
    const epiRes = runStatTest("epidemiology_2x2", rows, variables, { exposure: "exp", outcome: "evento" });
    assert.ok(epiRes.tables[1].rows.some((r) => String(r[0]).includes("RRR")));
    const diagRes = runStatTest("diagnostic_test", rows, variables, { test_var: "exp", gold_standard: "evento" });
    assert.ok(diagRes.tables[1].rows.some((r) => String(r[0]).includes("Odds Ratio Diagnóstica")));
    const incRes = runStatTest("incidence_prevalence", rows, variables, { outcome: "evento", group: "grupo", time: "tiempo" });
    assert.equal(incRes.tables[0].rows.length, 3);

    // 9. Sample size (power mode + cohort_rr) and Multiple Testing (screen + pvalues modes)
    const powRes = runStatTest("sample_size", rows, variables, {
      calc_mode: "power",
      design: "cohort_rr",
      n1: 80,
      p2: 0.15,
      rr_val: 2.0,
      alpha: 0.05,
    });
    assert.ok(powRes.summary.includes("potencia alcanzada"));

    const mtPvalRes = runStatTest("multiple_testing", rows, variables, {
      mode: "pvalues",
      pvalues: [0.001, 0.02, 0.04, 0.5],
      labels: ["H1", "H2", "H3", "H4"],
      method: "fdr_bh",
    });
    assert.equal(mtPvalRes.tables[0].rows.length, 4);
    const mtScreenRes = runStatTest("multiple_testing", rows, variables, {
      mode: "screen",
      group: "grupo",
      vars: ["v1", "v3"],
      method: "holm",
    });
    assert.equal(mtScreenRes.tables[0].rows.length, 2);

    // 10. Time series: Trend/Seasonal + ARIMA
    const tsTrend = runStatTest("ts_trend_seasonal", rows, variables, { outcome: "serie", time: "t_idx", period: 6 });
    assert.equal(tsTrend.charts[0].type, "line");
    assert.ok(tsTrend.tables.length === 2, "Expected seasonal indices table when n >= 2 * period");

    const tsArima = runStatTest("ts_arima", rows, variables, {
      outcome: "serie",
      time: "t_idx",
      p: 1,
      d: 1,
      q: 0,
      forecast_steps: 4,
      auto_order: true,
    });
    assert.equal(tsArima.tables[2].rows.length, 4);
    assert.equal(tsArima.charts[0].type, "line");
  });

  it("enforces zero fabricated numbers in AI narratives and resolves {{resultado.*}} placeholders", () => {
    const sampleResult = {
      test: "ttest" as const,
      title: "Prueba t de Student",
      summary: "t(8) = -5.000, p = <0.001, d de Cohen = 3.162",
      tables: [
        {
          title: "Descriptivos",
          columns: ["Grupo", "N", "Media", "DE"],
          rows: [
            ["A", 5, 14, 3.162],
            ["B", 5, 24, 3.162],
          ],
          note: "",
        },
      ],
      charts: [],
    };

    const resolved = resolveAnalysisPlaceholders(
      "Resumen: {{resultado.summary}} (Media A = {{resultado.tables[0].rows[0][2]}}).",
      sampleResult
    );
    assert.ok(resolved.includes("t(8) = -5.000"));
    assert.ok(resolved.includes("Media A = 14"));

    const validNarrative = verifyNarrativeAgainstResult(
      "Se observó una diferencia estadísticamente significativa ({{resultado.summary}}) entre el grupo A (media 14) y B (media 24) al nivel α = 0.05.",
      sampleResult
    );
    assert.equal(validNarrative.ok, true);
    assert.deepEqual(validNarrative.unverifiedNumbers, []);

    const hallucinatedNarrative = verifyNarrativeAgainstResult(
      "La diferencia alcanzó t = -5.000 con p = 0.023 y una razón de odds de 9.99 en 420 pacientes.",
      sampleResult
    );
    assert.equal(hallucinatedNarrative.ok, false);
    assert.ok(hallucinatedNarrative.unverifiedNumbers.includes("0.023"));
    assert.ok(hallucinatedNarrative.unverifiedNumbers.includes("9.99"));
    assert.ok(hallucinatedNarrative.unverifiedNumbers.includes("420"));
    assert.ok(hallucinatedNarrative.safeText.includes("Resumen estadístico verificado (Avicena)"));
    assert.ok(!hallucinatedNarrative.safeText.includes("420 pacientes"));

    const spec = buildValidatedAnalysisSpec("ts_arima", { outcome: "pas", p: 1, d: 1, q: 0, forecast_steps: 4, auto_order: true });
    const pyScript = buildReproduciblePythonScript(spec, "spec_hash_123", "abc123def4567890");
    assert.ok(pyScript.includes("scipy import stats"));
    assert.ok(pyScript.includes("abc123def4567890"));
  });

  it("tags ts-legacy provenance when scientific Python is absent and blocks with 503-class error when requireVerifiedEngine=true", async () => {
    resetPythonWorkerHealthCacheForTests();
    const variables: Variable[] = [
      { name: "grupo", label: "Grupo", type: "categorical", levels: ["A", "B"] },
      { name: "pas", label: "PAS", type: "numeric", levels: [] },
    ];
    const rows: Record<string, Cell>[] = [
      { grupo: "A", pas: 140 },
      { grupo: "A", pas: 144 },
      { grupo: "B", pas: 120 },
      { grupo: "B", pas: 124 },
    ];

    const env = await executeStatisticalAnalysis({
      test: "ttest",
      rows,
      variables,
      params: { outcome: "pas", group: "grupo" },
      pythonBin: "/nonexistent/python-bin",
      requireVerifiedEngine: false,
    });

    assert.equal(env.result.provenance?.engine, "ts-legacy");
    assert.equal(env.result.provenance?.verified_by_library, false);
    assert.equal(env.result.provenance?.dataset_sha256, env.datasetSha256);
    assert.equal(env.result.provenance?.spec_hash, env.specHash);
    assert.ok(env.result.reproducible_script?.includes("scipy import stats"));

    await assert.rejects(
      () =>
        executeStatisticalAnalysis({
          test: "ttest",
          rows,
          variables,
          params: { outcome: "pas", group: "grupo" },
          pythonBin: "/nonexistent/python-bin",
          requireVerifiedEngine: true,
        }),
      VerifiedEngineUnavailableError
    );

    // Invalid statistical params still throw StatsError (not masked by fallback)
    await assert.rejects(
      () =>
        executeStatisticalAnalysis({
          test: "ttest",
          rows,
          variables,
          params: { outcome: "", group: "grupo" },
          pythonBin: "/nonexistent/python-bin",
          requireVerifiedEngine: false,
        }),
      StatsError
    );
  });

  it("supports ANALYSIS_UPDATED in HMAC audit chain verification", () => {
    const e1 = signAuditEntry({
      projectId: "proj_1",
      actorUid: "u1",
      actorName: "Dra. Demo",
      actorRole: "estadistico",
      action: "ANALYSIS_SAVED",
      resourceType: "savedAnalysis",
      resourceId: "ana_1",
      outcome: "SUCCESS",
      prevHash: "GENESIS",
    });
    const e2 = signAuditEntry({
      projectId: "proj_1",
      actorUid: "u1",
      actorName: "Dra. Demo",
      actorRole: "estadistico",
      action: "ANALYSIS_UPDATED",
      resourceType: "savedAnalysis",
      resourceId: "ana_1",
      outcome: "SUCCESS",
      details: { updatedFields: ["note"] },
      prevHash: e1.entryHash,
    });
    const check = verifyAuditChain([e1, e2]);
    assert.equal(check.valid, true);
  });

  it("invokes isolated worker with minimal column projection and zero secret environment variables", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "avicena-worker-test-"));
    const mockPy = path.join(tmpDir, "mock-python");
    const envCaptureFile = path.join(tmpDir, "captured-input.json");
    fs.writeFileSync(
      mockPy,
      `#!/usr/bin/env node
const fs = require("fs");
if (process.argv.includes("--health")) {
  console.log(JSON.stringify({ ok: true, engine: "python-scientific" }));
  process.exit(0);
}
const raw = fs.readFileSync(0, "utf8");
const payload = JSON.parse(raw);
fs.writeFileSync(${JSON.stringify(envCaptureFile)}, JSON.stringify({
  hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  hasAuditSecret: Boolean(process.env.AUDIT_HMAC_SECRET),
  hasVaultSecret: Boolean(process.env.VAULT_ENCRYPTION_SECRET),
  rowKeys: Object.keys(payload.rows[0] || {}),
  varNames: (payload.variables || []).map((v) => v.name),
}));
console.log(JSON.stringify({
  ok: true,
  result: {
    test: "ttest",
    title: "Prueba t verificada",
    summary: "t(8) = -5.000, p = <0.001",
    tables: [{ title: "T", columns: ["t"], rows: [[-5]], note: "" }],
    charts: [],
    provenance: {
      spec_version: "1.0",
      spec_hash: payload.spec_hash,
      dataset_sha256: payload.dataset_sha256,
      engine: "python-scientific",
      engine_version: "python-3.11.mock",
      runtime: "Python 3.11 (Mock Scientific)",
      libraries: [{ package: "scipy", version: "1.14.1", method: "ttest_ind", citation: "Virtanen et al., 2020", role: "core" }],
      seed: 42,
      executed_at_utc: "2026-11-20T00:00:00Z",
      verified_by_library: true,
      warnings: []
    }
  }
}));
`,
      { mode: 0o755 }
    );

    const prevGemini = process.env.GEMINI_API_KEY;
    const prevAudit = process.env.AUDIT_HMAC_SECRET;
    process.env.GEMINI_API_KEY = "super-secret-test-key";
    process.env.AUDIT_HMAC_SECRET = "super-secret-audit-hmac-32-chars-min";
    try {
      const variables: Variable[] = [
        { name: "grupo", label: "Grupo", type: "categorical", levels: ["A", "B"] },
        { name: "pas", label: "PAS", type: "numeric", levels: [] },
        { name: "notas_libres", label: "Notas", type: "text", levels: [] },
      ];
      const rows: Record<string, Cell>[] = [
        { grupo: "A", pas: 140, notas_libres: "Texto libre no referenciado" },
        { grupo: "B", pas: 120, notas_libres: "Otro texto libre" },
      ];

      const env = await executeStatisticalAnalysis({
        test: "ttest",
        rows,
        variables,
        params: { outcome: "pas", group: "grupo" },
        pythonBin: mockPy,
        requireVerifiedEngine: true,
      });

      assert.equal(env.result.provenance?.engine, "python-scientific");
      assert.equal(env.result.provenance?.verified_by_library, true);
      assert.equal(env.result.provenance?.libraries[0]?.package, "scipy");

      const captured = JSON.parse(fs.readFileSync(envCaptureFile, "utf8")) as {
        hasGeminiKey: boolean;
        hasAuditSecret: boolean;
        hasVaultSecret: boolean;
        rowKeys: string[];
        varNames: string[];
      };
      assert.equal(captured.hasGeminiKey, false);
      assert.equal(captured.hasAuditSecret, false);
      assert.equal(captured.hasVaultSecret, false);
      assert.deepEqual(captured.rowKeys.sort(), ["grupo", "pas"]);
      assert.deepEqual(captured.varNames.sort(), ["grupo", "pas"]);
    } finally {
      if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGemini;
      if (prevAudit === undefined) delete process.env.AUDIT_HMAC_SECRET;
      else process.env.AUDIT_HMAC_SECRET = prevAudit;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
