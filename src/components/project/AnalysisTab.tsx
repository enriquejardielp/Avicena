import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Calculator,
  ClipboardList,
  GitCompare,
  Pin,
  PinOff,
  Play,
  Search,
  Stethoscope,
  TrendingUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiPost, errMsg } from "../../lib/api.ts";
import { useAuth } from "../../lib/AuthContext.tsx";
import {
  getDatasetWithRows,
  saveAnalysisToProject,
  updateSavedAnalysisMeta,
} from "../../lib/firestoreDb.ts";
import type { AnalysisResult, Dataset, SavedAnalysis, TestName } from "../../lib/types.ts";
import { cn } from "../../lib/utils.ts";
import { ResultView } from "../analysis/ResultView.tsx";

type CategoryId =
  | "descriptiva"
  | "grupos"
  | "tablas_riesgo"
  | "diagnostico"
  | "modelos"
  | "supervivencia";

interface CategoryMeta {
  id: CategoryId;
  label: string;
  shortLabel: string;
  icon: typeof ClipboardList;
}

interface TestMeta {
  id: TestName;
  label: string;
  category: CategoryId;
  desc: string;
  whenToUse: string;
  keywords: string;
}

const CATEGORIES: CategoryMeta[] = [
  { id: "descriptiva", label: "Descriptiva y Tabla 1", shortLabel: "Descriptiva", icon: ClipboardList },
  { id: "grupos", label: "Comparación de grupos", shortLabel: "Grupos", icon: GitCompare },
  { id: "tablas_riesgo", label: "Tablas, Riesgo y Acuerdo", shortLabel: "Riesgo / 2×2", icon: Activity },
  { id: "diagnostico", label: "Diagnóstico y Curvas ROC", shortLabel: "Diagnóstico", icon: Stethoscope },
  { id: "modelos", label: "Correlación y Regresiones", shortLabel: "Regresiones", icon: TrendingUp },
  { id: "supervivencia", label: "Supervivencia y Muestra", shortLabel: "Superv. / N", icon: Calculator },
];

const TESTS: TestMeta[] = [
  // 1. Descriptiva y Tabla 1
  {
    id: "table1",
    label: "Tabla 1 clínica",
    category: "descriptiva",
    desc: "Características basales estratificadas con valores p",
    whenToUse: "Primera tabla de artículos biomédicos (cohorte o ensayo clínico).",
    keywords: "tabla 1 basal publicacion estratificada cohorte",
  },
  {
    id: "descriptives",
    label: "Estadísticos descriptivos",
    category: "descriptiva",
    desc: "Media, DE, mediana, RIC, asimetría y Shapiro-Wilk",
    whenToUse: "Resumir variables continuas y verificar normalidad antes de elegir pruebas.",
    keywords: "media mediana desviacion normalidad shapiro wilk histograma",
  },
  {
    id: "frequencies",
    label: "Frecuencias y proporciones",
    category: "descriptiva",
    desc: "Conteos, porcentajes válidos y gráfico de barras",
    whenToUse: "Describir variables cualitativas, diagnósticos o categorías clínicas.",
    keywords: "porcentaje conteo categorica moda barras",
  },

  // 2. Comparación de grupos
  {
    id: "ttest",
    label: "t de Student / Welch",
    category: "grupos",
    desc: "2 grupos independientes, Levene y d de Cohen",
    whenToUse: "Comparar una variable continua normal entre 2 grupos independientes.",
    keywords: "t student welch levene cohen 2 grupos medias",
  },
  {
    id: "mannwhitney",
    label: "U de Mann-Whitney",
    category: "grupos",
    desc: "Contraste no paramétrico de 2 grupos (rango medio y r)",
    whenToUse: "Alternativa no paramétrica a la t de Student cuando no hay normalidad.",
    keywords: "mann whitney wilcoxon no parametrica mediana 2 grupos",
  },
  {
    id: "paired_ttest",
    label: "t pareada / Wilcoxon",
    category: "grupos",
    desc: "Medidas repetidas antes/después en los mismos pacientes",
    whenToUse: "Comparar basal vs seguimiento (2 momentos) en el mismo individuo.",
    keywords: "pareada wilcoxon antes despues basal seguimiento repetidas",
  },
  {
    id: "anova",
    label: "ANOVA / Kruskal-Wallis",
    category: "grupos",
    desc: "≥2 grupos independientes con Tukey HSD y η²",
    whenToUse: "Comparar una variable numérica entre 3 o más grupos clínicos.",
    keywords: "anova kruskal wallis tukey eta posthoc multiples grupos",
  },
  {
    id: "friedman",
    label: "ANOVA de Friedman",
    category: "grupos",
    desc: "≥3 medidas repetidas no paramétricas y W de Kendall",
    whenToUse: "Comparar 3 o más momentos longitudinales en los mismos pacientes.",
    keywords: "friedman kendall medidas repetidas longitudinal 3 momentos",
  },

  // 3. Tablas, Riesgo y Concordancia
  {
    id: "chi2",
    label: "χ² de Pearson / Fisher",
    category: "tablas_riesgo",
    desc: "Tablas cruzadas, Cramér's V y exacto de Fisher 2×2",
    whenToUse: "Evaluar independencia entre dos variables categóricas de cualquier tamaño.",
    keywords: "chi cuadrado fisher cramer contingencia categoricas",
  },
  {
    id: "epidemiology_2x2",
    label: "Riesgo epidemiológico 2×2",
    category: "tablas_riesgo",
    desc: "RR, OR, RAR/RAE, NNT/NNH y fracción etiológica",
    whenToUse: "Cuantificar impacto clínico de una exposición o tratamiento binario.",
    keywords: "riesgo relativo rr odds ratio or nnt nnh rar epidemiologia 2x2",
  },
  {
    id: "mcnemar",
    label: "Prueba de McNemar",
    category: "tablas_riesgo",
    desc: "Cambio pareado en variable binaria (antes vs después)",
    whenToUse: "Comparar proporciones dicotómicas emparejadas en los mismos sujetos.",
    keywords: "mcnemar binaria pareada concordancia cambio antes despues",
  },
  {
    id: "kappa_agreement",
    label: "Concordancia (κ de Cohen)",
    category: "tablas_riesgo",
    desc: "Acuerdo interobservador o entre 2 métodos (Landis & Koch)",
    whenToUse: "Medir reproducibilidad diagnóstica entre dos evaluadores o pruebas.",
    keywords: "kappa cohen concordancia interobservador landis koch acuerdo",
  },

  // 4. Diagnóstico y Curvas ROC
  {
    id: "diagnostic_test",
    label: "Prueba diagnóstica 2×2",
    category: "diagnostico",
    desc: "Sensibilidad, Especificidad, VPP, VPN, LR+ / LR− e IC Wilson",
    whenToUse: "Validar un test binario frente al estándar de oro (gold standard).",
    keywords: "sensibilidad especificidad vpp vpn lr youden gold standard diagnostico",
  },
  {
    id: "roc_auc",
    label: "Curva ROC y AUC",
    category: "diagnostico",
    desc: "Área bajo la curva (Hanley-McNeil) y punto de corte óptimo",
    whenToUse: "Evaluar discriminación de un biomarcador continuo y hallar corte óptimo.",
    keywords: "roc auc curva biomarcador punto corte youden discriminacion",
  },

  // 5. Correlación y Regresiones
  {
    id: "correlation",
    label: "Correlación (r / ρ)",
    category: "modelos",
    desc: "Matriz de Pearson o Spearman con IC 95% y dispersión",
    whenToUse: "Medir fuerza y dirección de asociación entre variables continuas.",
    keywords: "correlacion pearson spearman dispersion matriz r rho",
  },
  {
    id: "linreg",
    label: "Regresión lineal múltiple",
    category: "modelos",
    desc: "Modelado OLS multivariable con R², FIV (colinealidad) e IC 95%",
    whenToUse: "Predecir un desenlace numérico ajustando por confusores.",
    keywords: "regresion lineal ols multivariable vif fiv r2 predictores",
  },
  {
    id: "logreg",
    label: "Regresión logística",
    category: "modelos",
    desc: "Odds Ratios ajustados (IC 95%), pseudo-R² y AUC del modelo",
    whenToUse: "Identificar factores independientes asociados a un evento binario (0/1).",
    keywords: "regresion logistica odds ratio ajustado binario auc c-statistic",
  },
  {
    id: "poisson_reg",
    label: "Regresión de Poisson (IRR)",
    category: "modelos",
    desc: "Razones de Tasas de Incidencia (IRR) para conteos clínicos",
    whenToUse: "Modelar número de ingresos, días de estancia o eventos de conteo.",
    keywords: "poisson irr tasa incidencia conteo dias estancia eventos",
  },

  // 6. Supervivencia y Tamaño Muestral
  {
    id: "kaplan_meier",
    label: "Kaplan-Meier y Log-Rank",
    category: "supervivencia",
    desc: "Curvas escalonadas de supervivencia, medianas y χ² Log-Rank",
    whenToUse: "Analizar tiempo hasta el evento comparando brazos con censura.",
    keywords: "kaplan meier log rank supervivencia censura tiempo evento",
  },
  {
    id: "cox_ph",
    label: "Regresión de Cox (HR)",
    category: "supervivencia",
    desc: "Hazard Ratios ajustados (IC 95%) y C-index de Harrell",
    whenToUse: "Modelar tiempo hasta evento ajustando por múltiples covariables clínicas.",
    keywords: "cox hazard ratio hr riesgos proporcionales c-index supervivencia multivariable",
  },
  {
    id: "sample_size",
    label: "Tamaño muestral y potencia",
    category: "supervivencia",
    desc: "Cálculo de N para 2 proporciones, 2 medias o correlación (+15%)",
    whenToUse: "Planificar protocolo clínico con α y potencia estadística (1 − β).",
    keywords: "tamano muestral potencia n protocolo ensayo clinico alfa beta",
  },
];

interface AnalysisTabProps {
  projectId: string;
  datasets: Dataset[];
  activeDatasetId: string;
  onSelectDataset: (id: string) => void;
  onAskCopilot: (prompt: string) => void;
  onAnalysisSaved?: (saved: SavedAnalysis) => void;
  onAnalysisUpdated?: (updated: SavedAnalysis) => void;
}

export function AnalysisTab({
  projectId,
  datasets,
  activeDatasetId,
  onSelectDataset,
  onAskCopilot,
  onAnalysisSaved,
  onAnalysisUpdated,
}: AnalysisTabProps) {
  const { user } = useAuth();
  const ds = datasets.find((d) => d.id === activeDatasetId) ?? null;

  const numVars = useMemo(() => (ds ? ds.variables.filter((v) => v.type === "numeric") : []), [ds]);
  const catVars = useMemo(
    () => (ds ? ds.variables.filter((v) => v.type === "categorical" || v.type === "binary") : []),
    [ds]
  );
  const binVars = useMemo(() => (ds ? ds.variables.filter((v) => v.type === "binary") : []), [ds]);
  const twoLevelVars = useMemo(
    () =>
      ds
        ? ds.variables.filter(
            (v) => (v.type === "binary" || v.type === "categorical") && v.levels.length === 2
          )
        : [],
    [ds]
  );
  const allAnalysisVars = useMemo(
    () => (ds ? ds.variables.filter((v) => v.type !== "text" && v.type !== "date") : []),
    [ds]
  );

  const [activeCategory, setActiveCategory] = useState<CategoryId>("descriptiva");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTest, setSelectedTest] = useState<TestName>("table1");

  const [outcome, setOutcome] = useState("");
  const [groupVar, setGroupVar] = useState("");
  const [secondVar, setSecondVar] = useState("");
  const [multiVars, setMultiVars] = useState<string[]>([]);
  const [corrMethod, setCorrMethod] = useState<"pearson" | "spearman">("pearson");

  // Sample size calculator parameters
  const [ssDesign, setSsDesign] = useState<"two_proportions" | "two_means" | "correlation">("two_proportions");
  const [ssAlpha, setSsAlpha] = useState(0.05);
  const [ssPower, setSsPower] = useState(0.8);
  const [ssRatio, setSsRatio] = useState(1);
  const [ssP1, setSsP1] = useState(0.35);
  const [ssP2, setSsP2] = useState(0.18);
  const [ssDiff, setSsDiff] = useState(10);
  const [ssSd, setSsSd] = useState(15);
  const [ssR, setSsR] = useState(0.35);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [savedRecord, setSavedRecord] = useState<SavedAnalysis | null>(null);

  useEffect(() => {
    setResult(null);
    setSavedRecord(null);
  }, [activeDatasetId]);

  // Smart defaults whenever dataset or selectedTest changes
  useEffect(() => {
    if (!ds) return;
    if (selectedTest === "table1") {
      setGroupVar(twoLevelVars[0]?.name || catVars[0]?.name || "");
      setMultiVars(allAnalysisVars.slice(0, 6).map((v) => v.name));
    } else if (selectedTest === "descriptives") {
      setMultiVars(numVars.slice(0, 4).map((v) => v.name));
    } else if (selectedTest === "frequencies") {
      setOutcome(catVars[0]?.name || allAnalysisVars[0]?.name || "");
    } else if (selectedTest === "ttest" || selectedTest === "mannwhitney") {
      setOutcome(numVars[0]?.name || "");
      setGroupVar(twoLevelVars[0]?.name || "");
    } else if (selectedTest === "paired_ttest") {
      setOutcome(numVars[0]?.name || "");
      setSecondVar(numVars[1]?.name || numVars[0]?.name || "");
    } else if (selectedTest === "anova") {
      setOutcome(numVars[0]?.name || "");
      setGroupVar(catVars.find((v) => v.levels.length >= 2)?.name || catVars[0]?.name || "");
    } else if (selectedTest === "friedman") {
      setMultiVars(numVars.slice(0, Math.min(4, numVars.length)).map((v) => v.name));
    } else if (selectedTest === "chi2") {
      setOutcome(catVars[0]?.name || "");
      setGroupVar(catVars[1]?.name || catVars[0]?.name || "");
    } else if (selectedTest === "mcnemar" || selectedTest === "diagnostic_test") {
      const a = twoLevelVars[0]?.name || "";
      const b = twoLevelVars[1]?.name || twoLevelVars[0]?.name || "";
      setOutcome(a);
      setSecondVar(b);
    } else if (selectedTest === "epidemiology_2x2") {
      const exp = twoLevelVars[0]?.name || "";
      const out = twoLevelVars[1]?.name || twoLevelVars[0]?.name || "";
      setGroupVar(exp);
      setOutcome(out);
    } else if (selectedTest === "kappa_agreement") {
      setOutcome(catVars[0]?.name || "");
      setSecondVar(catVars[1]?.name || catVars[0]?.name || "");
    } else if (selectedTest === "roc_auc") {
      setOutcome(numVars[0]?.name || "");
      setSecondVar(binVars[binVars.length - 1]?.name || twoLevelVars[0]?.name || "");
    } else if (selectedTest === "correlation") {
      setMultiVars(numVars.slice(0, 3).map((v) => v.name));
    } else if (selectedTest === "linreg" || selectedTest === "poisson_reg") {
      const y =
        selectedTest === "poisson_reg"
          ? numVars.find((v) => v.name.includes("dias") || v.name.includes("evento"))?.name || numVars[0]?.name || ""
          : numVars[numVars.length - 1]?.name || numVars[0]?.name || "";
      setOutcome(y);
      setMultiVars(allAnalysisVars.filter((v) => v.name !== y).slice(0, 3).map((v) => v.name));
    } else if (selectedTest === "logreg") {
      const y = binVars[binVars.length - 1]?.name || twoLevelVars[0]?.name || "";
      setOutcome(y);
      setMultiVars(allAnalysisVars.filter((v) => v.name !== y).slice(0, 3).map((v) => v.name));
    } else if (selectedTest === "kaplan_meier" || selectedTest === "cox_ph") {
      const tVar = numVars.find((v) => v.name.includes("tiempo") || v.name.includes("dias"))?.name || numVars[0]?.name || "";
      const eVar =
        binVars.find((v) => v.name.includes("muerte") || v.name.includes("evento"))?.name ||
        binVars[0]?.name ||
        twoLevelVars[0]?.name ||
        "";
      setOutcome(tVar);
      setSecondVar(eVar);
      setGroupVar(catVars.find((v) => v.name !== eVar)?.name || "");
      setMultiVars(allAnalysisVars.filter((v) => v.name !== tVar && v.name !== eVar).slice(0, 3).map((v) => v.name));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTest, activeDatasetId]);

  const toggleMultiVar = (name: string) => {
    setMultiVars((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const handleSelectTest = (meta: TestMeta) => {
    setSelectedTest(meta.id);
    setActiveCategory(meta.category);
  };

  const runAnalysis = async () => {
    if (!ds) return;
    let params: Record<string, unknown> = {};
    switch (selectedTest) {
      case "descriptives":
      case "friedman":
        params = { vars: multiVars };
        break;
      case "frequencies":
        params = { var: outcome };
        break;
      case "ttest":
      case "mannwhitney":
      case "anova":
        params = { outcome, group: groupVar };
        break;
      case "paired_ttest":
      case "mcnemar":
      case "kappa_agreement":
        params = { var1: outcome, var2: secondVar };
        break;
      case "chi2":
        params = { row: outcome, col: groupVar };
        break;
      case "epidemiology_2x2":
        params = { exposure: groupVar, outcome };
        break;
      case "diagnostic_test":
        params = { test_var: outcome, gold_standard: secondVar };
        break;
      case "roc_auc":
        params = { marker: outcome, outcome: secondVar };
        break;
      case "correlation":
        params = { vars: multiVars, method: corrMethod };
        break;
      case "linreg":
      case "logreg":
      case "poisson_reg":
        params = { outcome, predictors: multiVars };
        break;
      case "kaplan_meier":
        params = { time: outcome, event: secondVar, group: groupVar || undefined };
        break;
      case "cox_ph":
        params = { time: outcome, event: secondVar, predictors: multiVars };
        break;
      case "table1":
        params = { group: groupVar || undefined, vars: multiVars };
        break;
      case "sample_size":
        params = {
          design: ssDesign,
          alpha: ssAlpha,
          power: ssPower,
          ratio: ssRatio,
          p1: ssP1,
          p2: ssP2,
          diff: ssDiff,
          sd_val: ssSd,
          r_val: ssR,
        };
        break;
    }

    setRunning(true);
    try {
      const { dataset: freshDs, rows } = await getDatasetWithRows(projectId, ds);
      const res = await apiPost<AnalysisResult>("/analyze", {
        projectId,
        dataset: freshDs,
        rows,
        test: selectedTest,
        params,
      });
      setResult(res);
      setSavedRecord(null);

      if (user && user.emailVerified) {
        try {
          const saved = await saveAnalysisToProject(
            projectId,
            freshDs,
            res,
            { params, source: "manual" },
            user
          );
          setSavedRecord(saved);
          onAnalysisSaved?.(saved);
          toast.success("Análisis guardado automáticamente en «Análisis guardados».");
        } catch {
          // Non-fatal: still display result
        }
      }
    } catch (err) {
      toast.error(errMsg(err, "No se pudo completar el análisis estadístico."));
    } finally {
      setRunning(false);
    }
  };

  const handleToggleFavorite = async () => {
    if (!savedRecord || !user) return;
    const nextPinned = !savedRecord.is_pinned;
    try {
      await updateSavedAnalysisMeta(projectId, savedRecord.id, { is_pinned: nextPinned }, user);
      const updated: SavedAnalysis = {
        ...savedRecord,
        is_pinned: nextPinned,
        updated_at: new Date().toISOString(),
      };
      setSavedRecord(updated);
      onAnalysisUpdated?.(updated);
      toast.success(nextPinned ? "Análisis fijado en favoritos." : "Análisis retirado de favoritos.");
    } catch (err) {
      toast.error(errMsg(err, "No se pudo actualizar el favorito."));
    }
  };

  if (!ds) {
    return (
      <div className="apple-card rounded-3xl border border-dashed border-black/[0.12] bg-white p-14 text-center text-sm text-[#6E6E73] dark:border-white/[0.12] dark:bg-[#141416] dark:text-[#98989D]">
        Carga primero una base de datos en la pestaña Datos para ejecutar análisis bioestadísticos.
      </div>
    );
  }

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const visibleTests = trimmedQuery
    ? TESTS.filter(
        (t) =>
          t.label.toLowerCase().includes(trimmedQuery) ||
          t.desc.toLowerCase().includes(trimmedQuery) ||
          t.keywords.includes(trimmedQuery)
      )
    : TESTS.filter((t) => t.category === activeCategory);

  const selectedMeta = TESTS.find((t) => t.id === selectedTest) ?? TESTS[0];
  const appleSelectClass =
    "w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3 py-2 text-sm text-[#1D1D1F] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15";
  const appleSmallInputClass =
    "w-full rounded-xl border border-transparent bg-[#F5F5F7] px-2.5 py-1.5 text-xs font-mono text-[#1D1D1F] transition focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:focus:border-[#0A84FF]";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left rail: categorized test selector & parameter builder */}
      <aside className="lg:col-span-4 space-y-4">
        <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/[0.08] dark:bg-[#141416]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[#6E6E73] dark:text-[#98989D]">
              Base activa
            </label>
            <span className="text-[11px] font-medium text-[#86868B] dark:text-[#98989D]">
              {TESTS.length} pruebas clínicas
            </span>
          </div>
          <select
            value={activeDatasetId}
            onChange={(e) => onSelectDataset(e.target.value)}
            className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3 py-2 text-sm font-medium text-[#1D1D1F] transition focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:focus:border-[#0A84FF]"
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} (N={d.n_rows})
              </option>
            ))}
          </select>

          {/* Search box */}
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#86868B]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar prueba (ROC, Cox, NNT, κ, McNemar…)"
              data-testid="test-search-input"
              className="w-full rounded-xl border border-transparent bg-[#F5F5F7] py-1.5 pl-8 pr-8 text-xs text-[#1D1D1F] placeholder:text-[#86868B] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:placeholder:text-[#6E6E73] dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* 6 Clinical Category Tabs */}
          {!trimmedQuery && (
            <div className="mt-3 grid grid-cols-2 gap-1.5" role="tablist" aria-label="Categorías bioestadísticas">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const isActive = activeCategory === cat.id;
                const count = TESTS.filter((t) => t.category === cat.id).length;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    data-testid={`cat-tab-${cat.id}`}
                    onClick={() => {
                      setActiveCategory(cat.id);
                      const inCat = TESTS.filter((t) => t.category === cat.id);
                      if (!inCat.some((t) => t.id === selectedTest) && inCat[0]) {
                        setSelectedTest(inCat[0].id);
                      }
                    }}
                    className={cn(
                      "flex items-center justify-between gap-1.5 rounded-xl border px-2.5 py-2 text-left text-xs font-medium transition-all",
                      isActive
                        ? "border-[#0071E3]/40 bg-[#0071E3]/[0.07] text-[#0071E3] dark:border-[#0A84FF]/50 dark:bg-[#0A84FF]/[0.12] dark:text-[#0A84FF]"
                        : "border-black/[0.06] bg-white text-[#6E6E73] hover:bg-[#F5F5F7] hover:text-[#1D1D1F] dark:border-white/[0.08] dark:bg-[#1C1C1E]/60 dark:text-[#98989D] dark:hover:bg-[#1C1C1E] dark:hover:text-white"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-[#0071E3] dark:text-[#0A84FF]" : "text-[#86868B]")} />
                      <span className="truncate">{cat.shortLabel}</span>
                    </span>
                    <span className="font-mono text-[10px] opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Filtered tests */}
          <div className="mt-3.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[#86868B] dark:text-[#98989D]">
              <span>
                {trimmedQuery
                  ? `Resultados (${visibleTests.length})`
                  : CATEGORIES.find((c) => c.id === activeCategory)?.label}
              </span>
            </div>

            {visibleTests.length === 0 ? (
              <div className="rounded-xl border border-dashed border-black/[0.12] p-4 text-center text-xs text-[#6E6E73] dark:border-white/[0.12] dark:text-[#98989D]">
                No hay pruebas que coincidan con «{searchQuery}».
              </div>
            ) : (
              <div className="space-y-1.5">
                {visibleTests.map((t) => {
                  const active = selectedTest === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleSelectTest(t)}
                      data-testid={`test-btn-${t.id}`}
                      className={cn(
                        "w-full rounded-xl px-3 py-2.5 text-left transition-all",
                        active
                          ? "bg-[#0071E3]/[0.07] text-[#1D1D1F] ring-1 ring-[#0071E3]/40 dark:bg-[#0A84FF]/[0.14] dark:text-white dark:ring-[#0A84FF]/50"
                          : "border border-black/[0.05] text-[#424245] hover:bg-[#F5F5F7] dark:border-white/[0.06] dark:text-[#D1D1D6] dark:hover:bg-white/[0.04]"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold">{t.label}</span>
                        {trimmedQuery && (
                          <span className="text-[10px] text-[#86868B]">
                            {CATEGORIES.find((c) => c.id === t.category)?.shortLabel}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#6E6E73] dark:text-[#98989D]">{t.desc}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Parameter Form */}
        <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 space-y-4 dark:border-white/[0.08] dark:bg-[#141416]">
          <div>
            <h4 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
              {selectedMeta.label}
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
              <span className="font-medium text-[#1D1D1F] dark:text-[#E5E5EA]">Cuándo usarla:</span>{" "}
              {selectedMeta.whenToUse}
            </p>
          </div>

          {(selectedTest === "ttest" || selectedTest === "mannwhitney" || selectedTest === "anova") && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Variable de resultado (numérica)
                </label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className={appleSelectClass}
                  data-testid="param-outcome"
                >
                  {numVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Variable de agrupación {selectedTest === "anova" ? "(≥2 categorías)" : "(2 grupos)"}
                </label>
                <select
                  value={groupVar}
                  onChange={(e) => setGroupVar(e.target.value)}
                  className={appleSelectClass}
                  data-testid="param-group"
                >
                  {(selectedTest === "anova" ? catVars : twoLevelVars).map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.levels.join(" vs ")})
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {selectedTest === "paired_ttest" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Medida 1 (basal)
                </label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className={appleSelectClass}
                >
                  {numVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Medida 2 (seguimiento)
                </label>
                <select
                  value={secondVar}
                  onChange={(e) => setSecondVar(e.target.value)}
                  className={appleSelectClass}
                >
                  {numVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {selectedTest === "frequencies" && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                Variable categórica o binaria
              </label>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className={appleSelectClass}
              >
                {catVars.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedTest === "chi2" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">Variable fila</label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className={appleSelectClass}
                >
                  {catVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">Variable columna</label>
                <select
                  value={groupVar}
                  onChange={(e) => setGroupVar(e.target.value)}
                  className={appleSelectClass}
                >
                  {catVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {selectedTest === "epidemiology_2x2" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Exposición / Factor / Tratamiento (binaria)
                </label>
                <select
                  value={groupVar}
                  onChange={(e) => setGroupVar(e.target.value)}
                  className={appleSelectClass}
                >
                  {twoLevelVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.levels.join(" / ")})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Desenlace clínico (binaria)
                </label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className={appleSelectClass}
                >
                  {twoLevelVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.levels.join(" / ")})
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {selectedTest === "mcnemar" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Condición binaria 1 (basal / método A)
                </label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className={appleSelectClass}
                >
                  {twoLevelVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Condición binaria 2 (seguimiento / método B)
                </label>
                <select
                  value={secondVar}
                  onChange={(e) => setSecondVar(e.target.value)}
                  className={appleSelectClass}
                >
                  {twoLevelVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {selectedTest === "kappa_agreement" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Evaluador / Método 1
                </label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className={appleSelectClass}
                >
                  {catVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Evaluador / Método 2
                </label>
                <select
                  value={secondVar}
                  onChange={(e) => setSecondVar(e.target.value)}
                  className={appleSelectClass}
                >
                  {catVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {selectedTest === "diagnostic_test" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Prueba diagnóstica evaluada (binaria)
                </label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className={appleSelectClass}
                >
                  {twoLevelVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Estándar de oro / Diagnóstico real (binaria)
                </label>
                <select
                  value={secondVar}
                  onChange={(e) => setSecondVar(e.target.value)}
                  className={appleSelectClass}
                >
                  {twoLevelVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {selectedTest === "roc_auc" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Marcador / Puntuación continua (numérica)
                </label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className={appleSelectClass}
                >
                  {numVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Evento / Enfermedad (binaria 0/1)
                </label>
                <select
                  value={secondVar}
                  onChange={(e) => setSecondVar(e.target.value)}
                  className={appleSelectClass}
                >
                  {twoLevelVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {(selectedTest === "kaplan_meier" || selectedTest === "cox_ph") && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Tiempo de seguimiento (numérica)
                </label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className={appleSelectClass}
                >
                  {numVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Evento (0 = censura, 1 = evento)
                </label>
                <select
                  value={secondVar}
                  onChange={(e) => setSecondVar(e.target.value)}
                  className={appleSelectClass}
                >
                  {(binVars.length ? binVars : twoLevelVars).map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              {selectedTest === "kaplan_meier" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Estratificar por (opcional, Log-Rank)
                  </label>
                  <select
                    value={groupVar}
                    onChange={(e) => setGroupVar(e.target.value)}
                    className={appleSelectClass}
                  >
                    <option value="">Cohorte completa</option>
                    {catVars.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {(selectedTest === "linreg" || selectedTest === "logreg" || selectedTest === "poisson_reg") && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                Variable dependiente (
                {selectedTest === "logreg"
                  ? "binaria 0/1"
                  : selectedTest === "poisson_reg"
                    ? "conteo ≥ 0"
                    : "numérica"}
                )
              </label>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className={appleSelectClass}
              >
                {(selectedTest === "logreg" ? twoLevelVars : numVars).map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedTest === "table1" && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                Estratificar por grupo (opcional)
              </label>
              <select
                value={groupVar}
                onChange={(e) => setGroupVar(e.target.value)}
                className={appleSelectClass}
              >
                <option value="">Sin estratificación</option>
                {catVars.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedTest === "correlation" && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">Método</label>
              <div className="grid grid-cols-2 rounded-xl bg-black/[0.045] p-1 dark:bg-white/[0.07]">
                {(["pearson", "spearman"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setCorrMethod(m)}
                    className={cn(
                      "rounded-lg py-1.5 text-xs font-medium capitalize transition-all",
                      corrMethod === m
                        ? "bg-white text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-[#2C2C2E] dark:text-white"
                        : "text-[#6E6E73] hover:text-[#1D1D1F] dark:text-[#98989D]"
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(selectedTest === "descriptives" ||
            selectedTest === "friedman" ||
            selectedTest === "correlation" ||
            selectedTest === "linreg" ||
            selectedTest === "logreg" ||
            selectedTest === "poisson_reg" ||
            selectedTest === "cox_ph" ||
            selectedTest === "table1") && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                {selectedTest === "linreg" ||
                selectedTest === "logreg" ||
                selectedTest === "poisson_reg" ||
                selectedTest === "cox_ph"
                  ? "Covariables / Predictores"
                  : selectedTest === "friedman"
                    ? "Medidas repetidas (≥3 numéricas)"
                    : "Variables incluidas"}
              </label>
              <div className="max-h-48 overflow-y-auto space-y-1 rounded-xl border border-black/[0.06] bg-[#F5F5F7]/60 p-2 dark:border-white/[0.08] dark:bg-[#1C1C1E]/60">
                {(selectedTest === "correlation" || selectedTest === "friedman" || selectedTest === "descriptives"
                  ? numVars
                  : allAnalysisVars
                )
                  .filter((v) =>
                    selectedTest === "linreg" || selectedTest === "logreg" || selectedTest === "poisson_reg"
                      ? v.name !== outcome
                      : selectedTest === "cox_ph"
                        ? v.name !== outcome && v.name !== secondVar
                        : selectedTest === "table1"
                          ? v.name !== groupVar
                          : true
                  )
                  .map((v) => {
                    const checked = multiVars.includes(v.name);
                    return (
                      <label
                        key={v.name}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs transition hover:bg-white dark:hover:bg-white/[0.06]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMultiVar(v.name)}
                          className="h-3.5 w-3.5 rounded border-black/20 text-[#0071E3] focus:ring-[#0071E3] dark:border-white/20 dark:text-[#0A84FF]"
                        />
                        <span className="font-mono text-[#1D1D1F] dark:text-[#F5F5F7]">{v.name}</span>
                      </label>
                    );
                  })}
              </div>
            </div>
          )}

          {selectedTest === "sample_size" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Diseño del estudio
                </label>
                <select
                  value={ssDesign}
                  onChange={(e) => setSsDesign(e.target.value as "two_proportions" | "two_means" | "correlation")}
                  className={appleSelectClass}
                >
                  <option value="two_proportions">Comparación de 2 proporciones (%)</option>
                  <option value="two_means">Comparación de 2 medias independientes</option>
                  <option value="correlation">Estudio de correlación lineal (r)</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">
                    Alfa (α)
                  </label>
                  <select
                    value={ssAlpha}
                    onChange={(e) => setSsAlpha(Number(e.target.value))}
                    className={appleSmallInputClass}
                  >
                    <option value={0.05}>0.05</option>
                    <option value={0.01}>0.01</option>
                    <option value={0.1}>0.10</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">
                    Potencia (1−β)
                  </label>
                  <select
                    value={ssPower}
                    onChange={(e) => setSsPower(Number(e.target.value))}
                    className={appleSmallInputClass}
                  >
                    <option value={0.8}>80%</option>
                    <option value={0.85}>85%</option>
                    <option value={0.9}>90%</option>
                    <option value={0.95}>95%</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">
                    Razón n₂/n₁
                  </label>
                  <input
                    type="number"
                    min={0.2}
                    max={5}
                    step={0.5}
                    disabled={ssDesign === "correlation"}
                    value={ssRatio}
                    onChange={(e) => setSsRatio(Number(e.target.value) || 1)}
                    className={cn(appleSmallInputClass, "disabled:opacity-50")}
                  />
                </div>
              </div>

              {ssDesign === "two_proportions" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">
                      Proporción p₁ (0–1)
                    </label>
                    <input
                      type="number"
                      min={0.01}
                      max={0.99}
                      step={0.01}
                      value={ssP1}
                      onChange={(e) => setSsP1(Number(e.target.value))}
                      className={appleSmallInputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">
                      Proporción p₂ (0–1)
                    </label>
                    <input
                      type="number"
                      min={0.01}
                      max={0.99}
                      step={0.01}
                      value={ssP2}
                      onChange={(e) => setSsP2(Number(e.target.value))}
                      className={appleSmallInputClass}
                    />
                  </div>
                </div>
              )}

              {ssDesign === "two_means" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">
                      Diferencia mínima (Δ)
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      step={0.5}
                      value={ssDiff}
                      onChange={(e) => setSsDiff(Number(e.target.value))}
                      className={appleSmallInputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">
                      DE esperada (σ)
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      step={0.5}
                      value={ssSd}
                      onChange={(e) => setSsSd(Number(e.target.value))}
                      className={appleSmallInputClass}
                    />
                  </div>
                </div>
              )}

              {ssDesign === "correlation" && (
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">
                    Correlación mínima esperada (r)
                  </label>
                  <input
                    type="number"
                    min={0.05}
                    max={0.95}
                    step={0.05}
                    value={ssR}
                    onChange={(e) => setSsR(Number(e.target.value))}
                    className={appleSmallInputClass}
                  />
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={running}
            onClick={runAnalysis}
            data-testid="run-analysis-btn"
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0071E3] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
          >
            <Play className="h-4 w-4" />
            {running ? "Calculando…" : "Ejecutar análisis"}
          </button>
        </div>
      </aside>

      {/* Right stage: analytical results */}
      <section className="lg:col-span-8">
        {result ? (
          <div className="space-y-4">
            {savedRecord && (
              <div className="apple-card flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-black/[0.06] bg-white px-4 py-2.5 text-xs dark:border-white/[0.08] dark:bg-[#141416]">
                <span className="text-[#6E6E73] dark:text-[#98989D]">
                  Guardado automáticamente en <strong className="font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">Análisis guardados</strong>
                </span>
                <button
                  type="button"
                  onClick={() => void handleToggleFavorite()}
                  data-testid="pin-active-analysis-btn"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    savedRecord.is_pinned
                      ? "border-amber-300/80 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                      : "border-black/[0.08] bg-white text-[#1D1D1F] hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
                  )}
                >
                  {savedRecord.is_pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  {savedRecord.is_pinned ? "Favorito fijado" : "Fijar favorito"}
                </button>
              </div>
            )}
            <ResultView result={result} onAskCopilot={onAskCopilot} />
          </div>
        ) : (
          <div className="apple-card flex h-full min-h-[440px] flex-col items-center justify-center rounded-3xl border border-dashed border-black/[0.12] bg-white p-12 text-center dark:border-white/[0.12] dark:bg-[#141416]">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0071E3]/10 text-[#0071E3] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]">
              <BarChart3 className="h-6 w-6" />
            </span>
            <h3 className="mt-4 font-heading text-lg font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
              Mesa de trabajo bioestadística
            </h3>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
              Explora las 6 categorías clínicas en el panel izquierdo, elige una de las {TESTS.length} pruebas y pulsa{" "}
              <strong className="font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">Ejecutar análisis</strong> para generar tablas APA, intervalos de confianza y gráficos interactivos.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
