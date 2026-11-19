import { useState } from "react";
import { Check, Copy, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { copyAnalysisToClipboard, copySingleTableToClipboard } from "../../lib/clipboardExport.ts";
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
  onAskCopilot?: (summaryPrompt: string) => void;
}

export function ResultView({ result, compact = false, onAskCopilot }: ResultViewProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedTableIdx, setCopiedTableIdx] = useState<number | null>(null);

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
                <div className="border-t border-black/[0.05] bg-[#F5F5F7]/50 px-5 py-2.5 text-xs text-[#6E6E73] dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-[#98989D]">
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
