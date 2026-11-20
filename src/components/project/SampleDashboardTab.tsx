import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart2,
  ClipboardList,
  Copy,
  Download,
  FilterX,
  PieChart as PieChartIcon,
  RefreshCw,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell as RechartsCell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { errMsg } from "../../lib/api.ts";
import { copyChartImageToClipboard, downloadChartPng } from "../../lib/clipboardExport.ts";
import { getDatasetWithRows } from "../../lib/firestoreDb.ts";
import { Link } from "../../lib/router.tsx";
import {
  computeCategoricalSummary,
  computeCorrelationOverview,
  computeNumericByGroup,
  computeNumericSummary,
  computeRecruitmentSeries,
  computeScatterPair,
  computeVariableCompleteness,
  toCategoryLabel,
} from "../../lib/sampleDashboardStats.ts";
import {
  CRF_STATUS_LABEL,
  type CrfRecordStatus,
  type Dataset,
  type DatasetRowItem,
} from "../../lib/types.ts";
import { cn } from "../../lib/utils.ts";

const PALETTE = [
  "#0071E3",
  "#10B981",
  "#F59E0B",
  "#6366F1",
  "#EC4899",
  "#0EA5E9",
  "#8B5CF6",
  "#14B8A6",
];

function heatmapColors(r: number | null): { fill: string; text: string } {
  if (r === null || !Number.isFinite(r)) {
    return { fill: "rgba(148, 163, 184, 0.14)", text: "#64748B" };
  }
  const abs = Math.min(1, Math.abs(r));
  const alpha = 0.12 + abs * 0.72;
  if (r >= 0) {
    return {
      fill: `rgba(0, 113, 227, ${alpha.toFixed(2)})`,
      text: abs > 0.5 ? "#FFFFFF" : "#0F172A",
    };
  }
  return {
    fill: `rgba(225, 29, 72, ${alpha.toFixed(2)})`,
    text: abs > 0.5 ? "#FFFFFF" : "#0F172A",
  };
}

function ChartCardActions({
  boxRef,
  title,
  subtitle,
}: {
  boxRef: React.RefObject<HTMLDivElement | null>;
  title: string;
  subtitle?: string;
}) {
  const handleCopy = async () => {
    if (!boxRef.current) return;
    try {
      const outcome = await copyChartImageToClipboard(boxRef.current, title, subtitle);
      if (outcome === "copied") {
        toast.success("Gráfico copiado como imagen para pegar en Word.");
      } else {
        toast.info("Se descargó el gráfico en PNG para insertarlo en Word.");
      }
    } catch {
      toast.error("No se pudo copiar el gráfico.");
    }
  };

  const handleDownload = async () => {
    if (!boxRef.current) return;
    try {
      await downloadChartPng(boxRef.current, title, subtitle);
      toast.success("Gráfico descargado en PNG.");
    } catch {
      toast.error("No se pudo exportar el gráfico.");
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => void handleCopy()}
        title="Copiar gráfico para Word"
        className="inline-flex h-7 items-center gap-1 rounded-full border border-black/[0.08] bg-[#F5F5F7] px-2.5 text-[11px] font-medium text-[#1D1D1F] transition-colors hover:bg-[#ECECEF] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-[#2C2C2E]"
      >
        <Copy className="h-3 w-3" />
        Copiar
      </button>
      <button
        type="button"
        onClick={() => void handleDownload()}
        title="Descargar gráfico en PNG"
        className="inline-flex h-7 items-center gap-1 rounded-full border border-black/[0.08] bg-white px-2 text-[11px] font-medium text-[#6E6E73] transition-colors hover:bg-[#F5F5F7] hover:text-[#1D1D1F] dark:border-white/[0.1] dark:bg-[#141416] dark:text-[#98989D] dark:hover:bg-[#1C1C1E]"
      >
        <Download className="h-3 w-3" />
      </button>
    </div>
  );
}

function CategoricalDonutCard({
  summary,
  activeValue,
  onToggleFilter,
}: {
  summary: ReturnType<typeof computeCategoricalSummary>;
  activeValue?: string;
  onToggleFilter: (varName: string, category: string) => void;
}) {
  const [chartMode, setChartMode] = useState<"pie" | "bar">("pie");
  const boxRef = useRef<HTMLDivElement | null>(null);

  return (
    <article className="flex flex-col rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
            {summary.label}
          </h4>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6E6E73] dark:text-[#98989D]">
            Válidos: {summary.valid} · Perdidos: {summary.missing}
            {activeValue ? ` · Filtro: ${activeValue}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-lg bg-black/[0.045] p-0.5 dark:bg-white/[0.07]">
            <button
              type="button"
              onClick={() => setChartMode("pie")}
              aria-label={`Ver ${summary.label} como gráfico circular`}
              className={cn(
                "rounded-md p-1 transition-colors",
                chartMode === "pie"
                  ? "bg-white text-[#0071E3] shadow-2xs dark:bg-[#2C2C2E] dark:text-[#0A84FF]"
                  : "text-[#6E6E73] hover:text-[#1D1D1F] dark:text-[#98989D]"
              )}
            >
              <PieChartIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setChartMode("bar")}
              aria-label={`Ver ${summary.label} como barras`}
              className={cn(
                "rounded-md p-1 transition-colors",
                chartMode === "bar"
                  ? "bg-white text-[#0071E3] shadow-2xs dark:bg-[#2C2C2E] dark:text-[#0A84FF]"
                  : "text-[#6E6E73] hover:text-[#1D1D1F] dark:text-[#98989D]"
              )}
            >
              <BarChart2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <ChartCardActions
            boxRef={boxRef}
            title={`Distribución de ${summary.label}`}
            subtitle={`N válido = ${summary.valid}`}
          />
        </div>
      </div>

      <div ref={boxRef} className="h-[220px] w-full text-[#6E6E73] dark:text-[#98989D]">
        {summary.slices.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[#86868B]">
            Sin valores registrados para esta variable.
          </div>
        ) : chartMode === "pie" ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={summary.slices}
                dataKey="count"
                nameKey="category"
                cx="50%"
                cy="47%"
                innerRadius="48%"
                outerRadius="78%"
                paddingAngle={2}
                isAnimationActive={false}
                onClick={(entry) => {
                  const cat = String((entry as { category?: string })?.category ?? "");
                  if (cat && cat !== "Otras categorías") {
                    onToggleFilter(summary.varName, cat);
                  }
                }}
              >
                {summary.slices.map((s, idx) => {
                  const dimmed = Boolean(activeValue && activeValue !== s.category);
                  return (
                    <RechartsCell
                      key={s.category}
                      fill={PALETTE[idx % PALETTE.length]}
                      fillOpacity={dimmed ? 0.25 : 0.92}
                      stroke={activeValue === s.category ? "#1D1D1F" : "transparent"}
                      strokeWidth={activeValue === s.category ? 2 : 0}
                      style={{ cursor: s.category === "Otras categorías" ? "default" : "pointer" }}
                    />
                  );
                })}
              </Pie>
              <Tooltip
                formatter={(val: unknown, _name: unknown, item: { payload?: { pct?: number; category?: string } }) => [
                  `${Number(val)} (${item?.payload?.pct ?? 0}%)`,
                  item?.payload?.category ?? "Categoría",
                ]}
                contentStyle={{
                  backgroundColor: "rgba(255,255,255,0.96)",
                  borderRadius: "10px",
                  border: "1px solid rgba(0,0,0,0.08)",
                  fontSize: "12px",
                  color: "#0F172A",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={summary.slices}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 6, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "currentColor" }} tickLine={false} />
              <YAxis
                type="category"
                dataKey="category"
                width={90}
                tick={{ fontSize: 11, fill: "currentColor" }}
                tickLine={false}
              />
              <Tooltip
                formatter={(val: unknown, _n: unknown, item: { payload?: { pct?: number } }) => [
                  `${Number(val)} (${item?.payload?.pct ?? 0}%)`,
                  "Pacientes",
                ]}
                contentStyle={{
                  backgroundColor: "rgba(255,255,255,0.96)",
                  borderRadius: "10px",
                  border: "1px solid rgba(0,0,0,0.08)",
                  fontSize: "12px",
                  color: "#0F172A",
                }}
              />
              <Bar
                dataKey="count"
                radius={[0, 6, 6, 0]}
                isAnimationActive={false}
                onClick={(entry) => {
                  const cat = String((entry as { category?: string })?.category ?? "");
                  if (cat && cat !== "Otras categorías") {
                    onToggleFilter(summary.varName, cat);
                  }
                }}
              >
                {summary.slices.map((s, idx) => (
                  <RechartsCell
                    key={s.category}
                    fill={PALETTE[idx % PALETTE.length]}
                    fillOpacity={activeValue && activeValue !== s.category ? 0.25 : 0.92}
                    style={{ cursor: s.category === "Otras categorías" ? "default" : "pointer" }}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Interactive PowerBI-style Legend List */}
      {summary.slices.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-black/[0.05] pt-2.5 text-[11px] dark:border-white/[0.06]">
          {summary.slices.slice(0, 6).map((s, idx) => {
            const isSelected = activeValue === s.category;
            const clickable = s.category !== "Otras categorías";
            return (
              <button
                key={s.category}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onToggleFilter(summary.varName, s.category)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-left transition-colors",
                  clickable ? "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" : "cursor-default",
                  isSelected && "bg-[#0071E3]/10 font-semibold text-[#0071E3] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]"
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
                  />
                  <span className="truncate text-[#424245] dark:text-[#D1D1D6]">{s.category}</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-[#1D1D1F] dark:text-white">
                  {s.count} ({s.pct}%)
                </span>
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}

function NumericHistogramCard({
  summary,
}: {
  summary: NonNullable<ReturnType<typeof computeNumericSummary>>;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  return (
    <article className="rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
            {summary.label}
          </h4>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6E6E73] dark:text-[#98989D]">
            N={summary.n} · Media {summary.mean} ± {summary.sd} · Mediana {summary.median} (RIC {summary.q1}–{summary.q3})
          </p>
        </div>
        <ChartCardActions
          boxRef={boxRef}
          title={`Histograma de ${summary.label}`}
          subtitle={`Media ${summary.mean} ± ${summary.sd} · Mediana ${summary.median}`}
        />
      </div>

      <div ref={boxRef} className="h-[205px] w-full text-[#6E6E73] dark:text-[#98989D]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={summary.bins} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
            <XAxis dataKey="bin" tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "currentColor" }} tickLine={false} allowDecimals={false} />
            <Tooltip
              formatter={(val: unknown) => [`${Number(val)} pacientes`, "Frecuencia"]}
              contentStyle={{
                backgroundColor: "rgba(255,255,255,0.96)",
                borderRadius: "10px",
                border: "1px solid rgba(0,0,0,0.08)",
                fontSize: "12px",
                color: "#0F172A",
              }}
            />
            <Bar dataKey="count" name="Pacientes" fill="#0071E3" radius={[5, 5, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-black/[0.05] pt-2 font-mono text-[11px] tabular-nums text-[#6E6E73] dark:border-white/[0.06] dark:text-[#98989D]">
        <span>Mín: {summary.min}</span>
        <span>Máx: {summary.max}</span>
        <span>Perdidos: {summary.missing}</span>
      </div>
    </article>
  );
}

interface SampleDashboardTabProps {
  projectId: string;
  datasets: Dataset[];
  activeDatasetId: string;
  onSelectDataset: (id: string) => void;
  refreshSignal?: number;
  onGoToCapture?: (formId: string) => void;
}

export function SampleDashboardTab({
  projectId,
  datasets,
  activeDatasetId,
  onSelectDataset,
  refreshSignal = 0,
}: SampleDashboardTabProps) {
  const [loadedDataset, setLoadedDataset] = useState<Dataset | null>(null);
  const [allItems, setAllItems] = useState<DatasetRowItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Interactive PowerBI-style slicers & cross-filters
  const [crfStatusFilter, setCrfStatusFilter] = useState<string>("");
  const [categoryFilters, setCategoryFilters] = useState<Record<string, string>>({});
  const [corrMethod, setCorrMethod] = useState<"pearson" | "spearman">("pearson");
  const [scatterX, setScatterX] = useState("");
  const [scatterY, setScatterY] = useState("");
  const [scatterGroup, setScatterGroup] = useState("");
  const [boxNumVar, setBoxNumVar] = useState("");
  const [boxGroupVar, setBoxGroupVar] = useState("");

  const heatmapBoxRef = useRef<HTMLDivElement | null>(null);
  const scatterBoxRef = useRef<HTMLDivElement | null>(null);
  const groupBoxRef = useRef<HTMLDivElement | null>(null);
  const recruitBoxRef = useRef<HTMLDivElement | null>(null);

  const selectedMeta = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId) ?? null,
    [datasets, activeDatasetId]
  );

  const loadRows = async () => {
    if (!selectedMeta) {
      setLoadedDataset(null);
      setAllItems([]);
      return;
    }
    setLoading(true);
    try {
      const res = await getDatasetWithRows(projectId, selectedMeta);
      setLoadedDataset(res.dataset);
      setAllItems(res.rowItems);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo actualizar la descripción de la muestra."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, activeDatasetId, selectedMeta?.n_rows, refreshSignal]);

  // Reset filters when switching dataset
  useEffect(() => {
    setCrfStatusFilter("");
    setCategoryFilters({});
    setScatterX("");
    setScatterY("");
    setScatterGroup("");
    setBoxNumVar("");
    setBoxGroupVar("");
  }, [activeDatasetId]);

  const activeDs = loadedDataset ?? selectedMeta;

  const hasCrfRows = useMemo(() => allItems.some((it) => it.source === "crf"), [allItems]);

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (crfStatusFilter && item.status !== crfStatusFilter) return false;
      for (const [varName, expectedVal] of Object.entries(categoryFilters)) {
        const actual = toCategoryLabel(item.data[varName]);
        if (actual !== expectedVal) return false;
      }
      return true;
    });
  }, [allItems, crfStatusFilter, categoryFilters]);

  const catVars = useMemo(() => {
    if (!activeDs) return [];
    return activeDs.variables.filter(
      (v) =>
        (v.type === "categorical" || v.type === "binary") &&
        v.levels.length >= 1 &&
        v.levels.length <= 25
    );
  }, [activeDs]);

  const numVars = useMemo(() => {
    if (!activeDs) return [];
    return activeDs.variables.filter((v) => v.type === "numeric");
  }, [activeDs]);

  const dateVars = useMemo(() => {
    if (!activeDs) return [];
    return activeDs.variables.filter((v) => v.type === "date");
  }, [activeDs]);

  const categoricalSummaries = useMemo(
    () => catVars.slice(0, 6).map((v) => computeCategoricalSummary(filteredItems, v, 8)),
    [catVars, filteredItems]
  );

  const numericSummaries = useMemo(() => {
    return numVars
      .slice(0, 4)
      .map((v) => computeNumericSummary(filteredItems, v))
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [numVars, filteredItems]);

  const correlationOverview = useMemo(
    () => computeCorrelationOverview(filteredItems, numVars, corrMethod),
    [filteredItems, numVars, corrMethod]
  );

  // Smart defaults for scatter & group comparison
  useEffect(() => {
    if (numVars.length >= 2) {
      if (!scatterX || !numVars.some((v) => v.name === scatterX)) {
        setScatterX(correlationOverview.strongestPair?.xVar || numVars[0].name);
      }
      if (!scatterY || !numVars.some((v) => v.name === scatterY)) {
        setScatterY(correlationOverview.strongestPair?.yVar || numVars[1].name);
      }
    }
    if (numVars.length >= 1 && (!boxNumVar || !numVars.some((v) => v.name === boxNumVar))) {
      setBoxNumVar(numVars[0].name);
    }
    if (catVars.length >= 1 && (!boxGroupVar || !catVars.some((v) => v.name === boxGroupVar))) {
      setBoxGroupVar(catVars[0].name);
    }
  }, [numVars, catVars, correlationOverview.strongestPair, scatterX, scatterY, boxNumVar, boxGroupVar]);

  const scatterResult = useMemo(() => {
    if (!scatterX || !scatterY) return null;
    return computeScatterPair(filteredItems, scatterX, scatterY, corrMethod, scatterGroup || undefined);
  }, [filteredItems, scatterX, scatterY, corrMethod, scatterGroup]);

  const groupBoxData = useMemo(() => {
    if (!boxNumVar || !boxGroupVar) return [];
    return computeNumericByGroup(filteredItems, boxNumVar, boxGroupVar);
  }, [filteredItems, boxNumVar, boxGroupVar]);

  const completeness = useMemo(() => {
    if (!activeDs) return [];
    return computeVariableCompleteness(filteredItems, activeDs.variables);
  }, [filteredItems, activeDs]);

  const globalCompletenessPct = useMemo(() => {
    if (!completeness.length || !filteredItems.length) return 0;
    const totalCells = filteredItems.length * completeness.length;
    const totalValid = completeness.reduce((s, c) => s + c.valid, 0);
    return totalCells > 0 ? Math.round((totalValid / totalCells) * 1000) / 10 : 0;
  }, [completeness, filteredItems.length]);

  const recruitment = useMemo(() => {
    if (!activeDs) return null;
    return computeRecruitmentSeries(filteredItems, activeDs.variables);
  }, [filteredItems, activeDs]);

  const toggleCategoryFilter = (varName: string, value: string) => {
    setCategoryFilters((prev) => {
      if (prev[varName] === value) {
        const next = { ...prev };
        delete next[varName];
        return next;
      }
      return { ...prev, [varName]: value };
    });
  };

  const activeFilterCount = Object.keys(categoryFilters).length + (crfStatusFilter ? 1 : 0);

  if (!activeDs) {
    return (
      <div className="apple-card rounded-3xl border border-dashed border-black/[0.12] bg-white p-14 text-center dark:border-white/[0.12] dark:bg-[#141416]">
        <h3 className="font-heading text-base font-semibold text-[#1D1D1F] dark:text-white">
          Panel automático de descripción de la muestra
        </h3>
        <p className="mx-auto mt-1.5 max-w-lg text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
          Importa un archivo CSV o Excel (.xlsx) en la pestaña Datos o registra el primer paciente en un formulario CRF para generar automáticamente gráficos circulares, histogramas, comparativas por grupo y matrices de correlación en vivo.
        </p>
      </div>
    );
  }

  const primaryNumeric = numericSummaries[0] ?? null;

  return (
    <div className="space-y-6" data-testid="sample-dashboard-tab">
      {/* PowerBI Slicers & Live Sync Bar */}
      <div className="apple-card flex flex-col gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/[0.08] dark:bg-[#141416]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Seleccionar base de datos"
              value={activeDatasetId}
              onChange={(e) => onSelectDataset(e.target.value)}
              className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3.5 py-2 text-sm font-medium text-[#1D1D1F] focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} (N={d.n_rows})
                </option>
              ))}
            </select>

            <span className="text-xs text-[#6E6E73] dark:text-[#98989D]">
              Actualización automática activa · Haz clic en cualquier sector circular para filtrar el panel
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeDs.form_id && (
              <Link
                to={`/proyectos/${projectId}/formularios/${activeDs.form_id}/capturar`}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                Añadir paciente (CRF)
              </Link>
            )}
            <button
              type="button"
              onClick={() => void loadRows()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full border border-black/[0.08] bg-white px-3.5 py-1.5 text-xs font-medium text-[#1D1D1F] transition-colors hover:bg-[#F5F5F7] disabled:opacity-60 dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Sincronizar
            </button>
          </div>
        </div>

        {/* Slicer Dropdowns */}
        {(hasCrfRows || catVars.length > 0 || activeFilterCount > 0) && (
          <div className="flex flex-wrap items-center gap-2.5 border-t border-black/[0.05] pt-3 dark:border-white/[0.06]">
            {hasCrfRows && (
              <select
                aria-label="Filtrar por estado CRF"
                value={crfStatusFilter}
                onChange={(e) => setCrfStatusFilter(e.target.value)}
                className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3 py-1.5 text-xs font-medium text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
              >
                <option value="">Estado CRF: Todos</option>
                {(Object.keys(CRF_STATUS_LABEL) as CrfRecordStatus[]).map((st) => (
                  <option key={st} value={st}>
                    Estado: {CRF_STATUS_LABEL[st]}
                  </option>
                ))}
              </select>
            )}

            {catVars.slice(0, 3).map((v) => (
              <select
                key={v.name}
                aria-label={`Segmentar por ${v.label || v.name}`}
                value={categoryFilters[v.name] ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setCategoryFilters((prev) => {
                    const next = { ...prev };
                    if (!val) delete next[v.name];
                    else next[v.name] = val;
                    return next;
                  });
                }}
                className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3 py-1.5 text-xs font-medium text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
              >
                <option value="">{v.label || v.name}: Todos</option>
                {v.levels.map((lv) => (
                  <option key={lv} value={lv}>
                    {v.label || v.name}: {lv}
                  </option>
                ))}
              </select>
            ))}

            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCrfStatusFilter("");
                  setCategoryFilters({});
                }}
                data-testid="clear-dashboard-filters-btn"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#0071E3]/30 bg-[#0071E3]/[0.08] px-3 py-1 text-xs font-medium text-[#0071E3] transition-colors hover:bg-[#0071E3]/[0.14] dark:border-[#0A84FF]/40 dark:bg-[#0A84FF]/[0.15] dark:text-[#0A84FF]"
              >
                <FilterX className="h-3.5 w-3.5" />
                Limpiar filtros ({activeFilterCount})
              </button>
            )}
          </div>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.06] bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-white/[0.07] dark:border-white/[0.08] dark:bg-[#141416]">
        <div className="p-5">
          <p className="text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">Tamaño muestral (N)</p>
          <p className="mt-1.5 font-heading text-2xl font-semibold tabular-nums text-[#1D1D1F] dark:text-white">
            {filteredItems.length}
            {activeFilterCount > 0 && (
              <span className="ml-1.5 font-mono text-sm font-normal text-[#6E6E73] dark:text-[#98989D]">
                / {allItems.length}
              </span>
            )}
          </p>
          <p className="mt-1 text-[11px] text-[#6E6E73] dark:text-[#98989D]">
            {allItems.filter((i) => i.source === "crf").length} CRF ·{" "}
            {allItems.filter((i) => i.source === "chunk").length} importados
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">Completitud de datos</p>
          <p className="mt-1.5 font-heading text-2xl font-semibold tabular-nums text-[#1D1D1F] dark:text-white">
            {globalCompletenessPct.toFixed(1)}%
          </p>
          <p className="mt-1 text-[11px] text-[#6E6E73] dark:text-[#98989D]">
            Celdas válidas sobre {activeDs.variables.length} variables
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">Estructura clínica</p>
          <p className="mt-1.5 font-heading text-2xl font-semibold tabular-nums text-[#1D1D1F] dark:text-white">
            {numVars.length} / {catVars.length}
          </p>
          <p className="mt-1 text-[11px] text-[#6E6E73] dark:text-[#98989D]">
            Numéricas · Categ./Binarias · {dateVars.length} fechas
          </p>
        </div>

        <div className="p-5">
          <p className="truncate text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">
            {primaryNumeric ? primaryNumeric.label : "Variables del estudio"}
          </p>
          <p className="mt-1.5 font-heading text-2xl font-semibold tabular-nums text-[#1D1D1F] dark:text-white">
            {primaryNumeric ? `${primaryNumeric.mean} ± ${primaryNumeric.sd}` : activeDs.variables.length}
          </p>
          <p className="mt-1 font-mono text-[11px] tabular-nums text-[#6E6E73] dark:text-[#98989D]">
            {primaryNumeric
              ? `Mediana ${primaryNumeric.median} (${primaryNumeric.q1}–${primaryNumeric.q3})`
              : "Sin variables numéricas"}
          </p>
        </div>
      </div>

      {/* Section 1: Categorical Pie / Donut & Bar Charts (PowerBI cross-filtering) */}
      {categoricalSummaries.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-heading text-base font-semibold text-[#1D1D1F] dark:text-white">
              Distribución categórica (gráficos circulares interactivos)
            </h3>
            <span className="text-xs text-[#6E6E73] dark:text-[#98989D]">
              Pulsa cualquier sector para cruzar los filtros del resto del panel
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {categoricalSummaries.map((summary) => (
              <CategoricalDonutCard
                key={summary.varName}
                summary={summary}
                activeValue={categoryFilters[summary.varName]}
                onToggleFilter={toggleCategoryFilter}
              />
            ))}
          </div>
        </section>
      )}

      {/* Section 2: Numeric Histograms & Group Comparison */}
      {(numericSummaries.length > 0 || (numVars.length > 0 && catVars.length > 0)) && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-heading text-base font-semibold text-[#1D1D1F] dark:text-white">
              Variables continuas y comparativa entre grupos
            </h3>
            <span className="text-xs text-[#6E6E73] dark:text-[#98989D]">
              Histogramas de frecuencia, media ± DE y rango intercuartílico (Q1–Q3)
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {numericSummaries.map((summary) => (
              <NumericHistogramCard key={summary.varName} summary={summary} />
            ))}
          </div>

          {numVars.length > 0 && catVars.length > 0 && groupBoxData.length > 0 && (
            <article className="rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
                    Comparativa de mediana y RIC (Q1–Q3): {boxNumVar} por {boxGroupVar}
                  </h4>
                  <p className="mt-0.5 text-xs text-[#6E6E73] dark:text-[#98989D]">
                    Banda azul: rango intercuartílico Q1–Q3 · Punto azul: mediana · Punto verde: media
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Variable numérica para comparar"
                    value={boxNumVar}
                    onChange={(e) => setBoxNumVar(e.target.value)}
                    className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-2.5 py-1.5 text-xs font-medium text-[#1D1D1F] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                  >
                    {numVars.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.label || v.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Variable de agrupación"
                    value={boxGroupVar}
                    onChange={(e) => setBoxGroupVar(e.target.value)}
                    className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-2.5 py-1.5 text-xs font-medium text-[#1D1D1F] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                  >
                    {catVars.map((v) => (
                      <option key={v.name} value={v.name}>
                        Agrupar: {v.label || v.name}
                      </option>
                    ))}
                  </select>
                  <ChartCardActions
                    boxRef={groupBoxRef}
                    title={`${boxNumVar} según ${boxGroupVar}`}
                    subtitle="Mediana, RIC (Q1–Q3) y Media"
                  />
                </div>
              </div>

              <div ref={groupBoxRef} className="h-[255px] w-full text-[#6E6E73] dark:text-[#98989D]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={groupBoxData.map((g) => ({ ...g, iqrRange: [g.q1, g.q3] }))}
                    margin={{ top: 10, right: 16, left: -8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                    <XAxis dataKey="group" tick={{ fontSize: 11, fill: "currentColor" }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "currentColor" }} tickLine={false} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(255,255,255,0.96)",
                        borderRadius: "10px",
                        border: "1px solid rgba(0,0,0,0.08)",
                        fontSize: "12px",
                        color: "#0F172A",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="iqrRange"
                      name="RIC (Q1–Q3)"
                      fill="#0071E3"
                      fillOpacity={0.24}
                      stroke="#0071E3"
                      strokeWidth={1.5}
                      barSize={44}
                      radius={[6, 6, 6, 6]}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="median"
                      name="Mediana"
                      stroke="#1D1D1F"
                      strokeWidth={2}
                      dot={{ r: 5, fill: "#0071E3", stroke: "#FFFFFF", strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="mean"
                      name="Media"
                      stroke="#10B981"
                      strokeWidth={0}
                      dot={{ r: 4, fill: "#10B981" }}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </article>
          )}
        </section>
      )}

      {/* Section 3: Correlation Matrix Heatmap + Interactive Scatter Plot */}
      {numVars.length >= 2 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-heading text-base font-semibold text-[#1D1D1F] dark:text-white">
                Análisis automático de correlación
              </h3>
              <p className="text-xs text-[#6E6E73] dark:text-[#98989D]">
                Pulsa cualquier celda de la matriz para inspeccionar su nube de puntos y recta de regresión
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-xl bg-black/[0.045] p-1 dark:bg-white/[0.07]">
              {(["pearson", "spearman"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCorrMethod(m)}
                  className={cn(
                    "rounded-lg px-3 py-1 text-xs font-medium capitalize transition-all",
                    corrMethod === m
                      ? "bg-white text-[#1D1D1F] shadow-2xs dark:bg-[#2C2C2E] dark:text-white"
                      : "text-[#6E6E73] hover:text-[#1D1D1F] dark:text-[#98989D]"
                  )}
                >
                  {m === "pearson" ? "Pearson (r)" : "Spearman (ρ)"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Correlation Matrix Heatmap */}
            <article className="lg:col-span-6 rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h4 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
                    Matriz de calor ({corrMethod === "pearson" ? "r de Pearson" : "ρ de Spearman"})
                  </h4>
                  <p className="text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                    Azul: correlación positiva · Rojo: correlación negativa
                  </p>
                </div>
                <ChartCardActions
                  boxRef={heatmapBoxRef}
                  title={`Matriz de correlación (${corrMethod})`}
                  subtitle={`N = ${filteredItems.length} registros`}
                />
              </div>

              <div ref={heatmapBoxRef} className="flex min-h-[280px] items-center justify-center overflow-auto text-[#6E6E73] dark:text-[#98989D]">
                {(() => {
                  const vars = correlationOverview.vars;
                  const n = vars.length;
                  const cellSize = Math.max(44, Math.min(68, Math.floor(300 / Math.max(1, n))));
                  const labelW = 96;
                  const labelH = 34;
                  const svgW = labelW + n * cellSize + 12;
                  const svgH = labelH + n * cellSize + 12;
                  const lookup = new Map<string, { r: number | null; p: number | null; n: number }>();
                  for (const c of correlationOverview.cells) {
                    lookup.set(`${c.rowVar}::${c.colVar}`, { r: c.r, p: c.p, n: c.n });
                  }

                  return (
                    <svg
                      viewBox={`0 0 ${svgW} ${svgH}`}
                      width={svgW}
                      height={svgH}
                      className="max-h-full max-w-full select-none"
                    >
                      {vars.map((v, idx) => (
                        <text
                          key={`col-${v}`}
                          x={labelW + idx * cellSize + cellSize / 2}
                          y={labelH - 8}
                          textAnchor="middle"
                          fontSize={10.5}
                          fontWeight={600}
                          fill="currentColor"
                        >
                          {v.length > 9 ? `${v.slice(0, 8)}…` : v}
                        </text>
                      ))}
                      {vars.map((rowVar, rIdx) => (
                        <g key={`row-${rowVar}`}>
                          <text
                            x={labelW - 8}
                            y={labelH + rIdx * cellSize + cellSize / 2 + 4}
                            textAnchor="end"
                            fontSize={10.5}
                            fontWeight={600}
                            fill="currentColor"
                          >
                            {rowVar.length > 13 ? `${rowVar.slice(0, 12)}…` : rowVar}
                          </text>
                          {vars.map((colVar, cIdx) => {
                            const entry = lookup.get(`${rowVar}::${colVar}`) ?? { r: null, p: null, n: 0 };
                            const { fill, text } = heatmapColors(entry.r);
                            const xPos = labelW + cIdx * cellSize;
                            const yPos = labelH + rIdx * cellSize;
                            const isSelectedPair =
                              (scatterX === rowVar && scatterY === colVar) ||
                              (scatterX === colVar && scatterY === rowVar);
                            return (
                              <g
                                key={`${rowVar}-${colVar}`}
                                style={{ cursor: rowVar !== colVar ? "pointer" : "default" }}
                                onClick={() => {
                                  if (rowVar !== colVar) {
                                    setScatterX(colVar);
                                    setScatterY(rowVar);
                                  }
                                }}
                              >
                                <rect
                                  x={xPos + 2}
                                  y={yPos + 2}
                                  width={cellSize - 4}
                                  height={cellSize - 4}
                                  rx={7}
                                  fill={fill}
                                  stroke={isSelectedPair ? "#1D1D1F" : "rgba(148,163,184,0.2)"}
                                  strokeWidth={isSelectedPair ? 2 : 1}
                                >
                                  <title>
                                    {`${rowVar} × ${colVar}: ${corrMethod === "pearson" ? "r" : "ρ"} = ${
                                      entry.r !== null ? entry.r.toFixed(3) : "—"
                                    }${entry.p !== null && rowVar !== colVar ? ` · p = ${entry.p < 0.001 ? "<0.001" : entry.p.toFixed(3)}` : ""} (N=${entry.n})`}
                                  </title>
                                </rect>
                                <text
                                  x={xPos + cellSize / 2}
                                  y={yPos + cellSize / 2 + 4}
                                  textAnchor="middle"
                                  fontSize={10.5}
                                  fontWeight={600}
                                  fill={text}
                                >
                                  {entry.r !== null ? entry.r.toFixed(2) : "—"}
                                </text>
                              </g>
                            );
                          })}
                        </g>
                      ))}
                    </svg>
                  );
                })()}
              </div>
            </article>

            {/* Interactive Scatter Plot */}
            <article className="lg:col-span-6 rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
                    Dispersión: {scatterY} vs {scatterX}
                  </h4>
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[#0071E3] dark:text-[#0A84FF]">
                    {scatterResult && scatterResult.r !== null
                      ? `${corrMethod === "pearson" ? "r" : "ρ"} = ${scatterResult.r.toFixed(3)} · R² = ${(
                          scatterResult.r2 ?? 0
                        ).toFixed(3)} · p = ${
                          scatterResult.p !== null && scatterResult.p < 0.001
                            ? "<0.001"
                            : scatterResult.p?.toFixed(3) ?? "—"
                        } · N = ${scatterResult.n}`
                      : "Selecciona dos variables numéricas con ≥ 3 pares válidos"}
                  </p>
                </div>

                <ChartCardActions
                  boxRef={scatterBoxRef}
                  title={`Correlación: ${scatterY} vs ${scatterX}`}
                  subtitle={
                    scatterResult?.r !== null && scatterResult?.r !== undefined
                      ? `${corrMethod === "pearson" ? "r" : "ρ"} = ${scatterResult.r.toFixed(3)} · N = ${scatterResult.n}`
                      : undefined
                  }
                />
              </div>

              <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <select
                  aria-label="Variable eje X"
                  value={scatterX}
                  onChange={(e) => setScatterX(e.target.value)}
                  className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-2.5 py-1.5 text-xs font-medium text-[#1D1D1F] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                >
                  {numVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      X: {v.label || v.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Variable eje Y"
                  value={scatterY}
                  onChange={(e) => setScatterY(e.target.value)}
                  className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-2.5 py-1.5 text-xs font-medium text-[#1D1D1F] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                >
                  {numVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      Y: {v.label || v.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Colorear puntos por categoría"
                  value={scatterGroup}
                  onChange={(e) => setScatterGroup(e.target.value)}
                  className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-2.5 py-1.5 text-xs font-medium text-[#1D1D1F] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                >
                  <option value="">Color: Sin grupo</option>
                  {catVars.map((v) => (
                    <option key={v.name} value={v.name}>
                      Color: {v.label || v.name}
                    </option>
                  ))}
                </select>
              </div>

              <div ref={scatterBoxRef} className="h-[235px] w-full text-[#6E6E73] dark:text-[#98989D]">
                {scatterResult && scatterResult.points.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 16, left: -10, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name={scatterX}
                        tick={{ fontSize: 11, fill: "currentColor" }}
                        tickLine={false}
                        domain={["auto", "auto"]}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name={scatterY}
                        tick={{ fontSize: 11, fill: "currentColor" }}
                        tickLine={false}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip
                        cursor={{ strokeDasharray: "3 3" }}
                        contentStyle={{
                          backgroundColor: "rgba(255,255,255,0.96)",
                          borderRadius: "10px",
                          border: "1px solid rgba(0,0,0,0.08)",
                          fontSize: "12px",
                          color: "#0F172A",
                        }}
                      />
                      {(() => {
                        const groups = Array.from(new Set(scatterResult.points.map((p) => p.group)));
                        return groups.map((grp, idx) => (
                          <Scatter
                            key={grp}
                            name={grp}
                            data={scatterResult.points.filter((p) => p.group === grp)}
                            fill={PALETTE[idx % PALETTE.length]}
                            fillOpacity={0.72}
                            isAnimationActive={false}
                          />
                        ));
                      })()}
                      {scatterResult.xmax > scatterResult.xmin && (
                        <ReferenceLine
                          segment={[
                            {
                              x: scatterResult.xmin,
                              y: scatterResult.slope * scatterResult.xmin + scatterResult.intercept,
                            },
                            {
                              x: scatterResult.xmax,
                              y: scatterResult.slope * scatterResult.xmax + scatterResult.intercept,
                            },
                          ]}
                          stroke="#EA580C"
                          strokeWidth={2}
                        />
                      )}
                      {scatterGroup && <Legend wrapperStyle={{ fontSize: 11 }} />}
                    </ScatterChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[#86868B]">
                    No hay suficientes pares numéricos válidos para dibujar la dispersión.
                  </div>
                )}
              </div>
            </article>
          </div>
        </section>
      )}

      {/* Section 4: Data Completeness & Recruitment Curve */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <article
          className={cn(
            "rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]",
            recruitment ? "lg:col-span-6" : "lg:col-span-12"
          )}
        >
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h4 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
              Completitud por variable
            </h4>
            <span className="font-mono text-xs tabular-nums text-[#6E6E73] dark:text-[#98989D]">
              {completeness.length} variables · {globalCompletenessPct.toFixed(1)}% global
            </span>
          </div>

          <div className="max-h-[260px] space-y-2.5 overflow-y-auto pr-1">
            {completeness.map((item) => (
              <div key={item.name} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                    {item.label}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#6E6E73] dark:text-[#98989D]">
                    {item.valid}/{filteredItems.length} ({item.pct}%)
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      item.pct >= 90
                        ? "bg-emerald-500"
                        : item.pct >= 65
                          ? "bg-[#0071E3] dark:bg-[#0A84FF]"
                          : "bg-amber-500"
                    )}
                    style={{ width: `${Math.min(100, item.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </article>

        {recruitment && (
          <article className="lg:col-span-6 rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h4 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
                  Evolución acumulada de inclusión
                </h4>
                <p className="mt-0.5 text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                  {recruitment.sourceLabel} · Total acumulado: {recruitment.points[recruitment.points.length - 1]?.acumulados ?? 0}
                </p>
              </div>
              <ChartCardActions
                boxRef={recruitBoxRef}
                title="Evolución acumulada de inclusión"
                subtitle={recruitment.sourceLabel}
              />
            </div>

            <div ref={recruitBoxRef} className="h-[235px] w-full text-[#6E6E73] dark:text-[#98989D]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={recruitment.points} margin={{ top: 8, right: 14, left: -12, bottom: 4 }}>
                  <defs>
                    <linearGradient id="recruitFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0071E3" stopOpacity={0.24} />
                      <stop offset="95%" stopColor="#0071E3" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 10.5, fill: "currentColor" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "currentColor" }} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(255,255,255,0.96)",
                      borderRadius: "10px",
                      border: "1px solid rgba(0,0,0,0.08)",
                      fontSize: "12px",
                      color: "#0F172A",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="acumulados"
                    name="Pacientes acumulados"
                    stroke="#0071E3"
                    strokeWidth={2.5}
                    fill="url(#recruitFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </article>
        )}
      </section>
    </div>
  );
}
