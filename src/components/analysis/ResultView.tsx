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
      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-900/60 dark:bg-sky-950/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-base font-semibold text-slate-900 dark:text-white">{result.title}</h3>
            <p className="mt-1 font-mono text-sm tabular-nums text-sky-800 dark:text-sky-300">{result.summary}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyAll}
              data-testid="copy-result-btn"
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
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
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-slate-800"
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
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <h4 className="font-heading text-sm font-semibold text-slate-900 dark:text-slate-100">{tbl.title}</h4>
                <button
                  type="button"
                  onClick={() => handleCopyTable(idx)}
                  data-testid={`copy-table-btn-${idx}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
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
                    <tr className="border-b border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/50">
                      {tbl.columns.map((col, cIdx) => (
                        <th
                          key={cIdx}
                          className={`px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 ${
                            cIdx === 0 ? "text-left" : "text-right"
                          }`}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {tbl.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                        {row.map((cell, cIdx) => {
                          const numeric = cIdx > 0 || isNumericCell(cell);
                          const isSigP =
                            tbl.columns[cIdx]?.toLowerCase() === "p" &&
                            typeof cell === "string" &&
                            (cell.startsWith("<") || (Number.parseFloat(cell) < 0.05 && Number.parseFloat(cell) >= 0));
                          return (
                            <td
                              key={cIdx}
                              className={`px-3.5 py-2.5 ${
                                cIdx === 0 ? "text-left font-medium text-slate-900 dark:text-slate-100" : "text-right"
                              } ${numeric ? "font-mono tabular-nums" : ""} ${
                                isSigP
                                  ? "font-semibold text-emerald-700 dark:text-emerald-400"
                                  : "text-slate-700 dark:text-slate-300"
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
                <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-400">
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
