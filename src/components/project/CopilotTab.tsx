import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, MessageSquareText, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiStream, errMsg } from "../../lib/api.ts";
import { useAuth } from "../../lib/AuthContext.tsx";
import { copyMarkdownToClipboard } from "../../lib/clipboardExport.ts";
import {
  clearChatMessages,
  getDatasetWithRows,
  getStudyGovernance,
  listChatMessages,
  saveAnalysisToProject,
  saveChatMessage,
} from "../../lib/firestoreDb.ts";
import type { AnalysisResult, ChatMessage, Dataset, SavedAnalysis, StudyGovernance } from "../../lib/types.ts";
import { ResultView } from "../analysis/ResultView.tsx";

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-2 text-sm leading-relaxed text-[#1D1D1F] dark:text-[#E5E5EA]">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;
        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={i} className="pt-1 font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
              {renderInline(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h3 key={i} className="pt-1 font-heading text-base font-semibold text-[#1D1D1F] dark:text-white">
              {renderInline(trimmed.slice(3))}
            </h3>
          );
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={i} className="flex gap-2.5 pl-1">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0071E3] dark:bg-[#0A84FF]" />
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
        <strong key={idx} className="font-semibold text-[#1D1D1F] dark:text-white">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code
          key={idx}
          className="rounded-md bg-[#F5F5F7] px-1.5 py-0.5 font-mono text-xs text-[#0071E3] dark:bg-white/[0.08] dark:text-[#0A84FF]"
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    return <span key={idx}>{p}</span>;
  });
}

interface CopilotTabProps {
  projectId: string;
  datasets: Dataset[];
  activeDatasetId: string;
  onSelectDataset: (id: string) => void;
  pendingPrompt?: string | null;
  onConsumePendingPrompt?: () => void;
  onAnalysisSaved?: (saved: SavedAnalysis) => void;
}

export function CopilotTab({
  projectId,
  datasets,
  activeDatasetId,
  onSelectDataset,
  pendingPrompt,
  onConsumePendingPrompt,
  onAnalysisSaved,
}: CopilotTabProps) {
  const { user } = useAuth();
  const ds = datasets.find((d) => d.id === activeDatasetId) ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [governance, setGovernance] = useState<StudyGovernance | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [streamText, setStreamText] = useState("");
  const [streamAnalysis, setStreamAnalysis] = useState<AnalysisResult | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const aiAuthorized = Boolean(
    governance?.ai_enabled && governance?.ai_allow_dataset_context && governance?.ai_dpa_confirmed
  );

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
    void getStudyGovernance(projectId).then(setGovernance).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!activeDatasetId || !user) {
      setMessages([]);
      return;
    }
    listChatMessages(projectId, activeDatasetId, user)
      .then((res) => setMessages(res))
      .catch(() => setMessages([]));
  }, [projectId, activeDatasetId, user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamText, streamAnalysis]);

  const sendMessage = async (textOverride?: string) => {
    const query = (textOverride ?? input).trim();
    if (!query || !ds || streaming || !user || !aiAuthorized) return;

    if (!textOverride) setInput("");
    const optimisticUser: ChatMessage = {
      id: `local-${Date.now()}`,
      dataset_id: ds.id,
      user_id: user.uid,
      role: "user",
      content: query,
      analysis: null,
      created_at: new Date().toISOString(),
    };
    const pastForPrompt = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, optimisticUser]);
    setStreaming(true);
    setStatusText("Cargando datos de la cohorte…");
    setStreamText("");
    setStreamAnalysis(null);

    let capturedAnalysis: AnalysisResult | null = null;
    let capturedDoneMsg: ChatMessage | null = null;

    try {
      if (user.emailVerified) {
        void saveChatMessage(projectId, ds.id, "user", query, null, user).catch(() => {});
      }

      const { dataset: freshDs, rows } = await getDatasetWithRows(projectId, ds);
      setStatusText("Conectando con el bioestadístico IA…");

      await apiStream(
        "/ai/chat",
        { projectId, dataset: freshDs, rows, pastMessages: pastForPrompt, message: query },
        {
          onStatus: (txt) => setStatusText(txt),
          onAnalysis: (res) => {
            capturedAnalysis = res;
            setStreamAnalysis(res);
          },
          onDelta: (delta) => setStreamText((prev) => prev + delta),
          onError: (errTxt) => toast.error(errTxt),
          onDone: (finalMsg) => {
            capturedDoneMsg = finalMsg;
          },
        }
      );

      if (capturedDoneMsg) {
        const finalMsg: ChatMessage = capturedDoneMsg;
        const resolvedAnalysis = finalMsg.analysis ?? capturedAnalysis;
        setMessages((prev) => [...prev, { ...finalMsg, analysis: resolvedAnalysis }]);

        if (user.emailVerified) {
          void saveChatMessage(projectId, ds.id, "assistant", finalMsg.content, resolvedAnalysis, user).catch(() => {});
          if (resolvedAnalysis) {
            try {
              const saved = await saveAnalysisToProject(
                projectId,
                freshDs,
                resolvedAnalysis,
                { source: "copilot", interpretation: finalMsg.content },
                user
              );
              onAnalysisSaved?.(saved);
              toast.success("Análisis del asistente guardado automáticamente en «Análisis guardados».");
            } catch {
              // Non-fatal
            }
          }
        }
      }
    } catch (err) {
      const msg = errMsg(err, "Error al comunicarse con el asistente IA.");
      toast.error(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          dataset_id: ds.id,
          user_id: user.uid,
          role: "assistant",
          content: msg,
          analysis: capturedAnalysis,
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
      void sendMessage(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, ds?.id]);

  const clearHistory = async () => {
    if (!ds || !user) return;
    try {
      await clearChatMessages(projectId, ds.id, user);
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
      <div className="apple-card rounded-3xl border border-dashed border-black/[0.12] bg-white p-14 text-center text-sm text-[#6E6E73] dark:border-white/[0.12] dark:bg-[#141416] dark:text-[#98989D]">
        Carga una base de datos en Datos para consultar al Asistente IA.
      </div>
    );
  }

  return (
    <div className="apple-card flex flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.08] dark:bg-[#141416]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.05] px-5 py-3.5 dark:border-white/[0.06]">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0071E3]/10 text-[#0071E3] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]">
            <MessageSquareText className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
              Asistente Bioestadístico
            </h3>
            <p className="text-xs text-[#6E6E73] dark:text-[#98989D]">
              Elige la prueba estadística adecuada, ejecuta cálculos exactos e interpreta los hallazgos
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={activeDatasetId}
            onChange={(e) => onSelectDataset(e.target.value)}
            className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3 py-1.5 text-xs font-medium text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
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
                className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-[#1D1D1F] transition hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
              >
                <Download className="h-3.5 w-3.5 text-[#6E6E73] dark:text-[#98989D]" />
                Exportar .md
              </button>
              <button
                type="button"
                onClick={() => void clearHistory()}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-[#1D1D1F] transition hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
                data-testid="clear-chat-btn"
              >
                <Trash2 className="h-3.5 w-3.5 text-[#6E6E73] dark:text-[#98989D]" />
                Limpiar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Study AI Governance Banner */}
      {governance && !aiAuthorized && (
        <div
          className="border-b border-amber-200/80 bg-amber-50/80 px-5 py-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          data-testid="copilot-governance-notice"
        >
          <strong>Asistente IA desactivado por defecto en este estudio.</strong> Para proteger la confidencialidad clínica, un administrador del estudio debe habilitarlo y confirmar el acuerdo DPA en la pestaña <strong>Equipo y gobernanza</strong>.
        </div>
      )}

      {/* Chat Transcript */}
      <div ref={scrollRef} className="max-h-[600px] min-h-[400px] overflow-y-auto p-5 sm:p-6 space-y-5">
        {messages.length === 0 && !streaming && (
          <div className="mx-auto max-w-xl py-10 text-center">
            <h4 className="font-heading text-lg font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
              Pregunta en lenguaje natural sobre «{ds.name}»
            </h4>
            <p className="mt-1.5 text-xs text-[#6E6E73] dark:text-[#98989D]">
              Selecciona la prueba adecuada, calcula el resultado real sobre tu cohorte y redacta la interpretación clínica. No incluyas datos identificativos en tus preguntas.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-left">
              {suggestedPrompts.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={!aiAuthorized}
                  onClick={() => void sendMessage(p)}
                  data-testid={`copilot-preset-${idx}`}
                  className="rounded-2xl border border-black/[0.06] bg-[#F5F5F7]/70 p-3.5 text-xs font-medium leading-relaxed text-[#1D1D1F] transition-all hover:border-[#0071E3]/40 hover:bg-[#0071E3]/[0.05] disabled:opacity-50 dark:border-white/[0.08] dark:bg-[#1C1C1E]/80 dark:text-[#E5E5EA] dark:hover:border-[#0A84FF]/40 dark:hover:bg-[#0A84FF]/[0.08]"
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
              <div className="max-w-2xl rounded-2xl bg-[#0071E3] px-4 py-2.5 text-sm text-white dark:bg-[#0A84FF]">
                {m.content}
              </div>
            ) : (
              <div className="w-full max-w-4xl space-y-4 rounded-2xl border border-black/[0.06] bg-[#F5F5F7]/60 p-4 sm:p-5 dark:border-white/[0.08] dark:bg-[#1C1C1E]/60">
                {m.analysis && <ResultView result={m.analysis} compact />}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#86868B] dark:text-[#98989D]">
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
                      className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3 py-1 text-xs font-medium text-[#1D1D1F] transition hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#141416] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
                    >
                      {copiedMsgId === m.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-[#6E6E73] dark:text-[#98989D]" />
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
          <div className="w-full max-w-4xl space-y-4 rounded-2xl border border-[#0071E3]/25 bg-[#0071E3]/[0.04] p-4 sm:p-5 dark:border-[#0A84FF]/30 dark:bg-[#0A84FF]/[0.06]">
            {statusText && <div className="text-xs font-medium text-[#0071E3] dark:text-[#0A84FF]">{statusText}</div>}
            {streamAnalysis && <ResultView result={streamAnalysis} compact />}
            {streamText && <SimpleMarkdown text={streamText} />}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage();
        }}
        className="border-t border-black/[0.05] p-3.5 sm:p-4 dark:border-white/[0.06]"
      >
        <div className="flex gap-2.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={streaming || !aiAuthorized}
            placeholder={
              aiAuthorized
                ? "Ej: Compara la presión sistólica a las 12 semanas entre Placebo y Fármaco A…"
                : "Habilita la IA en Equipo y gobernanza para consultar al asistente…"
            }
            className="flex-1 rounded-full border border-transparent bg-[#F5F5F7] px-4 py-2.5 text-sm text-[#1D1D1F] placeholder:text-[#86868B] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:placeholder:text-[#6E6E73] dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15"
            data-testid="copilot-input"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim() || !aiAuthorized}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0077ED] disabled:opacity-50 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
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
