import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
} from "@google/genai";
import { VALID_TEST_NAMES } from "../shared/analysisSpec.ts";
import type { AnalysisResult, Cell, ChatMessage, Dataset, TestName, Variable } from "../src/lib/types.ts";
import { redactSensitiveText } from "./logger.ts";
import { verifyNarrativeAgainstResult } from "./narrativeVerifier.ts";
import { isLikelyIdentifierVariable, scanDatasetMetadataForPii, scanForPii } from "./piiGuard.ts";
import { StatsError, TEST_DOCS } from "./statsEngine.ts";
import { executeStatisticalAnalysis } from "./statsWorkerClient.ts";

const PRIMARY_MODEL = "gemini-4-hydrogen";
const FALLBACK_MODEL = "gemini-3.1-flash-lite";

// If PRIMARY_MODEL hits 503/high-demand or times out, skip directly to FALLBACK_MODEL for 2 minutes
let preferFallbackUntil = 0;

const VALID_TESTS: TestName[] = VALID_TEST_NAMES;

const RUN_STAT_TEST_DECLARATION: FunctionDeclaration = {
  name: "run_statistical_test",
  description:
    "Ejecuta un análisis bioestadístico real sobre la base de datos activa de Avicena y devuelve las tablas, estadísticos, valores p e intervalos de confianza calculados.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      test: {
        type: Type.STRING,
        enum: VALID_TESTS,
        description:
          "Identificador exacto de la prueba estadística a ejecutar en Avicena (incluye outlier_detection, missing_analysis, rm_anova, incidence_prevalence, icc, negbin_reg, multiple_testing, ts_trend_seasonal, ts_arima, etc.).",
      },
      time: { type: Type.STRING, description: "Variable numérica o temporal de tiempo (kaplan_meier, cox_ph, incidence_prevalence, ts_trend_seasonal, ts_arima)." },
      event: { type: Type.STRING, description: "Variable binaria de evento 0/1 o Sí/No (kaplan_meier, cox_ph, incidence_prevalence)." },
      group: { type: Type.STRING, description: "Variable categórica de estratificación o agrupación (kaplan_meier, ttest, mannwhitney, anova, table1, incidence_prevalence)." },
      outcome: { type: Type.STRING, description: "Variable dependiente o desenlace (ttest, mannwhitney, anova, linreg, logreg, poisson_reg, negbin_reg, epidemiology_2x2, roc_auc, multiple_testing, ts_trend_seasonal, ts_arima)." },
      exposure: { type: Type.STRING, description: "Variable binaria de exposición (epidemiology_2x2)." },
      predictors: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Lista de variables predictoras o covariables (linreg, logreg, poisson_reg, negbin_reg, cox_ph, multiple_testing).",
      },
      vars: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Lista de variables (descriptives, table1, outlier_detection, missing_analysis, correlation, rm_anova, friedman, icc).",
      },
      var: { type: Type.STRING, description: "Variable categórica única (frequencies)." },
      var1: { type: Type.STRING, description: "Primera variable pareada o evaluador 1 (paired_ttest, mcnemar, kappa_agreement)." },
      var2: { type: Type.STRING, description: "Segunda variable pareada o evaluador 2 (paired_ttest, mcnemar, kappa_agreement)." },
      row: { type: Type.STRING, description: "Variable categórica de filas (chi2)." },
      col: { type: Type.STRING, description: "Variable categórica de columnas (chi2)." },
      marker: { type: Type.STRING, description: "Marcador numérico continuo para curva ROC (roc_auc)." },
      test_var: { type: Type.STRING, description: "Variable binaria de prueba índice (diagnostic_test)." },
      gold_standard: { type: Type.STRING, description: "Variable binaria de referencia o gold standard (diagnostic_test)." },
      method: { type: Type.STRING, description: "Método estadístico (pearson|spearman|kendall para correlation; fdr_bh|holm|bonferroni para multiple_testing)." },
      z_threshold: { type: Type.NUMBER, description: "Umbral |z| modificado para outlier_detection (por defecto 3.0)." },
      icc_type: { type: Type.STRING, enum: ["ICC2_1", "ICC3_1", "ICC2_k"], description: "Tipo de ICC para icc." },
      calc_mode: { type: Type.STRING, enum: ["sample_size", "power"], description: "Modo de cálculo en sample_size." },
      design: {
        type: Type.STRING,
        enum: ["two_proportions", "two_means", "correlation", "cohort_rr"],
        description: "Diseño para sample_size.",
      },
      alpha: { type: Type.NUMBER, description: "Nivel alfa para sample_size (por defecto 0.05)." },
      power: { type: Type.NUMBER, description: "Potencia 1-beta para sample_size (por defecto 0.8)." },
      ratio: { type: Type.NUMBER, description: "Razón n2/n1 para sample_size." },
      n1: { type: Type.NUMBER, description: "Tamaño muestral n1 conocido en modo calc_mode='power'." },
      p1: { type: Type.NUMBER, description: "Proporción grupo 1 o incidencia no expuestos para sample_size." },
      p2: { type: Type.NUMBER, description: "Proporción grupo 2 para sample_size." },
      rr_val: { type: Type.NUMBER, description: "Riesgo relativo esperado para sample_size (design='cohort_rr')." },
      diff: { type: Type.NUMBER, description: "Diferencia mínima esperada entre medias para sample_size." },
      sd_val: { type: Type.NUMBER, description: "Desviación estándar esperada para sample_size." },
      r_val: { type: Type.NUMBER, description: "Correlación esperada r para sample_size." },
      mode: { type: Type.STRING, enum: ["screen", "pvalues"], description: "Modo para multiple_testing." },
      pvalues: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "Lista de p-valores para multiple_testing mode='pvalues'." },
      labels: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Etiquetas opcionales para pvalues." },
      period: { type: Type.NUMBER, description: "Periodo estacional (entero ≥ 2) para ts_trend_seasonal." },
      p: { type: Type.NUMBER, description: "Orden AR para ts_arima." },
      d: { type: Type.NUMBER, description: "Orden de diferenciación para ts_arima." },
      q: { type: Type.NUMBER, description: "Orden MA para ts_arima." },
      forecast_steps: { type: Type.NUMBER, description: "Horizonte de pronóstico para ts_arima." },
      auto_order: { type: Type.BOOLEAN, description: "Selección automática (AIC/BIC) en ts_arima." },
    },
    required: ["test"],
  },
};

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error("GEMINI_API_KEY_MISSING");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("503") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("high demand") ||
    msg.includes("429") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("MODEL_TIMEOUT")
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MODEL_TIMEOUT:${label}`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function runWithFallback<T>(
  fn: (model: string) => Promise<T>,
  onFallback?: (msg: string) => void,
  primaryTimeoutMs = 10000
): Promise<{ result: T; usedModel: string }> {
  const useFallbackFirst = Date.now() < preferFallbackUntil;
  const order = useFallbackFirst ? [FALLBACK_MODEL] : [PRIMARY_MODEL, FALLBACK_MODEL];

  let lastErr: unknown = null;
  for (let i = 0; i < order.length; i++) {
    const model = order[i];
    try {
      const exec = fn(model);
      const result =
        model === PRIMARY_MODEL && i < order.length - 1
          ? await withTimeout(exec, primaryTimeoutMs, model)
          : await exec;
      return { result, usedModel: model };
    } catch (err) {
      lastErr = err;
      if (model === PRIMARY_MODEL && isTransientError(err) && i < order.length - 1) {
        preferFallbackUntil = Date.now() + 120_000;
        onFallback?.("Modelo principal con alta demanda; usando modelo rápido alternativo…");
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function safeVariableForPrompt(v: Variable): boolean {
  return !isLikelyIdentifierVariable(v.name, v.label);
}

function buildSchemaDescription(ds: Dataset): string {
  return ds.variables
    .filter(safeVariableForPrompt)
    .map((v) => {
      const allowLevels =
        (v.type === "categorical" || v.type === "binary" || v.type === "ordinal") &&
        !isLikelyIdentifierVariable(v.name, v.label);
      const levels = allowLevels && v.levels?.length ? ` niveles=${JSON.stringify(v.levels.slice(0, 12))}` : "";
      const label = v.label ? ` «${v.label}»` : "";
      return `- ${v.name} (${v.type})${label}${levels}`;
    })
    .join("\n");
}

function formatHistory(msgs: ChatMessage[]): string {
  return msgs
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 800)}`)
    .join("\n");
}

function normalizeStr(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveVarName(raw: unknown, variables: Variable[]): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  const exact = variables.find((v) => v.name === trimmed);
  if (exact) return exact.name;
  const lower = trimmed.toLowerCase();
  const ci = variables.find((v) => v.name.toLowerCase() === lower || v.label.toLowerCase() === lower);
  if (ci) return ci.name;
  const norm = normalizeStr(trimmed);
  const fuzzy = variables.find((v) => normalizeStr(v.name) === norm || normalizeStr(v.label) === norm);
  return fuzzy ? fuzzy.name : trimmed;
}

function resolveVarArray(raw: unknown, variables: Variable[]): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item) => resolveVarName(item, variables)).filter((x): x is string => Boolean(x));
}

function normalizeArgsForDataset(args: Record<string, unknown>, variables: Variable[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  const singleKeys = [
    "time",
    "event",
    "group",
    "outcome",
    "exposure",
    "var",
    "var1",
    "var2",
    "row",
    "col",
    "marker",
    "test_var",
    "gold_standard",
  ];
  for (const k of singleKeys) {
    if (k in out && out[k] !== undefined && out[k] !== null && out[k] !== "") {
      out[k] = resolveVarName(out[k], variables);
    }
  }
  if (Array.isArray(out.predictors)) {
    out.predictors = resolveVarArray(out.predictors, variables);
  }
  if (Array.isArray(out.vars)) {
    out.vars = resolveVarArray(out.vars, variables);
  }
  return out;
}

function normalizeTestName(raw: unknown): TestName | null {
  if (typeof raw !== "string") return null;
  const norm = normalizeStr(raw);
  if (VALID_TESTS.includes(norm as TestName)) return norm as TestName;
  const aliases: Record<string, TestName> = {
    kaplanmeier: "kaplan_meier",
    logrank: "kaplan_meier",
    log_rank: "kaplan_meier",
    supervivencia: "kaplan_meier",
    cox: "cox_ph",
    coxph: "cox_ph",
    t_test: "ttest",
    student: "ttest",
    mann_whitney: "mannwhitney",
    wilcoxon: "mannwhitney",
    kruskal: "anova",
    kruskal_wallis: "anova",
    chi_cuadrado: "chi2",
    chi_square: "chi2",
    fisher: "chi2",
    tabla1: "table1",
    tabla_1: "table1",
    roc: "roc_auc",
    auc: "roc_auc",
    kappa: "kappa_agreement",
    regresion_logistica: "logreg",
    regresion_lineal: "linreg",
    poisson: "poisson_reg",
    binomial_negativa: "negbin_reg",
    negbin: "negbin_reg",
    outliers: "outlier_detection",
    atipicos: "outlier_detection",
    perdidos: "missing_analysis",
    missing: "missing_analysis",
    anova_medidas_repetidas: "rm_anova",
    medidas_repetidas: "rm_anova",
    incidencia: "incidence_prevalence",
    prevalencia: "incidence_prevalence",
    intraclase: "icc",
    fdr: "multiple_testing",
    benjamini_hochberg: "multiple_testing",
    arima: "ts_arima",
    series_temporales: "ts_trend_seasonal",
    tendencia_estacional: "ts_trend_seasonal",
  };
  return aliases[norm] ?? null;
}

function wantsDataAnalysis(userMessage: string, ds: Dataset): boolean {
  const normMsg = userMessage
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (!normMsg) return false;
  if (/^(hola|buenos dias|buenas tardes|buenas noches|gracias|ok|vale|perfecto)[!.]*$/i.test(normMsg)) {
    return false;
  }

  // Check if user asks purely about software concepts ("qué es un valor p", "qué es kaplan meier") without asking to run or mentioning variables/study
  const pureConcept = /^(que es|como funciona|explica(me)? la diferencia entre|cuando se usa)\b/.test(normMsg);
  const mentionsVar = ds.variables.some(
    (v) => normMsg.includes(v.name.toLowerCase()) || (v.label && normMsg.includes(v.label.toLowerCase()))
  );
  if (pureConcept && !mentionsVar) {
    return false;
  }

  return true;
}

const COPILOT_SYSTEM = `Eres el Copiloto Bioestadístico de Avicena. Trabajas DIRECTAMENTE sobre la base de datos activa del investigador.

REGLAS CRÍTICAS:
1. Tienes la herramienta \`run_statistical_test\` conectada al motor estadístico real de Avicena.
2. SIEMPRE que el usuario pida un análisis, comparación, supervivencia (Kaplan-Meier / Log-Rank / Cox), mortalidad, Tabla 1, regresión, correlación, ROC, diagnóstico, OR/RR, frecuencias, descriptivos o tamaño muestral, DEBES llamar primero a \`run_statistical_test\` usando los nombres de variable EXACTOS del esquema proporcionado.
3. RIGOR PARAMÉTRICO vs. NO PARAMÉTRICO Y VARIABLES ORDINALES:
   - NUNCA apliques pruebas paramétricas puras (\`ttest\`, correlación \`pearson\`) por defecto sobre variables **ordinales** (escalas clínicas, EVA/VAS, NYHA, ECOG, Likert, estadios, gravedad) ni cuando los datos incumplan normalidad (Shapiro-Wilk p < 0.05) o tengan muestras pequeñas asimétricas.
   - Para comparar 2 grupos en variables **ordinales** o no normales usa \`mannwhitney\`; para ≥3 grupos usa \`anova\` (y reporta prioritariamente Kruskal-Wallis H y medianas/RIC cuando haya ordinalidad o Shapiro-Wilk p < 0.05); para medidas repetidas usa \`paired_ttest\` (priorizando Wilcoxon) o \`friedman\`; para correlación con variables ordinales o no normales usa \`correlation\` con \`"method": "spearman"\`.
   - Si una ejecución devuelve alertas \`⚠\` de normalidad/ordinalidad, prioriza la alternativa no paramétrica correspondiente y explícalo claramente al investigador.
4. NUNCA respondas "no has adjuntado los cálculos", NUNCA pidas al usuario que pegue resultados ni le sugieras usar software estadístico externo: Avicena ejecuta los cálculos directamente mediante \`run_statistical_test\`.
5. Si la herramienta devuelve un error por nombre de variable o parámetro, corrígelo y vuelve a llamar a \`run_statistical_test\`.
6. Una vez recibidos los resultados reales de \`run_statistical_test\`, interpreta los hallazgos en español claro y riguroso:
   - Reporta únicamente las cifras exactas devueltas por la herramienta (o marcadores \`{{resultado.summary}}\`, \`{{resultado.tables[0].rows[0][0]}}\`). NUNCA calcules, redondees por tu cuenta ni inventes números que no aparezcan literalmente en los resultados calculados; un verificador automático bloqueará cualquier cifra no presente en la salida del motor.
   - Comenta supuestos estadísticos (normalidad Shapiro-Wilk, escala ordinal vs continua, N, eventos, confusión, riesgos proporcionales o sobredispersión cuando aplique).
   - Sugiere el siguiente paso analítico que se puede ejecutar directamente en Avicena.
   - Usa markdown limpio (###, viñetas, **negritas**) sin signos $ de LaTeX (escribe p < 0.001, χ², η², IC 95% directamente).

Guía de pruebas disponibles en \`run_statistical_test\`:
${TEST_DOCS}`;

export interface StreamCallbacks {
  onStatus: (text: string) => void;
  onAnalysis: (result: AnalysisResult) => void;
  onDelta: (text: string) => void;
  onError: (text: string) => void;
}

export async function runGeminiCopilot(
  dataset: Dataset,
  rows: Record<string, Cell>[],
  pastMessages: ChatMessage[],
  userMessage: string,
  cb: StreamCallbacks
): Promise<{ content: string; analysis: AnalysisResult | null }> {
  const userScan = scanForPii(userMessage);
  if (userScan.hasPii) {
    const blockedMsg = `Consulta bloqueada por protección de datos (RGPD): se detectaron posibles identificadores personales (${userScan.labels.join(", ")}). Elimina cualquier dato identificativo antes de consultar al Asistente IA externo.`;
    cb.onError(blockedMsg);
    return {
      content: blockedMsg,
      analysis: null,
    };
  }

  const metaScan = scanDatasetMetadataForPii(dataset);
  if (metaScan.hasPii) {
    const blockedMsg = `Consulta bloqueada por protección de datos (RGPD): se detectaron posibles identificadores personales en los metadatos del estudio o variables (${metaScan.labels.join(", ")}). Desidentifica nombres de estudio, etiquetas o niveles categóricos antes de usar el Asistente IA externo.`;
    cb.onError(blockedMsg);
    return {
      content: blockedMsg,
      analysis: null,
    };
  }

  let ai: GoogleGenAI;
  try {
    ai = getAiClient();
  } catch {
    cb.onError(
      "No se encontró la clave de Gemini en el entorno. Verifica `GEMINI_API_KEY` en el panel Settings > Secrets para habilitar el Asistente IA."
    );
    return {
      content:
        "No se pudo conectar con el servicio de IA porque falta configurar `GEMINI_API_KEY` en Settings > Secrets.",
      analysis: null,
    };
  }

  const historyScan = scanForPii(pastMessages.map((m) => m.content).join("\n"));
  const safePastMessages = historyScan.hasPii ? [] : pastMessages;

  const contextText = `Base de datos activa: «${dataset.name}» (N=${rows.length} registros).\nVariables clínicas disponibles:\n${buildSchemaDescription(dataset)}\n\nConversación previa:\n${formatHistory(safePastMessages) || "(ninguna)"}\n\nSolicitud del investigador: ${userMessage}`;

  let primaryAnalysis: AnalysisResult | null = null;
  const forceAnalysis = wantsDataAnalysis(userMessage, dataset);
  const contents: Content[] = [{ role: "user", parts: [{ text: contextText }] }];

  try {
    cb.onStatus(forceAnalysis ? "Seleccionando la prueba estadística adecuada…" : "Analizando la consulta…");

    let needsStreamingInterpretation = false;
    let directTextAnswer = "";

    for (let turn = 0; turn < 3; turn++) {
      const mode =
        turn === 0 && forceAnalysis
          ? FunctionCallingConfigMode.ANY
          : turn > 0 && !primaryAnalysis && forceAnalysis
            ? FunctionCallingConfigMode.ANY
            : FunctionCallingConfigMode.AUTO;

      const { result: stepResp } = await runWithFallback(
        (model) =>
          ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: COPILOT_SYSTEM,
              tools: [{ functionDeclarations: [RUN_STAT_TEST_DECLARATION] }],
              toolConfig: {
                functionCallingConfig: {
                  mode,
                  ...(mode === FunctionCallingConfigMode.ANY ? { allowedFunctionNames: ["run_statistical_test"] } : {}),
                },
              },
              ...(model === PRIMARY_MODEL ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
            },
          }),
        (notice) => cb.onStatus(notice),
        15000
      );

      const calls = stepResp.functionCalls;
      const modelContent = stepResp.candidates?.[0]?.content;

      if (!calls || !calls.length) {
        directTextAnswer = (stepResp.text ?? "").trim();
        break;
      }

      if (modelContent) {
        contents.push(modelContent);
      }

      const fnResponseParts: Part[] = [];
      let anyErrorInRound = false;

      for (const call of calls) {
        const rawArgs = (call.args ?? {}) as Record<string, unknown>;
        const testName = normalizeTestName(rawArgs.test);

        if (!testName) {
          anyErrorInRound = true;
          fnResponseParts.push({
            functionResponse: {
              id: call.id,
              name: call.name ?? "run_statistical_test",
              response: {
                ok: false,
                error: `Prueba no reconocida: ${String(rawArgs.test)}. Elige exactamente una de: ${VALID_TESTS.join(", ")}`,
              },
            },
          });
          continue;
        }

        const cleanParams = normalizeArgsForDataset(rawArgs, dataset.variables);
        cb.onStatus(`Ejecutando ${testName} sobre ${rows.length} registros…`);

        try {
          const envelope = await executeStatisticalAnalysis({
            test: testName,
            rows,
            variables: dataset.variables,
            params: cleanParams,
          });
          const computed = envelope.result;
          primaryAnalysis = computed;
          cb.onAnalysis(computed);
          fnResponseParts.push({
            functionResponse: {
              id: call.id,
              name: call.name ?? "run_statistical_test",
              response: {
                ok: true,
                resultado: {
                  prueba: computed.test,
                  titulo: computed.title,
                  resumen: computed.summary,
                  tablas: computed.tables,
                },
              },
            },
          });
        } catch (err) {
          anyErrorInRound = true;
          const errDetail = err instanceof StatsError ? err.message : "No se pudo ejecutar la prueba con esos parámetros.";
          fnResponseParts.push({
            functionResponse: {
              id: call.id,
              name: call.name ?? "run_statistical_test",
              response: {
                ok: false,
                error: errDetail,
                variablesDisponibles: dataset.variables.filter(safeVariableForPrompt).map((v) => ({
                  name: v.name,
                  type: v.type,
                  levels:
                    v.type === "categorical" || v.type === "binary" || v.type === "ordinal"
                      ? v.levels?.slice(0, 8)
                      : undefined,
                })),
              },
            },
          });
        }
      }

      contents.push({ role: "user", parts: fnResponseParts });

      if (!anyErrorInRound || (primaryAnalysis && turn >= 1)) {
        needsStreamingInterpretation = true;
        break;
      }
      needsStreamingInterpretation = true;
    }

    if (!needsStreamingInterpretation && directTextAnswer) {
      cb.onDelta(directTextAnswer);
      return {
        content: directTextAnswer,
        analysis: primaryAnalysis,
      };
    }

    cb.onStatus("Redactando y verificando interpretación clínica…");

    const collectInterpretation = async (promptContents: Content[], useTools: boolean) => {
      const { result } = await runWithFallback(
        async (model) => {
          const resp = await ai.models.generateContent({
            model,
            contents: promptContents,
            config: {
              systemInstruction: COPILOT_SYSTEM,
              ...(useTools
                ? {
                    tools: [{ functionDeclarations: [RUN_STAT_TEST_DECLARATION] }],
                    toolConfig: {
                      functionCallingConfig: {
                        mode: FunctionCallingConfigMode.NONE,
                      },
                    },
                  }
                : {}),
            },
          });
          return (resp.text ?? "").trim();
        },
        (notice) => cb.onStatus(notice),
        15000
      );
      return result;
    };

    let fullText = "";
    try {
      fullText = await collectInterpretation(contents, true);
    } catch (streamErr) {
      if (!primaryAnalysis) throw streamErr;
      const summaryPrompt = `${contextText}\n\nResultados reales ya ejecutados por Avicena (${primaryAnalysis.title}):\n${JSON.stringify(
        {
          prueba: primaryAnalysis.test,
          titulo: primaryAnalysis.title,
          resumen: primaryAnalysis.summary,
          tablas: primaryAnalysis.tables,
        }
      ).slice(0, 14000)}`;
      fullText = await collectInterpretation([{ role: "user", parts: [{ text: summaryPrompt }] }], false);
    }

    let finalText = fullText.trim() || (primaryAnalysis ? primaryAnalysis.summary : "(sin respuesta)");
    if (primaryAnalysis) {
      let check = verifyNarrativeAgainstResult(finalText, primaryAnalysis);
      if (!check.ok && check.unverifiedNumbers.length > 0 && fullText.trim()) {
        cb.onStatus("Verificando rigor numérico de la interpretación…");
        try {
          const retryPrompt: Content[] = [
            ...contents,
            { role: "model", parts: [{ text: fullText }] },
            {
              role: "user",
              parts: [
                {
                  text: `Tu respuesta incluyó cifras (${check.unverifiedNumbers.join(", ")}) que NO aparecen literalmente en los resultados calculados por Avicena. Reescribe la interpretación clínica citando ÚNICAMENTE los números exactos presentes en \`resumen\` y \`tablas\` de la herramienta (sin calcular ni estimar cifras nuevas).`,
                },
              ],
            },
          ];
          const corrected = await collectInterpretation(retryPrompt, true);
          if (corrected) {
            check = verifyNarrativeAgainstResult(corrected, primaryAnalysis);
          }
        } catch {
          // Keep safe verified fallback from initial check
        }
      }
      finalText = check.safeText;
    }

    if (finalText) {
      cb.onDelta(finalText);
    }

    return {
      content: finalText,
      analysis: primaryAnalysis,
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const msg = redactSensitiveText(rawMsg);
    let friendly = `Error al consultar el servicio de IA: ${msg.slice(0, 180)}`;
    if (msg.includes("403") || msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID")) {
      friendly = "La clave de API de Gemini no es válida o no tiene permisos. Revisa **Settings > Secrets**.";
    } else if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      friendly = "Se alcanzó el límite temporal de cuota de Gemini. Intenta nuevamente en unos segundos.";
    } else if (
      msg.includes("503") ||
      msg.includes("UNAVAILABLE") ||
      msg.includes("high demand") ||
      msg.includes("MODEL_TIMEOUT")
    ) {
      friendly =
        "El servicio de Gemini está experimentando un pico temporal de demanda (503). Vuelve a enviar tu consulta en unos segundos.";
    }
    cb.onError(friendly);
    return {
      content: friendly,
      analysis: primaryAnalysis,
    };
  }
}
