import { useMemo, useRef, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell as RechartsCell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
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
import { copyChartImageToClipboard, downloadChartPng } from "../../lib/clipboardExport.ts";
import type { ResultChart } from "../../lib/types.ts";

const COLORS = ["#0071E3", "#059669", "#D97706", "#DC2626", "#7C3AED", "#0891B2", "#EA580C", "#4F46E5"];

function heatmapColor(r: number | null): { fill: string; text: string } {
  if (r === null || !Number.isFinite(r)) {
    return { fill: "rgba(148, 163, 184, 0.14)", text: "#64748B" };
  }
  const clamped = Math.max(-1, Math.min(1, r));
  const abs = Math.abs(clamped);
  const alpha = 0.12 + abs * 0.72;
  if (clamped >= 0) {
    return {
      fill: `rgba(0, 113, 227, ${alpha.toFixed(2)})`,
      text: abs > 0.52 ? "#FFFFFF" : "#0F172A",
    };
  }
  return {
    fill: `rgba(225, 29, 72, ${alpha.toFixed(2)})`,
    text: abs > 0.52 ? "#FFFFFF" : "#0F172A",
  };
}

function formatTick(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v ?? "");
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    dataKey?: string;
    value?: unknown;
    color?: string;
    payload?: Record<string, unknown>;
  }>;
  label?: unknown;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const isBox = row && "q1" in row && "q3" in row && "median" in row;
  const isRoc = row && "cutoff" in row && "tpr" in row && "fpr" in row;

  const visibleEntries = payload.filter((entry) => {
    const dk = String(entry.dataKey ?? "");
    return !dk.endsWith("__ciRange");
  });

  return (
    <div className="rounded-xl border border-black/[0.08] bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur-md dark:border-white/[0.12] dark:bg-[#1C1C1E]/95">
      {!isRoc && label !== undefined && label !== "" && (
        <div className="mb-1 font-semibold text-slate-900 dark:text-slate-100">{String(label)}</div>
      )}
      {isBox ? (
        <div className="space-y-0.5 font-mono tabular-nums text-slate-700 dark:text-slate-300">
          <div>N = {String(row.n)}</div>
          <div>Mediana: {String(row.median)}</div>
          <div>
            RIC: {String(row.q1)} – {String(row.q3)}
          </div>
          <div>
            Rango: {String(row.min)} – {String(row.max)}
          </div>
          <div>Media: {String(row.mean)}</div>
        </div>
      ) : isRoc ? (
        <div className="space-y-0.5 font-mono tabular-nums text-slate-700 dark:text-slate-300">
          <div className="font-sans font-semibold text-slate-900 dark:text-slate-100">
            Punto de corte: {String(row.cutoff)}
          </div>
          <div>Sensibilidad (TPR): {(Number(row.tpr) * 100).toFixed(1)}%</div>
          <div>1 − Esp. (FPR): {(Number(row.fpr) * 100).toFixed(1)}%</div>
          <div>Especificidad: {((1 - Number(row.fpr)) * 100).toFixed(1)}%</div>
        </div>
      ) : (
        <div className="space-y-0.5">
          {visibleEntries.map((entry, idx) => {
            const key = String(entry.dataKey ?? entry.name ?? "");
            const ciLo = row?.[`${key}__ci_lo`];
            const ciHi = row?.[`${key}__ci_hi`];
            const hasCi = typeof ciLo === "number" && typeof ciHi === "number";
            return (
              <div key={idx} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color || "#0071E3" }} />
                  {entry.name || "Valor"}
                </span>
                <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                  {hasCi
                    ? `${(Number(entry.value) * 100).toFixed(1)}% (IC 95%: ${(ciLo * 100).toFixed(1)}–${(
                        ciHi * 100
                      ).toFixed(1)}%)`
                    : formatTick(entry.value)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StatChart({ chart, height = 300 }: { chart: ResultChart; height?: number }) {
  const chartBoxRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSurvivalCi, setShowSurvivalCi] = useState<boolean>(true);

  const hasSurvivalCi = useMemo(() => {
    if (chart.type !== "survival" || !chart.data?.length) return false;
    return chart.series.some((s) =>
      chart.data.some((pt) => typeof pt[`${s}__ci_lo`] === "number" && typeof pt[`${s}__ci_hi`] === "number")
    );
  }, [chart]);

  const survivalData = useMemo(() => {
    if (chart.type !== "survival" || !chart.data?.length) return [];
    return chart.data.map((pt) => {
      const next: Record<string, unknown> = { ...pt };
      for (const s of chart.series) {
        const lo = pt[`${s}__ci_lo`];
        const hi = pt[`${s}__ci_hi`];
        if (typeof lo === "number" && typeof hi === "number") {
          next[`${s}__ciRange`] = [lo, hi];
        }
      }
      return next;
    });
  }, [chart]);

  if (!chart.data || chart.data.length === 0) return null;

  const axisStyle = { fontSize: 11, fill: "currentColor" };
  const gridColor = "rgba(148, 163, 184, 0.22)";
  const isOr = chart.meta?.ref === 1 || chart.meta?.refline === 1;
  const isRefZero = Boolean(chart.meta?.refZero);

  const subtitle =
    chart.type === "survival"
      ? hasSurvivalCi
        ? showSurvivalCi
          ? "Estimador de Kaplan-Meier S(t) · IC 95% (Greenwood log-log)"
          : "Estimador de Kaplan-Meier S(t)"
        : "Estimador de Kaplan-Meier S(t)"
      : chart.type === "roc"
        ? `AUC = ${String(chart.meta?.auc ?? "—")}`
        : chart.type === "box"
          ? "Mediana, RIC (Q1–Q3) y Media"
          : chart.type === "pie"
            ? "Proporciones y conteos válidos"
            : chart.type === "heatmap"
              ? "Escala divergente: azul positivo (+1) · rojo negativo (-1)"
              : chart.type === "scatter"
                ? `${String(chart.meta?.ylabel ?? "Y")} vs ${String(chart.meta?.xlabel ?? "X")}`
                : chart.type === "line"
                  ? "Serie temporal / evolución continua"
                  : isOr
                    ? "Línea de referencia = 1"
                    : isRefZero
                      ? "Línea base = 0"
                      : undefined;

  const handleCopyChart = async () => {
    if (!chartBoxRef.current) return;
    try {
      const outcome = await copyChartImageToClipboard(chartBoxRef.current, chart.title, subtitle);
      if (outcome === "copied") {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success("Gráfico copiado como imagen. Ya puedes pegarlo en Word.");
      } else {
        toast.info("El navegador restringió el portapapeles de imagen; se descargó el PNG para insertarlo en Word.");
      }
    } catch {
      toast.error("No se pudo copiar el gráfico.");
    }
  };

  const handleDownloadChart = async () => {
    if (!chartBoxRef.current) return;
    try {
      await downloadChartPng(chartBoxRef.current, chart.title, subtitle);
      toast.success("Gráfico descargado en PNG.");
    } catch {
      toast.error("No se pudo exportar el gráfico.");
    }
  };

  let body: React.ReactNode = null;

  if (chart.type === "survival") {
    body = (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={survivalData} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey={chart.x}
            tick={axisStyle}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            label={{ value: "Tiempo", position: "insideBottomRight", offset: -4, fontSize: 11, fill: "currentColor" }}
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
            tick={axisStyle}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
          />
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {showSurvivalCi &&
            hasSurvivalCi &&
            chart.series.map((s, idx) => (
              <Area
                key={`${s}-ci`}
                type="stepAfter"
                dataKey={`${s}__ciRange`}
                stroke="none"
                fill={COLORS[idx % COLORS.length]}
                fillOpacity={0.16}
                legendType="none"
                tooltipType="none"
                isAnimationActive={false}
              />
            ))}
          {chart.series.map((s, idx) => (
            <Line
              key={s}
              type="stepAfter"
              dataKey={s}
              name={s}
              stroke={COLORS[idx % COLORS.length]}
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    );
  } else if (chart.type === "roc") {
    body = (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chart.data} margin={{ top: 10, right: 16, left: 0, bottom: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            type="number"
            dataKey="fpr"
            domain={[0, 1]}
            tick={axisStyle}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            label={{
              value: "1 − Especificidad (FPR)",
              position: "insideBottom",
              offset: -6,
              fontSize: 11,
              fill: "currentColor",
            }}
          />
          <YAxis
            type="number"
            domain={[0, 1]}
            tick={axisStyle}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            label={{
              value: "Sensibilidad (TPR)",
              angle: -90,
              position: "insideLeft",
              fontSize: 11,
              fill: "currentColor",
            }}
          />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ]}
            stroke="#94A3B8"
            strokeDasharray="4 4"
            strokeWidth={1.5}
          />
          <Line
            type="monotone"
            dataKey="tpr"
            name="Sensibilidad"
            stroke="#0071E3"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  } else if (chart.type === "pie") {
    const valueKey = chart.series[0] || "n";
    const nameKey = chart.x || "category";
    const totalCount = chart.data.reduce((s, d) => s + Number(d[valueKey] ?? 0), 0);

    body = (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chart.data}
            dataKey={valueKey}
            nameKey={nameKey}
            cx="50%"
            cy="48%"
            innerRadius="46%"
            outerRadius="78%"
            paddingAngle={2}
            isAnimationActive={false}
            label={({ name, percent }) => `${String(name)} (${((percent ?? 0) * 100).toFixed(1)}%)`}
            labelLine={{ stroke: "rgba(148, 163, 184, 0.55)", strokeWidth: 1 }}
          >
            {chart.data.map((_, idx) => (
              <RechartsCell key={idx} fill={COLORS[idx % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(val: unknown, name: unknown) => {
              const num = Number(val ?? 0);
              const pct = totalCount > 0 ? ((num / totalCount) * 100).toFixed(1) : "0.0";
              return [`${num} (${pct}%)`, String(name)];
            }}
            contentStyle={{
              backgroundColor: "rgba(255,255,255,0.96)",
              borderRadius: "12px",
              border: "1px solid rgba(0,0,0,0.08)",
              fontSize: "12px",
              color: "#0F172A",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  } else if (chart.type === "heatmap") {
    const vars = chart.series;
    const n = vars.length;
    const cellSize = Math.max(46, Math.min(76, Math.floor(340 / Math.max(1, n))));
    const labelW = 110;
    const labelH = 38;
    const svgW = labelW + n * cellSize + 16;
    const svgH = labelH + n * cellSize + 16;

    const lookup = new Map<string, { r: number | null; p: number | null }>();
    for (const row of chart.data) {
      const k = `${String(row.rowVar)}::${String(row.colVar)}`;
      lookup.set(k, {
        r: row.r === null || row.r === undefined ? null : Number(row.r),
        p: row.p === null || row.p === undefined ? null : Number(row.p),
      });
    }

    body = (
      <div className="flex h-full w-full items-center justify-center overflow-auto">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          width={svgW}
          height={svgH}
          className="max-h-full max-w-full select-none"
          role="img"
          aria-label={chart.title}
        >
          {vars.map((v, idx) => (
            <text
              key={`col-${v}`}
              x={labelW + idx * cellSize + cellSize / 2}
              y={labelH - 10}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="currentColor"
            >
              {v.length > 10 ? `${v.slice(0, 9)}…` : v}
            </text>
          ))}

          {vars.map((rowVar, rIdx) => (
            <g key={`row-${rowVar}`}>
              <text
                x={labelW - 10}
                y={labelH + rIdx * cellSize + cellSize / 2 + 4}
                textAnchor="end"
                fontSize={11}
                fontWeight={600}
                fill="currentColor"
              >
                {rowVar.length > 14 ? `${rowVar.slice(0, 13)}…` : rowVar}
              </text>
              {vars.map((colVar, cIdx) => {
                const entry = lookup.get(`${rowVar}::${colVar}`) ?? { r: null, p: null };
                const { fill, text } = heatmapColor(entry.r);
                const xPos = labelW + cIdx * cellSize;
                const yPos = labelH + rIdx * cellSize;
                return (
                  <g key={`${rowVar}-${colVar}`}>
                    <rect
                      x={xPos + 2}
                      y={yPos + 2}
                      width={cellSize - 4}
                      height={cellSize - 4}
                      rx={8}
                      fill={fill}
                      stroke="rgba(148,163,184,0.22)"
                      strokeWidth={1}
                    >
                      <title>
                        {`${rowVar} × ${colVar}: r = ${entry.r !== null ? entry.r.toFixed(3) : "—"}${
                          entry.p !== null && rowVar !== colVar
                            ? ` (p = ${entry.p < 0.001 ? "<0.001" : entry.p.toFixed(3)})`
                            : ""
                        }`}
                      </title>
                    </rect>
                    <text
                      x={xPos + cellSize / 2}
                      y={yPos + cellSize / 2 + 4}
                      textAnchor="middle"
                      fontSize={11}
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
      </div>
    );
  } else if (chart.type === "histogram" || chart.type === "bar" || chart.type === "groupedbar") {
    body = (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chart.data} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis dataKey={chart.x} tick={axisStyle} tickLine={false} axisLine={{ stroke: gridColor }} />
          <YAxis tick={axisStyle} tickLine={false} axisLine={{ stroke: gridColor }} />
          <Tooltip content={<ChartTooltip />} />
          {chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {isOr && <ReferenceLine y={1} stroke="#DC2626" strokeDasharray="4 4" strokeWidth={1.5} />}
          {isRefZero && <ReferenceLine y={0} stroke="#64748B" strokeDasharray="3 3" strokeWidth={1.25} />}
          {chart.series.map((s, idx) => (
            <Bar
              key={s}
              dataKey={s}
              name={s === "count" ? "Frecuencia" : s}
              fill={COLORS[idx % COLORS.length]}
              radius={[6, 6, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  } else if (chart.type === "line") {
    body = (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chart.data} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey={chart.x} tick={axisStyle} tickLine={false} axisLine={{ stroke: gridColor }} />
          <YAxis tick={axisStyle} tickLine={false} axisLine={{ stroke: gridColor }} domain={["auto", "auto"]} />
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {isOr && <ReferenceLine y={1} stroke="#DC2626" strokeDasharray="4 4" strokeWidth={1.5} />}
          {isRefZero && <ReferenceLine y={0} stroke="#64748B" strokeDasharray="3 3" strokeWidth={1.25} />}
          {chart.series.map((s, idx) => {
            const isCiOrRef = s.includes("IC") || s === "Ideal";
            return (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                name={s}
                stroke={isCiOrRef ? "#94A3B8" : COLORS[idx % COLORS.length]}
                strokeWidth={isCiOrRef ? 1.5 : 2.25}
                strokeDasharray={isCiOrRef ? "4 4" : undefined}
                dot={isCiOrRef ? false : chart.data.length <= 45 ? { r: 2.5 } : false}
                connectNulls={false}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    );
  } else if (chart.type === "box") {
    const boxRows = chart.data.map((d) => ({
      ...d,
      iqrRange: [Number(d.q1 ?? 0), Number(d.q3 ?? 0)],
    }));

    body = (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={boxRows} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis dataKey="group" tick={axisStyle} tickLine={false} axisLine={{ stroke: gridColor }} />
          <YAxis tick={axisStyle} tickLine={false} axisLine={{ stroke: gridColor }} domain={["auto", "auto"]} />
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="iqrRange"
            name="Rango intercuartílico (Q1–Q3)"
            fill="#0071E3"
            fillOpacity={0.22}
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
            stroke="#059669"
            strokeWidth={0}
            dot={{ r: 4, fill: "#059669" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    );
  } else {
    const xmin = Number(chart.meta?.xmin ?? 0);
    const xmax = Number(chart.meta?.xmax ?? 0);
    const slope = Number(chart.meta?.slope ?? 0);
    const intercept = Number(chart.meta?.intercept ?? 0);
    const hasTrend = Number.isFinite(xmin) && Number.isFinite(xmax) && xmax > xmin;

    body = (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            type="number"
            dataKey="x"
            name={String(chart.meta?.xlabel ?? "X")}
            tick={axisStyle}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            domain={["auto", "auto"]}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={String(chart.meta?.ylabel ?? "Y")}
            tick={axisStyle}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            domain={["auto", "auto"]}
          />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<ChartTooltip />} />
          <Scatter
            name="Observaciones"
            data={chart.data}
            fill="#0071E3"
            fillOpacity={0.72}
            isAnimationActive={false}
          />
          {hasTrend && (
            <ReferenceLine
              segment={[
                { x: xmin, y: slope * xmin + intercept },
                { x: xmax, y: slope * xmax + intercept },
              ]}
              stroke="#EA580C"
              strokeWidth={2}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-12px_rgba(0,0,0,0.06)] dark:border-white/[0.08] dark:bg-[#141416]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">{chart.title}</h4>
          {subtitle && (
            <span
              className={
                chart.type === "roc"
                  ? "font-mono text-xs text-[#0071E3] dark:text-[#0A84FF]"
                  : "text-xs text-[#6E6E73] dark:text-[#98989D]"
              }
            >
              {subtitle}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {chart.type === "survival" && hasSurvivalCi && (
            <button
              type="button"
              onClick={() => setShowSurvivalCi((v) => !v)}
              data-testid="km-ci-toggle"
              aria-pressed={showSurvivalCi}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                showSurvivalCi
                  ? "border-[#0071E3]/40 bg-[#0071E3]/10 text-[#0071E3] dark:border-[#0A84FF]/50 dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]"
                  : "border-black/[0.08] bg-white text-[#6E6E73] hover:bg-[#F5F5F7] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#98989D]"
              }`}
              title="Mostrar u ocultar el sombreado del intervalo de confianza del 95%"
            >
              <span
                className="h-2.5 w-2.5 rounded-xs border"
                style={{
                  backgroundColor: showSurvivalCi ? "rgba(0, 113, 227, 0.28)" : "transparent",
                  borderColor: "#0071E3",
                }}
              />
              {showSurvivalCi ? "IC 95% sombreado" : "Sombrear IC 95%"}
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyChart}
            data-testid="copy-chart-btn"
            className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-[#F5F5F7] px-3 py-1 text-xs font-medium text-[#1D1D1F] transition-colors hover:bg-[#ECECEF] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-[#2C2C2E]"
            title="Copiar gráfico como imagen para pegar en Word"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copiado" : "Copiar gráfico"}
          </button>
          <button
            type="button"
            onClick={handleDownloadChart}
            data-testid="download-chart-btn"
            className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-white px-2.5 py-1 text-xs font-medium text-[#6E6E73] transition-colors hover:bg-[#F5F5F7] hover:text-[#1D1D1F] dark:border-white/[0.1] dark:bg-[#141416] dark:text-[#98989D] dark:hover:bg-[#1C1C1E]"
            title="Descargar gráfico en PNG"
          >
            <Download className="h-3.5 w-3.5" />
            PNG
          </button>
        </div>
      </div>

      <div ref={chartBoxRef} className="text-[#6E6E73] dark:text-[#98989D]" style={{ width: "100%", height }}>
        {body}
      </div>
    </div>
  );
}
