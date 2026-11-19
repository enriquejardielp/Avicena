import { useRef, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
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

const PALETTE = ["#0071E3", "#10B981", "#F59E0B", "#6366F1", "#EC4899", "#0EA5E9"];

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
  payload?: Array<{ name?: string; value?: unknown; color?: string; payload?: Record<string, unknown> }>;
  label?: unknown;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const isBox = row && "q1" in row && "q3" in row && "median" in row;
  const isRoc = row && "cutoff" in row && "tpr" in row && "fpr" in row;

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
          {payload.map((entry, idx) => (
            <div key={idx} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color || PALETTE[0] }} />
                {entry.name || "Valor"}
              </span>
              <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatTick(entry.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatChart({ chart, height = 300 }: { chart: ResultChart; height?: number }) {
  const chartBoxRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);

  if (!chart.data || chart.data.length === 0) return null;

  const axisStyle = { fontSize: 11, fill: "currentColor" };
  const gridColor = "rgba(148, 163, 184, 0.22)";
  const isOr = chart.meta?.ref === 1 || chart.meta?.refline === 1;

  const subtitle =
    chart.type === "survival"
      ? "Estimador de Kaplan-Meier S(t)"
      : chart.type === "roc"
        ? `AUC = ${String(chart.meta?.auc ?? "—")}`
        : chart.type === "box"
          ? "Mediana, RIC (Q1–Q3) y Media"
          : chart.type === "scatter"
            ? `${String(chart.meta?.ylabel ?? "Y")} vs ${String(chart.meta?.xlabel ?? "X")}`
            : isOr
              ? "Línea de referencia = 1"
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
        <LineChart data={chart.data} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
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
          {chart.series.map((s, idx) => (
            <Line
              key={s}
              type="stepAfter"
              dataKey={s}
              name={s}
              stroke={PALETTE[idx % PALETTE.length]}
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
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
          {chart.series.map((s, idx) => (
            <Bar
              key={s}
              dataKey={s}
              name={s === "count" ? "Frecuencia" : s}
              fill={PALETTE[idx % PALETTE.length]}
              radius={[6, 6, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
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
            fillOpacity={0.68}
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

        <div className="flex items-center gap-1.5">
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
