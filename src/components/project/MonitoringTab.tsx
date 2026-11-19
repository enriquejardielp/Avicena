import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileSignature,
  MessageSquare,
  Plus,
  Send,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { errMsg } from "../../lib/api.ts";
import { useAuth } from "../../lib/AuthContext.tsx";
import {
  createProtocolDeviation,
  listClinicalQueries,
  listElectronicSignatures,
  listProtocolDeviations,
  respondClinicalQuery,
  transitionClinicalQuery,
  updateProtocolDeviation,
} from "../../lib/firestoreDb.ts";
import {
  DEVIATION_SEVERITY_LABEL,
  DEVIATION_STATUS_LABEL,
  QUERY_STATUS_LABEL,
  type ClinicalQuery,
  type DeviationSeverity,
  type DeviationStatus,
  type ElectronicSignatureManifest,
  type ProtocolDeviation,
  type QueryStatus,
  type Role,
} from "../../lib/types.ts";
import { formatShortDate } from "../../lib/utils.ts";

const QUERY_STATUS_STYLE: Record<QueryStatus, string> = {
  abierta: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  respondida: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  correccion_solicitada: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  cerrada: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelada: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const DEVIATION_SEVERITY_STYLE: Record<DeviationSeverity, string> = {
  menor: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  mayor: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  critica: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

const DEVIATION_STATUS_STYLE: Record<DeviationStatus, string> = {
  abierta: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  en_investigacion: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  capa_en_curso: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  cerrada: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

export function MonitoringTab({ projectId, myRole }: { projectId: string; myRole: Role }) {
  const { user } = useAuth();
  const [queries, setQueries] = useState<ClinicalQuery[]>([]);
  const [deviations, setDeviations] = useState<ProtocolDeviation[]>([]);
  const [signatures, setSignatures] = useState<ElectronicSignatureManifest[]>([]);
  const [loading, setLoading] = useState(true);

  const [queryFilter, setQueryFilter] = useState<QueryStatus | "todas">("todas");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busyQueryId, setBusyQueryId] = useState<string | null>(null);

  // Protocol deviation creation form
  const [showNewDeviation, setShowNewDeviation] = useState(false);
  const [devTitle, setDevTitle] = useState("");
  const [devSubject, setDevSubject] = useState("");
  const [devSeverity, setDevSeverity] = useState<DeviationSeverity>("menor");
  const [devOccurredAt, setDevOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [devDetectedAt, setDevDetectedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [devDescription, setDevDescription] = useState("");
  const [devImpact, setDevImpact] = useState("");
  const [devCapa, setDevCapa] = useState("");
  const [devResponsible, setDevResponsible] = useState("");
  const [creatingDev, setCreatingDev] = useState(false);

  // Protocol deviation CAPA update editor
  const [editingDevId, setEditingDevId] = useState<string | null>(null);
  const [editDevStatus, setEditDevStatus] = useState<DeviationStatus>("en_investigacion");
  const [editDevCapa, setEditDevCapa] = useState("");
  const [editDevResolution, setEditDevResolution] = useState("");
  const [savingDev, setSavingDev] = useState(false);

  const canCloseQueries = myRole === "admin" || myRole === "coordinador" || myRole === "monitor_clinico";
  const canRespondQueries = ["admin", "coordinador", "investigador", "capturador"].includes(myRole);
  const canManageDeviations = ["admin", "coordinador", "investigador", "monitor_clinico"].includes(myRole);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [qList, dList, sList] = await Promise.all([
        listClinicalQueries(projectId),
        listProtocolDeviations(projectId),
        listElectronicSignatures(projectId),
      ]);
      setQueries(qList);
      setDeviations(dList);
      setSignatures(sList);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cargar el módulo de monitorización clínica."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const filteredQueries = useMemo(
    () => (queryFilter === "todas" ? queries : queries.filter((q) => q.status === queryFilter)),
    [queries, queryFilter]
  );

  const openQueryCount = useMemo(
    () => queries.filter((q) => q.status !== "cerrada" && q.status !== "cancelada").length,
    [queries]
  );

  const openDeviationCount = useMemo(
    () => deviations.filter((d) => d.status !== "cerrada").length,
    [deviations]
  );

  const handleReplyQuery = async (q: ClinicalQuery) => {
    if (!user) return;
    const draft = (replyDrafts[q.id] ?? "").trim();
    if (draft.length < 3) {
      toast.error("Escribe una respuesta clínica de al menos 3 caracteres.");
      return;
    }
    setBusyQueryId(q.id);
    try {
      await respondClinicalQuery(projectId, q.id, draft, user, myRole);
      setReplyDrafts((prev) => ({ ...prev, [q.id]: "" }));
      toast.success("Respuesta registrada en la query.");
      await loadAll();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo responder a la query."));
    } finally {
      setBusyQueryId(null);
    }
  };

  const handleTransitionQuery = async (
    q: ClinicalQuery,
    nextStatus: "correccion_solicitada" | "cerrada" | "cancelada"
  ) => {
    if (!user) return;
    const draft = (replyDrafts[q.id] ?? "").trim();
    const msg =
      draft.length >= 3
        ? draft
        : nextStatus === "cerrada"
          ? "Verificado en fuente y cerrado por monitorización."
          : nextStatus === "cancelada"
            ? "Query cancelada tras revisión."
            : "Se solicita revisión y corrección en CRF.";
    setBusyQueryId(q.id);
    try {
      await transitionClinicalQuery(projectId, q.id, nextStatus, msg, user, myRole);
      setReplyDrafts((prev) => ({ ...prev, [q.id]: "" }));
      toast.success(`Query actualizada a «${QUERY_STATUS_LABEL[nextStatus]}».`);
      await loadAll();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo actualizar la query."));
    } finally {
      setBusyQueryId(null);
    }
  };

  const handleCreateDeviation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCreatingDev(true);
    try {
      await createProtocolDeviation(
        projectId,
        {
          subjectPseudoId: devSubject.trim() || null,
          title: devTitle.trim(),
          description: devDescription.trim(),
          severity: devSeverity,
          occurredAt: devOccurredAt,
          detectedAt: devDetectedAt,
          impactAssessment: devImpact.trim() || "Pendiente de evaluación de impacto.",
          capaPlan: devCapa.trim() || "Plan CAPA en definición.",
          responsibleName: devResponsible.trim(),
        },
        user
      );
      toast.success("Desviación de protocolo registrada con trazabilidad.");
      setShowNewDeviation(false);
      setDevTitle("");
      setDevSubject("");
      setDevDescription("");
      setDevImpact("");
      setDevCapa("");
      setDevResponsible("");
      await loadAll();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo registrar la desviación."));
    } finally {
      setCreatingDev(false);
    }
  };

  const handleStartEditDeviation = (d: ProtocolDeviation) => {
    setEditingDevId(d.id);
    setEditDevStatus(d.status);
    setEditDevCapa(d.capa_plan);
    setEditDevResolution(d.resolution_notes ?? "");
  };

  const handleSaveDeviationUpdate = async (deviationId: string) => {
    if (!user) return;
    setSavingDev(true);
    try {
      await updateProtocolDeviation(
        projectId,
        deviationId,
        {
          status: editDevStatus,
          capaPlan: editDevCapa,
          resolutionNotes: editDevResolution,
        },
        user
      );
      toast.success("Desviación y plan CAPA actualizados.");
      setEditingDevId(null);
      await loadAll();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo actualizar la desviación."));
    } finally {
      setSavingDev(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
          <div className="flex items-center justify-between text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">
            <span>Queries abiertas / pendientes</span>
            <MessageSquare className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#1D1D1F] dark:text-[#F5F5F7]">
            {openQueryCount}
            <span className="ml-2 text-xs font-normal text-[#86868B]">de {queries.length} totales</span>
          </div>
        </div>

        <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
          <div className="flex items-center justify-between text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">
            <span>Desviaciones de protocolo activas</span>
            <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#1D1D1F] dark:text-[#F5F5F7]">
            {openDeviationCount}
            <span className="ml-2 text-xs font-normal text-[#86868B]">de {deviations.length} totales</span>
          </div>
        </div>

        <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
          <div className="flex items-center justify-between text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">
            <span>Aprobaciones electrónicas selladas</span>
            <FileSignature className="h-4 w-4 text-[#0071E3] dark:text-[#0A84FF]" />
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#1D1D1F] dark:text-[#F5F5F7]">
            {signatures.length}
          </div>
        </div>
      </div>

      {/* Section 1: Monitoring Queries */}
      <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-6 space-y-4 dark:border-white/[0.08] dark:bg-[#141416]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-heading text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
              Queries de monitorización clínica (SDV)
            </h3>
            <p className="mt-0.5 text-xs text-[#6E6E73] dark:text-[#98989D]">
              Las discrepancias sobre variables CRF se abren desde cada registro en <strong>Formularios CRF</strong> y se resuelven aquí con trazabilidad completa.
            </p>
          </div>
          <select
            aria-label="Filtrar queries por estado"
            value={queryFilter}
            onChange={(e) => setQueryFilter(e.target.value as QueryStatus | "todas")}
            className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3 py-1.5 text-xs font-medium text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
          >
            <option value="todas">Todas ({queries.length})</option>
            <option value="abierta">Abiertas</option>
            <option value="respondida">Respondidas por centro</option>
            <option value="correccion_solicitada">Corrección solicitada</option>
            <option value="cerrada">Cerradas</option>
            <option value="cancelada">Canceladas</option>
          </select>
        </div>

        {loading ? (
          <p className="py-6 text-center text-xs text-[#86868B]">Cargando queries de monitorización…</p>
        ) : !filteredQueries.length ? (
          <p className="py-8 text-center text-xs text-[#86868B]">
            No hay queries registradas en este filtro.
          </p>
        ) : (
          <div className="space-y-3">
            {filteredQueries.map((q) => {
              const isResolved = q.status === "cerrada" || q.status === "cancelada";
              const isBusy = busyQueryId === q.id;
              return (
                <div
                  key={q.id}
                  data-testid={`query-item-${q.id}`}
                  className="rounded-2xl border border-black/[0.06] bg-[#F5F5F7]/50 p-4 space-y-3 dark:border-white/[0.08] dark:bg-[#1C1C1E]/60"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                        {q.subject_pseudo_id || q.record_id}
                      </span>
                      <span className="text-[#6E6E73] dark:text-[#98989D]">· Variable:</span>
                      <span className="font-mono text-[#0071E3] dark:text-[#0A84FF]">{q.variable_name}</span>
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${QUERY_STATUS_STYLE[q.status]}`}>
                        {QUERY_STATUS_LABEL[q.status]}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-[#86868B]">
                      Abierta por {q.opened_by_name} · {formatShortDate(q.opened_at)}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {q.messages.map((m) => (
                      <div
                        key={m.id}
                        className="rounded-xl border border-black/[0.05] bg-white px-3.5 py-2.5 text-xs dark:border-white/[0.06] dark:bg-[#141416]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#86868B]">
                          <span>
                            <strong className="font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">{m.author_name}</strong>{" "}
                            ({m.author_role})
                          </span>
                          <span className="font-mono tabular-nums">{formatShortDate(m.created_at)}</span>
                        </div>
                        <p className="mt-1 text-[#424245] dark:text-[#D1D1D6]">{m.message}</p>
                      </div>
                    ))}
                  </div>

                  {!isResolved && (canRespondQueries || canCloseQueries) && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={replyDrafts[q.id] ?? ""}
                        onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder="Escribe una aclaración, motivo de corrección o comentario de cierre…"
                        disabled={isBusy}
                        className="min-w-[240px] flex-1 rounded-xl border border-black/[0.08] bg-white px-3.5 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.1] dark:bg-[#141416] dark:text-[#F5F5F7]"
                      />
                      {canRespondQueries && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleReplyQuery(q)}
                          className="inline-flex items-center gap-1 rounded-full bg-[#0071E3] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#0077ED] disabled:opacity-50 dark:bg-[#0A84FF]"
                        >
                          <Send className="h-3 w-3" />
                          Responder
                        </button>
                      )}
                      {canCloseQueries && (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleTransitionQuery(q, "correccion_solicitada")}
                            className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            Solicitar corrección
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleTransitionQuery(q, "cerrada")}
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Cerrar query
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: Protocol Deviations & CAPA */}
      <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-6 space-y-4 dark:border-white/[0.08] dark:bg-[#141416]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-heading text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
              Desviaciones de protocolo y acciones CAPA
            </h3>
            <p className="mt-0.5 text-xs text-[#6E6E73] dark:text-[#98989D]">
              Registro estructurado conforme a ICH E6(R3) de incumplimientos del protocolo, evaluación de impacto y plan de acciones correctivas/preventivas.
            </p>
          </div>
          {canManageDeviations && (
            <button
              type="button"
              onClick={() => setShowNewDeviation((v) => !v)}
              data-testid="toggle-new-deviation-btn"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white hover:bg-[#0077ED] dark:bg-[#0A84FF]"
            >
              <Plus className="h-3.5 w-3.5" />
              {showNewDeviation ? "Cerrar formulario" : "Registrar desviación"}
            </button>
          )}
        </div>

        {showNewDeviation && canManageDeviations && (
          <form
            onSubmit={(e) => void handleCreateDeviation(e)}
            className="rounded-2xl border border-black/[0.06] bg-[#F5F5F7]/70 p-4 space-y-3 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Título de la desviación *
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={devTitle}
                  onChange={(e) => setDevTitle(e.target.value)}
                  placeholder="Ej: Visita de seguimiento M6 fuera de ventana (+14 días)"
                  data-testid="deviation-title-input"
                  className="w-full rounded-xl border border-transparent bg-white px-3.5 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Severidad *
                </label>
                <select
                  value={devSeverity}
                  onChange={(e) => setDevSeverity(e.target.value as DeviationSeverity)}
                  className="w-full rounded-xl border border-transparent bg-white px-3 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                >
                  <option value="menor">Menor</option>
                  <option value="mayor">Mayor</option>
                  <option value="critica">Crítica / Grave</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Código pseudonimizado
                </label>
                <input
                  type="text"
                  value={devSubject}
                  onChange={(e) => setDevSubject(e.target.value)}
                  placeholder="SUBJ-..."
                  className="w-full rounded-xl border border-transparent bg-white px-3.5 py-2 font-mono text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Fecha ocurrencia *
                </label>
                <input
                  type="date"
                  required
                  value={devOccurredAt}
                  onChange={(e) => setDevOccurredAt(e.target.value)}
                  className="w-full rounded-xl border border-transparent bg-white px-3.5 py-2 font-mono text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Fecha detección *
                </label>
                <input
                  type="date"
                  required
                  value={devDetectedAt}
                  onChange={(e) => setDevDetectedAt(e.target.value)}
                  className="w-full rounded-xl border border-transparent bg-white px-3.5 py-2 font-mono text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Responsable CAPA *
                </label>
                <input
                  type="text"
                  required
                  value={devResponsible}
                  onChange={(e) => setDevResponsible(e.target.value)}
                  placeholder="Nombre del responsable"
                  data-testid="deviation-responsible-input"
                  className="w-full rounded-xl border border-transparent bg-white px-3.5 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Descripción de la desviación *
                </label>
                <textarea
                  rows={2}
                  required
                  minLength={5}
                  value={devDescription}
                  onChange={(e) => setDevDescription(e.target.value)}
                  placeholder="Hechos observados sin incluir PII directa"
                  data-testid="deviation-desc-input"
                  className="w-full rounded-xl border border-transparent bg-white px-3.5 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Evaluación de impacto clínico / seguridad
                </label>
                <textarea
                  rows={2}
                  value={devImpact}
                  onChange={(e) => setDevImpact(e.target.value)}
                  placeholder="Impacto en seguridad del sujeto o integridad del endpoint"
                  className="w-full rounded-xl border border-transparent bg-white px-3.5 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Plan CAPA (correctiva / preventiva)
                </label>
                <textarea
                  rows={2}
                  value={devCapa}
                  onChange={(e) => setDevCapa(e.target.value)}
                  placeholder="Acción de contención y prevención de recurrencia"
                  className="w-full rounded-xl border border-transparent bg-white px-3.5 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="submit"
                disabled={creatingDev}
                data-testid="deviation-submit-btn"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white hover:bg-[#0077ED] disabled:opacity-50"
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                {creatingDev ? "Guardando…" : "Guardar desviación"}
              </button>
            </div>
          </form>
        )}

        {!deviations.length ? (
          <p className="py-6 text-center text-xs text-[#86868B]">
            No se han registrado desviaciones de protocolo en este estudio.
          </p>
        ) : (
          <div className="space-y-3">
            {deviations.map((d) => {
              const isEditing = editingDevId === d.id;
              return (
                <div
                  key={d.id}
                  className="rounded-2xl border border-black/[0.06] bg-[#F5F5F7]/50 p-4 space-y-2.5 text-xs dark:border-white/[0.08] dark:bg-[#1C1C1E]/60"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">{d.title}</span>
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${DEVIATION_SEVERITY_STYLE[d.severity]}`}>
                        {DEVIATION_SEVERITY_LABEL[d.severity]}
                      </span>
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${DEVIATION_STATUS_STYLE[d.status]}`}>
                        {DEVIATION_STATUS_LABEL[d.status]}
                      </span>
                      {d.subject_pseudo_id && (
                        <span className="font-mono text-[11px] text-[#0071E3] dark:text-[#0A84FF]">
                          {d.subject_pseudo_id}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-[#86868B]">
                      Ocurrida: {d.occurred_at} · Detectada: {d.detected_at}
                    </span>
                  </div>

                  <p className="text-[#424245] dark:text-[#D1D1D6]">{d.description}</p>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 rounded-xl bg-white p-3 dark:bg-[#141416]">
                    <div>
                      <div className="text-[11px] font-semibold text-[#6E6E73]">Impacto</div>
                      <div className="mt-0.5 text-[#1D1D1F] dark:text-[#E5E5EA]">{d.impact_assessment || "—"}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-[#6E6E73]">CAPA ({d.responsible_name})</div>
                      <div className="mt-0.5 text-[#1D1D1F] dark:text-[#E5E5EA]">{d.capa_plan || "—"}</div>
                    </div>
                  </div>

                  {d.resolution_notes && !isEditing && (
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                      <strong>Resolución:</strong> {d.resolution_notes}
                    </div>
                  )}

                  {canManageDeviations && !isEditing && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleStartEditDeviation(d)}
                        className="rounded-full border border-black/[0.08] bg-white px-3 py-1 text-[11px] font-medium text-[#1D1D1F] hover:border-[#0071E3] dark:border-white/[0.1] dark:bg-[#141416] dark:text-[#F5F5F7]"
                      >
                        Actualizar estado / CAPA
                      </button>
                    </div>
                  )}

                  {isEditing && (
                    <div className="space-y-2.5 rounded-xl border border-[#0071E3]/30 bg-white p-3 dark:bg-[#141416]">
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-[#6E6E73]">Estado</label>
                          <select
                            value={editDevStatus}
                            onChange={(e) => setEditDevStatus(e.target.value as DeviationStatus)}
                            className="w-full rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3 py-1.5 text-xs dark:border-white/[0.1] dark:bg-[#1C1C1E]"
                          >
                            <option value="abierta">Abierta</option>
                            <option value="en_investigacion">En investigación</option>
                            <option value="capa_en_curso">CAPA en curso</option>
                            <option value="cerrada">Cerrada</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-[#6E6E73]">Plan CAPA</label>
                          <input
                            type="text"
                            value={editDevCapa}
                            onChange={(e) => setEditDevCapa(e.target.value)}
                            className="w-full rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3 py-1.5 text-xs dark:border-white/[0.1] dark:bg-[#1C1C1E]"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-[#6E6E73]">
                          Evidencia / notas de cierre
                        </label>
                        <input
                          type="text"
                          value={editDevResolution}
                          onChange={(e) => setEditDevResolution(e.target.value)}
                          placeholder="Documenta la verificación de eficacia CAPA"
                          className="w-full rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3 py-1.5 text-xs dark:border-white/[0.1] dark:bg-[#1C1C1E]"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingDevId(null)}
                          className="rounded-full border border-black/[0.08] px-3 py-1 text-[11px] font-medium"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={savingDev}
                          onClick={() => void handleSaveDeviationUpdate(d.id)}
                          className="rounded-full bg-[#0071E3] px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                        >
                          {savingDev ? "Guardando…" : "Guardar"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3: Electronic Signatures Register */}
      <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-6 space-y-3 dark:border-white/[0.08] dark:bg-[#141416]">
        <div>
          <h3 className="font-heading text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
            Registro de aprobaciones electrónicas reautenticadas ({signatures.length})
          </h3>
          <p className="mt-0.5 text-xs text-[#6E6E73] dark:text-[#98989D]">
            Cada verificación SDV, bloqueo o reapertura CRF y bloqueo de ciclo de vida genera una atestación HMAC-SHA256 tras reautenticación reciente.
          </p>
        </div>

        {!signatures.length ? (
          <p className="py-5 text-center text-xs text-[#86868B]">
            Todavía no hay aprobaciones electrónicas registradas en este estudio.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-black/[0.06] text-[11px] font-semibold text-[#6E6E73] dark:border-white/[0.08] dark:text-[#98989D]">
                  <th className="py-2 pr-3">Fecha UTC</th>
                  <th className="py-2 pr-3">Firmante</th>
                  <th className="py-2 pr-3">Recurso</th>
                  <th className="py-2 pr-3">Significado y motivo</th>
                  <th className="py-2">Atestación HMAC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                {signatures.map((sig) => (
                  <tr key={sig.id}>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-[11px] text-[#6E6E73]">
                      {formatShortDate(sig.signed_at_utc)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">{sig.signer_name}</div>
                      <div className="text-[11px] text-[#86868B]">{sig.signer_role}</div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px]">
                      {sig.target_type}:{sig.target_id}
                      {sig.target_version !== undefined ? ` v${sig.target_version}` : ""}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">{sig.meaning}</div>
                      <div className="text-[11px] text-[#6E6E73] dark:text-[#98989D]">{sig.reason}</div>
                    </td>
                    <td className="py-2.5 font-mono text-[11px] text-[#6E6E73]">
                      {sig.attestation_hash.slice(0, 14)}… ({sig.key_id})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
