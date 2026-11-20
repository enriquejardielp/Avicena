import { useState } from "react";
import { AlertTriangle, BookOpen, Check, Copy, Download, FileCode2, MessageSquare, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { copyAnalysisToClipboard, copyMarkdownToClipboard, copySingleTableToClipboard } from "../../lib/clipboardExport.ts";
import type { AnalysisResult, Cell } from "../../lib/types.ts";
import { StatChart } from "../charts/StatChart.tsx";

function formatCell(v: Cell): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function isNumericCell(v: Cell): boolean {
  if (typeof v === "number") return true;
  if (typeof v !== "string") return false;
  const s = v.trim();
  return /^[-+]?\d+([.,]\d+)?%?$/.test(s) || /^<\s*0\.001$/.test(s);
}

interface ResultViewProps {
  result: AnalysisResult;
  compact?: boolean;
  showHistoricNotice?: boolean;
  onAskCopilot?: (summaryPrompt: string) => void;
}

export function ResultView({ result, compact = false, showHistoricNotice = false, onAskCopilot }: ResultViewProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedTableIdx, setCopiedTableIdx] = useState<number | null>(null);
  const [copiedCitations, setCopiedCitations] = useState(false);

  const assumptionWarnings = [
    ...(result.summary.includes("⚠") ? [result.summary.slice(result.summary.indexOf("⚠"))] : []),
    ...(result.tables ?? []).map((t) => t.note).filter((n) => n && n.includes("⚠")),
  ];

  const handleCopyAll = async () => {
    try {
      await copyAnalysisToClipboard(result);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
      toast.success("Resultado y tablas copiados. Pégalos directamente en Word.");
    } catch {
      toast.error("No se pudo copiar el resultado al portapapeles.");
    }
  };

  const handleCopyTable = async (idx: number) => {
    const tbl = result.tables?.[idx];
    if (!tbl) return;
    try {
      await copySingleTableToClipboard(tbl);
      setCopiedTableIdx(idx);
      setTimeout(() => setCopiedTableIdx(null), 2000);
      toast.success(`Tabla «${tbl.title}» copiada para pegar en Word.`);
    } catch {
      toast.error("No se pudo copiar la tabla.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-12px_rgba(0,0,0,0.06)] dark:border-white/[0.08] dark:bg-[#141416]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-base font-semibold text-[#1D1D1F] dark:text-white">{result.title}</h3>
            <p className="mt-1 font-mono text-sm tabular-nums text-[#0071E3] dark:text-[#0A84FF]">{result.summary}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyAll}
              data-testid="copy-result-btn"
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-[#F5F5F7] px-3.5 py-1.5 text-xs font-semibold text-[#1D1D1F] transition-colors hover:bg-[#ECECEF] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-[#2C2C2E]"
              title="Copiar título, resumen y todas las tablas con formato para Word"
            >
              {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedAll ? "Copiado" : "Copiar resultado"}
            </button>

            {onAskCopilot && (
              <button
                type="button"
                onClick={() =>
                  onAskCopilot(
                    `Interpreta clínicamente este resultado (${result.title}): ${result.summary}`
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0077ED] dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
                data-testid="ask-copilot-from-result"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Interpretar con IA
              </button>
            )}
          </div>
        </div>

        {assumptionWarnings.length > 0 && (
          <div
            data-testid="result-assumption-alert"
            className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-300/80 bg-amber-50/90 px-3.5 py-2.5 text-xs text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-0.5">
              <div className="font-semibold">Advertencia sobre supuestos paramétricos</div>
              <p className="leading-relaxed">{assumptionWarnings[0]}</p>
            </div>
          </div>
        )}

        {result.provenance ? (
          <div
            data-testid="result-provenance-panel"
            className={`mt-3 rounded-xl border px-3.5 py-3 text-xs ${
              result.provenance.verified_by_library
                ? "border-emerald-200/90 bg-emerald-50/60 text-emerald-950 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100"
                : "border-amber-200/90 bg-amber-50/60 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span className="font-semibold">
                  {result.provenance.verified_by_library
                    ? `Motor científico verificado (${result.provenance.runtime})`
                    : "Motor TS de transición (no verificado por librería externa)"}
                </span>
                <span className="font-mono text-[11px] opacity-80">
                  SHA-256 datos: {result.provenance.dataset_sha256.slice(0, 12)} · semilla: {result.provenance.seed}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {result.reproducible_script && (
                  <button
                    type="button"
                    data-testid="download-repro-script-btn"
                    onClick={() => {
                      try {
                        const blob = new Blob([result.reproducible_script!], { type: "text/x-python;charset=utf-8" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `avicena_${result.test}_${(result.provenance?.dataset_sha256 ?? "script").slice(0, 8)}.py`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        toast.success("Script reproducible .py descargado.");
                      } catch {
                        toast.error("No se pudo descargar el script Python.");
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-black/[0.1] bg-white/80 px-2.5 py-1 text-[11px] font-medium text-[#1D1D1F] transition hover:bg-white dark:border-white/[0.15] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                    title="Descargar script Python reproducible (Audit Trail)"
                  >
                    <Download className="h-3 w-3" />
                    <FileCode2 className="h-3 w-3" />
                    Script .py
                  </button>
                )}
                {result.provenance.libraries.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      const text = [
                        `Métodos y librerías empleadas (${result.provenance!.runtime}, spec ${result.provenance!.spec_version}, hash datos ${result.provenance!.dataset_sha256.slice(0, 12)}):`,
                        ...result.provenance!.libraries.map(
                          (l) => `- ${l.package} v${l.version}: ${l.method}. Referencia: ${l.citation}`
                        ),
                      ].join("\n");
                      try {
                        await copyMarkdownToClipboard(text);
                        setCopiedCitations(true);
                        setTimeout(() => setCopiedCitations(false), 2000);
                        toast.success("Citas metodológicas copiadas para el apartado de Métodos.");
                      } catch {
                        toast.error("No se pudieron copiar las citas.");
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-black/[0.1] bg-white/80 px-2.5 py-1 text-[11px] font-medium text-[#1D1D1F] transition hover:bg-white dark:border-white/[0.15] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                  >
                    {copiedCitations ? <Check className="h-3 w-3 text-emerald-600" /> : <BookOpen className="h-3 w-3" />}
                    {copiedCitations ? "Citas copiadas" : "Citar en manuscrito"}
                  </button>
                )}
              </div>
            </div>

            {!compact && result.provenance.libraries.length > 0 && (
              <div className="mt-2 space-y-1 text-[11px] leading-relaxed opacity-90">
                {result.provenance.libraries.map((lib, idx) => (
                  <div key={idx}>
                    <span className="font-mono font-semibold">
                      {lib.package} v{lib.version}
                    </span>
                    {" — "}
                    <span>{lib.method}.</span>{" "}
                    <span className="italic">{lib.citation}</span>
                  </div>
                ))}
              </div>
            )}
            {result.provenance.warnings && result.provenance.warnings.length > 0 && (
              <div className="mt-2 space-y-0.5 border-t border-black/[0.06] pt-1.5 text-[11px] opacity-85 dark:border-white/[0.08]">
                {result.provenance.warnings.map((w, idx) => (
                  <div key={idx}>• {w}</div>
                ))}
              </div>
            )}
          </div>
        ) : (
          showHistoricNotice && (
            <div className="mt-3 rounded-xl border border-black/[0.08] bg-[#F5F5F7]/80 px-3.5 py-2 text-[11px] text-[#6E6E73] dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-[#98989D]">
              Histórico (sin hash de procedencia): análisis guardado antes de incorporar la verificación criptográfica de dataset y citas de librerías.
            </div>
          )
        )}
      </div>

      {result.charts && result.charts.length > 0 && (
        <div className={compact ? "space-y-3" : "grid grid-cols-1 gap-4 lg:grid-cols-2"}>
          {result.charts.map((ch, idx) => (
            <div key={idx} className={result.charts.length === 1 && !compact ? "lg:col-span-2" : ""}>
              <StatChart chart={ch} height={compact ? 250 : 310} />
            </div>
          ))}
        </div>
      )}

      {result.tables && result.tables.length > 0 && (
        <div className="space-y-4">
          {result.tables.map((tbl, idx) => (
            <div
              key={idx}
              className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-12px_rgba(0,0,0,0.06)] dark:border-white/[0.08] dark:bg-[#141416]"
            >
              <div className="flex items-center justify-between gap-2 border-b border-black/[0.05] px-5 py-3.5 dark:border-white/[0.06]">
                <h4 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">{tbl.title}</h4>
                <button
                  type="button"
                  onClick={() => handleCopyTable(idx)}
                  data-testid={`copy-table-btn-${idx}`}
                  className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-[#F5F5F7] px-3 py-1 text-xs font-medium text-[#1D1D1F] transition-colors hover:bg-[#ECECEF] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-[#2C2C2E]"
                  title="Copiar tabla con formato para pegar en Word"
                >
                  {copiedTableIdx === idx ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedTableIdx === idx ? "Copiada" : "Copiar tabla"}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-black/[0.06] bg-[#F5F5F7]/70 dark:border-white/[0.06] dark:bg-white/[0.03]">
                      {tbl.columns.map((col, cIdx) => (
                        <th
                          key={cIdx}
                          className={`px-4 py-2.5 text-[11px] font-semibold tracking-wide text-[#6E6E73] dark:text-[#98989D] ${
                            cIdx === 0 ? "text-left" : "text-right"
                          }`}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                    {tbl.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                        {row.map((cell, cIdx) => {
                          const numeric = cIdx > 0 || isNumericCell(cell);
                          const isSigP =
                            tbl.columns[cIdx]?.toLowerCase() === "p" &&
                            typeof cell === "string" &&
                            (cell.startsWith("<") || (Number.parseFloat(cell) < 0.05 && Number.parseFloat(cell) >= 0));
                          return (
                            <td
                              key={cIdx}
                              className={`px-4 py-2.5 ${
                                cIdx === 0 ? "text-left font-medium text-[#1D1D1F] dark:text-white" : "text-right"
                              } ${numeric ? "font-mono tabular-nums" : ""} ${
                                isSigP
                                  ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                  : "text-[#424245] dark:text-[#D1D1D6]"
                              }`}
                            >
                              {formatCell(cell)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tbl.note && (
                <div
                  className={`border-t px-5 py-2.5 text-xs ${
                    tbl.note.includes("⚠")
                      ? "border-amber-200/80 bg-amber-50/70 font-medium text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200"
                      : "border-black/[0.05] bg-[#F5F5F7]/50 text-[#6E6E73] dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-[#98989D]"
                  }`}
                >
                  {tbl.note}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
