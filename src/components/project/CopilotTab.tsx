import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, MessageSquareText, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiStream, errMsg } from "../../lib/api.ts";
import { copyMarkdownToClipboard } from "../../lib/clipboardExport.ts";
import type { AnalysisResult, ChatMessage, Dataset } from "../../lib/types.ts";
import { ResultView } from "../analysis/ResultView.tsx";

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;
        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={i} className="pt-1 font-heading text-sm font-semibold text-slate-900 dark:text-white">
              {renderInline(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h3 key={i} className="pt-1 font-heading text-base font-semibold text-slate-900 dark:text-white">
              {renderInline(trimmed.slice(3))}
            </h3>
          );
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
              <div>{renderInline(trimmed.slice(2))}</div>
            </div>
          );
        }
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, idx) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={idx} className="font-semibold text-slate-950 dark:text-white">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code
          key={idx}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-sky-800 dark:bg-slate-800 dark:text-sky-300"
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    return <span key={idx}>{p}</span>;
  });
}

interface CopilotTabProps {
  datasets: Dataset[];
  activeDatasetId: string;
  onSelectDataset: (id: string) => void;
  pendingPrompt?: string | null;
  onConsumePendingPrompt?: () => void;
}

export function CopilotTab({
  datasets,
  activeDatasetId,
  onSelectDataset,
  pendingPrompt,
  onConsumePendingPrompt,
}: CopilotTabProps) {
  const ds = datasets.find((d) => d.id === activeDatasetId) ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [streamText, setStreamText] = useState("");
  const [streamAnalysis, setStreamAnalysis] = useState<AnalysisResult | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const suggestedPrompts = useMemo(() => {
    if (!ds) return [];
    const cols = new Set(ds.variables.map((v) => v.name));
    if (cols.has("tiempo_meses") && cols.has("muerte")) {
      return [
        "¿Existe diferencia significativa de supervivencia según el brazo de tratamiento?",
        "Genera la Tabla 1 de características basales por brazo",
        "¿El estadio tumoral afecta la supervivencia global?",
      ];
    }
    if (cols.has("pas_basal") && cols.has("pas_12s")) {
      return [
        "Compara la PAS a las 12 semanas entre Placebo y Fármaco A",
        "Genera la Tabla 1 clínica por grupo de tratamiento",
        "Calcula la Odds Ratio de evento_cv según diabetes",
        "¿Qué factores predicen evento_cv en regresión logística multivariable?",
      ];
    }
    if (cols.has("pcr_basal") && cols.has("grupo_gravedad")) {
      return [
        "Compara la PCR basal entre grupos de gravedad (ANOVA / Kruskal-Wallis)",
        "Genera la Tabla 1 según grupo_gravedad",
        "¿Existe diferencia entre pcr_basal y pcr_6m (medidas pareadas)?",
      ];
    }
    return [
      "Resume las características principales con estadísticos descriptivos",
      "Genera la Tabla 1 de esta cohorte",
      "¿Qué pruebas estadísticas recomiendas para estas variables?",
    ];
  }, [ds]);

  useEffect(() => {
    if (!activeDatasetId) {
      setMessages([]);
      return;
    }
    apiGet<ChatMessage[]>(`/ai/messages/${activeDatasetId}`)
      .then((res) => setMessages(res))
      .catch(() => setMessages([]));
  }, [activeDatasetId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamText, streamAnalysis]);

  const sendMessage = async (textOverride?: string) => {
    const query = (textOverride ?? input).trim();
    if (!query || !ds || streaming) return;

    if (!textOverride) setInput("");
    const optimisticUser: ChatMessage = {
      id: `local-${Date.now()}`,
      dataset_id: ds.id,
      user_id: "me",
      role: "user",
      content: query,
      analysis: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setStreaming(true);
    setStatusText("Conectando con el bioestadístico IA…");
    setStreamText("");
    setStreamAnalysis(null);

    try {
      await apiStream(
        "/ai/chat",
        { dataset_id: ds.id, message: query },
        {
          onStatus: (txt) => setStatusText(txt),
          onAnalysis: (res) => setStreamAnalysis(res),
          onDelta: (delta) => setStreamText((prev) => prev + delta),
          onError: (errTxt) => toast.error(errTxt),
          onDone: (finalMsg) => {
            setMessages((prev) => [...prev, finalMsg]);
            setStreamText("");
            setStreamAnalysis(null);
            setStatusText("");
          },
        }
      );
    } catch (err) {
      const msg = errMsg(err, "Error al comunicarse con el asistente IA.");
      toast.error(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          dataset_id: ds.id,
          user_id: "me",
          role: "assistant",
          content: msg,
          analysis: streamAnalysis,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setStreaming(false);
      setStatusText("");
      setStreamText("");
      setStreamAnalysis(null);
    }
  };

  useEffect(() => {
    if (pendingPrompt && ds && !streaming) {
      const p = pendingPrompt;
      onConsumePendingPrompt?.();
      sendMessage(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, ds?.id]);

  const clearHistory = async () => {
    if (!ds) return;
    try {
      await apiDelete(`/ai/messages/${ds.id}`);
      setMessages([]);
      toast.success("Historial de conversación reiniciado.");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const exportMarkdown = () => {
    if (!ds || !messages.length) return;
    const md = messages
      .map((m) => `### ${m.role === "user" ? "Investigador" : "Avicena IA"}\n\n${m.content}`)
      .join("\n\n---\n\n");
    const blob = new Blob([`# Informe Bioestadístico · ${ds.name}\n\n${md}`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `informe_${ds.name.replace(/[^a-zA-Z0-9_-]+/g, "_")}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!ds) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        Carga una base de datos en Datos para consultar al Asistente IA.
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400">
            <MessageSquareText className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-heading text-sm font-semibold text-slate-900 dark:text-white">
              Copiloto Bioestadístico
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Planifica pruebas, ejecuta cálculos exactos e interpreta hallazgos clínicos
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={activeDatasetId}
            onChange={(e) => onSelectDataset(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} (N={d.n_rows})
              </option>
            ))}
          </select>

          {messages.length > 0 && (
            <>
              <button
                type="button"
                onClick={exportMarkdown}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" />
                Exportar .md
              </button>
              <button
                type="button"
                onClick={clearHistory}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                data-testid="clear-chat-btn"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Limpiar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Chat Transcript */}
      <div ref={scrollRef} className="max-h-[600px] min-h-[380px] overflow-y-auto p-4 sm:p-6 space-y-5">
        {messages.length === 0 && !streaming && (
          <div className="mx-auto max-w-xl py-8 text-center">
            <h4 className="font-heading text-base font-semibold text-slate-900 dark:text-white">
              Pregunta en lenguaje natural sobre «{ds.name}»
            </h4>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              El asistente elige la prueba adecuada, la ejecuta en el motor estadístico y redacta la interpretación clínica.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 text-left">
              {suggestedPrompts.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => sendMessage(p)}
                  data-testid={`copilot-preset-${idx}`}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs font-medium text-slate-700 hover:border-sky-300 hover:bg-sky-50/60 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:border-sky-800 dark:hover:bg-sky-950/30"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "user" ? (
              <div className="max-w-2xl rounded-2xl bg-sky-600 px-4 py-2.5 text-sm text-white dark:bg-sky-500">
                {m.content}
              </div>
            ) : (
              <div className="w-full max-w-4xl space-y-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-950/50">
                {m.analysis && <ResultView result={m.analysis} compact />}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Interpretación clínica
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await copyMarkdownToClipboard(m.content);
                          setCopiedMsgId(m.id);
                          setTimeout(() => setCopiedMsgId(null), 2000);
                          toast.success("Interpretación copiada para pegar en Word.");
                        } catch {
                          toast.error("No se pudo copiar el texto.");
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      {copiedMsgId === m.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedMsgId === m.id ? "Copiado" : "Copiar texto"}
                    </button>
                  </div>
                  <SimpleMarkdown text={m.content} />
                </div>
              </div>
            )}
          </div>
        ))}

        {streaming && (
          <div className="w-full max-w-4xl space-y-4 rounded-2xl border border-sky-200 bg-sky-50/40 p-4 sm:p-5 dark:border-sky-900/50 dark:bg-sky-950/20">
            {statusText && <div className="text-xs font-medium text-sky-700 dark:text-sky-300">{statusText}</div>}
            {streamAnalysis && <ResultView result={streamAnalysis} compact />}
            {streamText && <SimpleMarkdown text={streamText} />}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
        className="border-t border-slate-100 p-3 sm:p-4 dark:border-slate-800"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={streaming}
            placeholder="Ej: Compara la presión sistólica a las 12 semanas entre Placebo y Fármaco A…"
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            data-testid="copilot-input"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50 dark:bg-sky-500 dark:hover:bg-sky-600"
            data-testid="copilot-send-btn"
          >
            <Send className="h-4 w-4" />
            <span className="hidden sm:inline">Analizar</span>
          </button>
        </div>
      </form>
    </div>
  );
}
