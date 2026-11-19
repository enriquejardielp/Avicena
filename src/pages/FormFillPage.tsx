import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  History,
  Lock,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { FieldInput } from "../components/forms/FieldInput.tsx";
import { AppShell } from "../components/layout/AppShell.tsx";
import { ElectronicApprovalModal } from "../components/project/ElectronicApprovalModal.tsx";
import { apiPost, errMsg } from "../lib/api.ts";
import { useAuth } from "../lib/AuthContext.tsx";
import {
  createClinicalQuery,
  createFormRecord,
  findFormProjectId,
  getDatasetSummary,
  getForm,
  getProject,
  getStudyGovernance,
  getStudyLifecycle,
  listClinicalQueries,
  listFormRecords,
  listRecordVersions,
  listVaultSubjects,
  reopenFormRecord,
  transitionFormRecordStatus,
  updateFormRecord,
} from "../lib/firestoreDb.ts";
import { Link } from "../lib/router.tsx";
import {
  CONSENT_STATUS_LABEL,
  CRF_STATUS_LABEL,
  STUDY_STATUS_LABEL,
  type ClinicalQuery,
  type CrfRecordStatus,
  type CrfVersionEntry,
  type Dataset,
  type Form,
  type FormExtractResponse,
  type RecordOut,
  type Role,
  type StudyGovernance,
  type StudyLifecycle,
  type VaultSubjectSummary,
} from "../lib/types.ts";
import { formatShortDate } from "../lib/utils.ts";

function isFieldEmpty(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "string") return val.trim() === "";
  if (Array.isArray(val)) return val.length === 0;
  return false;
}

const CRF_STATUS_STYLE: Record<CrfRecordStatus, string> = {
  borrador: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  completado: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  enviado: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  verificado: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  bloqueado: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
};

export default function FormFillPage({ projectId, formId }: { projectId?: string; formId: string }) {
  const { user } = useAuth();
  const [resolvedProjectId, setResolvedProjectId] = useState(projectId ?? "");
  const [myRole, setMyRole] = useState<Role>("capturador");
  const [canVerify, setCanVerify] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [linkedDataset, setLinkedDataset] = useState<Dataset | null>(null);
  const [records, setRecords] = useState<RecordOut[]>([]);
  const [vaultSubjects, setVaultSubjects] = useState<VaultSubjectSummary[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [subjectPseudoId, setSubjectPseudoId] = useState("");
  const [crfStatus, setCrfStatus] = useState<"borrador" | "completado" | "enviado">("completado");
  const [editReason, setEditReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Editing existing patient record
  const [editingRecord, setEditingRecord] = useState<RecordOut | null>(null);

  // Version history modal
  const [versionsTarget, setVersionsTarget] = useState<RecordOut | null>(null);
  const [versionsList, setVersionsList] = useState<CrfVersionEntry[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  // Status transition / reopen modal (re-authenticated electronic approval)
  const [actionTarget, setActionTarget] = useState<{
    record: RecordOut;
    type: "verificado" | "bloqueado" | "reopen";
  } | null>(null);

  // Study lifecycle & monitoring queries
  const [studyLifecycle, setStudyLifecycle] = useState<StudyLifecycle | null>(null);
  const [formQueries, setFormQueries] = useState<ClinicalQuery[]>([]);
  const [queryTarget, setQueryTarget] = useState<RecordOut | null>(null);
  const [queryVariable, setQueryVariable] = useState("");
  const [queryMessage, setQueryMessage] = useState("");
  const [creatingQuery, setCreatingQuery] = useState(false);

  // AI clinical free-text extraction
  const [governance, setGovernance] = useState<StudyGovernance | null>(null);
  const [deidentifiedConfirmed, setDeidentifiedConfirmed] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [aiFilledKeys, setAiFilledKeys] = useState<Set<string>>(new Set());
  const [aiNotes, setAiNotes] = useState("");

  const isStudyClosedForCapture = Boolean(
    studyLifecycle && ["cerrado", "bloqueado", "archivado"].includes(studyLifecycle.study_status)
  );
  const isStudyFrozen = Boolean(
    studyLifecycle && ["bloqueado", "archivado"].includes(studyLifecycle.study_status)
  );
  const canCapture = ["admin", "coordinador", "investigador", "capturador"].includes(myRole) && !isStudyClosedForCapture;
  const canReopen = (myRole === "admin" || myRole === "coordinador") && !isStudyFrozen;
  const canOpenQuery = myRole === "admin" || myRole === "coordinador" || myRole === "monitor_clinico";

  const aiExtractAuthorized = Boolean(
    canCapture && governance?.ai_enabled && governance?.ai_allow_clinical_text && governance?.ai_dpa_confirmed
  );

  const loadData = async () => {
    if (!user) return;
    try {
      const pid = resolvedProjectId || projectId || (await findFormProjectId(formId, user));
      if (!pid) {
        throw new Error("No se encontró el estudio asociado a este formulario.");
      }
      setResolvedProjectId(pid);
      const [projRes, fRes, govRes, lcRes] = await Promise.all([
        getProject(pid, user),
        getForm(pid, formId),
        getStudyGovernance(pid),
        getStudyLifecycle(pid),
      ]);
      const [recRes, dsRes, subjRes, qRes] = await Promise.all([
        listFormRecords(pid, formId, user, projRes.my_role),
        projRes.my_role !== "capturador" ? getDatasetSummary(pid, fRes.dataset_id).catch(() => null) : Promise.resolve(null),
        listVaultSubjects(pid, Boolean(projRes.can_access_identity_vault)).catch(() => [] as VaultSubjectSummary[]),
        listClinicalQueries(pid, { formId }).catch(() => [] as ClinicalQuery[]),
      ]);
      setMyRole(projRes.my_role);
      setCanVerify(Boolean(projRes.can_verify_crf));
      setForm(fRes);
      setGovernance(govRes);
      setStudyLifecycle(lcRes);
      setRecords(recRes);
      setLinkedDataset(dsRes);
      setVaultSubjects(subjRes);
      setFormQueries(qRes);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cargar el cuaderno CRF."));
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, projectId, user?.uid]);

  const handleExtractFromText = async () => {
    if (!form || !resolvedProjectId) return;
    if (!aiExtractAuthorized) {
      toast.error("La extracción con IA externa está desactivada por la gobernanza del estudio.");
      return;
    }
    if (!deidentifiedConfirmed) {
      toast.error("Confirma que el texto está desidentificado antes de enviarlo al servicio de IA.");
      return;
    }
    if (freeText.trim().length < 5) {
      toast.error("Pega primero un texto clínico con información del paciente.");
      return;
    }
    setExtracting(true);
    try {
      const res = await apiPost<FormExtractResponse>("/forms/extract", {
        projectId: resolvedProjectId,
        formId: form.id,
        formName: form.name,
        fields: form.fields,
        freeText: freeText.trim(),
        currentValues: values,
        deidentifiedConfirmed,
      });

      const appliedKeys: string[] = [];
      setValues((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(res.appliedValues)) {
          if (isFieldEmpty(prev[k]) && !isFieldEmpty(v)) {
            next[k] = v;
            appliedKeys.push(k);
          }
        }
        return next;
      });

      if (appliedKeys.length > 0) {
        setAiFilledKeys((prev) => {
          const next = new Set(prev);
          for (const k of appliedKeys) next.add(k);
          return next;
        });
        setAiNotes(res.notes || "");
        toast.success(`Se detectaron ${appliedKeys.length} variables en campos vacíos. Revísalas antes de guardar.`);
      } else {
        setAiNotes(res.notes || "");
        toast.info("No se encontraron nuevos campos vacíos que rellenar con seguridad.");
      }
    } catch (err) {
      toast.error(errMsg(err, "No se pudo analizar el texto clínico con IA."));
    } finally {
      setExtracting(false);
    }
  };

  const handleStartEditRecord = (rec: RecordOut) => {
    if (!form || !canCapture) return;
    if (rec.status === "verificado" || rec.status === "bloqueado") {
      toast.error(
        `El registro está en estado «${CRF_STATUS_LABEL[rec.status]}». Un Coordinador o IP debe reabrirlo primero.`
      );
      return;
    }
    const initial: Record<string, unknown> = {};
    for (const field of form.fields) {
      const val = rec.data[field.name];
      if (field.type === "checkbox" && typeof val === "string") {
        initial[field.name] = val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        initial[field.name] = val ?? "";
      }
    }
    setEditingRecord(rec);
    setSubjectPseudoId(rec.subject_pseudo_id ?? "");
    const st = rec.status;
    setCrfStatus(st === "borrador" || st === "enviado" ? st : "completado");
    setEditReason("");
    setValues(initial);
    setAiFilledKeys(new Set());
    setAiNotes("");
  };

  const handleCancelEdit = () => {
    setEditingRecord(null);
    setSubjectPseudoId("");
    setCrfStatus("completado");
    setEditReason("");
    setValues({});
    setAiFilledKeys(new Set());
    setAiNotes("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !user || !resolvedProjectId || !canCapture) return;
    if (editingRecord && editReason.trim().length < 5) {
      toast.error("Indica un motivo de modificación (mínimo 5 caracteres) para conservar el historial.");
      return;
    }
    setSubmitting(true);
    try {
      if (editingRecord) {
        await updateFormRecord(resolvedProjectId, form, editingRecord.id, values, user, myRole, {
          reason: editReason.trim(),
          status: crfStatus,
          subjectPseudoId: subjectPseudoId.trim() || null,
        });
        toast.success("Cambios del paciente guardados con nueva versión trazada.");
        setEditingRecord(null);
      } else {
        await createFormRecord(resolvedProjectId, form, values, user, myRole, {
          subjectPseudoId: subjectPseudoId.trim() || null,
          status: crfStatus,
        });
        toast.success("Registro clínico guardado y sincronizado con la base de datos.");
      }
      setValues({});
      setSubjectPseudoId("");
      setCrfStatus("completado");
      setEditReason("");
      setFreeText("");
      setAiFilledKeys(new Set());
      setAiNotes("");
      await loadData();
    } catch (err) {
      toast.error(errMsg(err, "Error de validación clínica al guardar el registro."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenVersions = async (rec: RecordOut) => {
    if (!resolvedProjectId) return;
    setVersionsTarget(rec);
    setLoadingVersions(true);
    try {
      const vers = await listRecordVersions(resolvedProjectId, rec.id);
      setVersionsList(vers);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cargar el historial de versiones."));
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleCreateQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !resolvedProjectId || !form || !queryTarget) return;
    setCreatingQuery(true);
    try {
      await createClinicalQuery(
        resolvedProjectId,
        {
          recordId: queryTarget.id,
          formId: form.id,
          subjectPseudoId: queryTarget.subject_pseudo_id ?? null,
          variableName: queryVariable || form.fields[0]?.name || "general",
          message: queryMessage,
        },
        user,
        myRole
      );
      toast.success("Query de monitorización abierta.");
      setQueryTarget(null);
      setQueryMessage("");
      await loadData();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo abrir la query."));
    } finally {
      setCreatingQuery(false);
    }
  };

  const openQueryCountByRecord = new Map<string, number>();
  for (const q of formQueries) {
    if (q.status !== "cerrada" && q.status !== "cancelada") {
      openQueryCountByRecord.set(q.record_id, (openQueryCountByRecord.get(q.record_id) ?? 0) + 1);
    }
  }

  const matchedConsentSubject = vaultSubjects.find(
    (s) => s.subject_pseudo_id === subjectPseudoId.trim()
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-6">
        {form && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <Link
                to={`/proyectos/${form.project_id}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6E6E73] transition-colors hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Volver al estudio
              </Link>
              <h1 className="mt-1.5 font-heading text-2xl font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                {form.name}
              </h1>
              {form.description && (
                <p className="mt-0.5 text-sm text-[#6E6E73] dark:text-[#98989D]">{form.description}</p>
              )}
              {linkedDataset && (
                <p className="mt-1 text-xs text-[#6E6E73] dark:text-[#98989D]">
                  Base vinculada:{" "}
                  <strong className="font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">{linkedDataset.name}</strong>
                  {" · "}
                  <span className="font-mono tabular-nums">{linkedDataset.n_rows}</span> registros totales en la base
                </p>
              )}
            </div>
            <div className="apple-card rounded-2xl border border-black/[0.06] bg-white px-5 py-2.5 text-right dark:border-white/[0.08] dark:bg-[#141416]">
              <div className="font-mono text-xl font-semibold tabular-nums text-[#1D1D1F] dark:text-[#F5F5F7]">
                {records.length}
              </div>
              <div className="text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                {linkedDataset?.source === "upload" ? "Añadidos vía CRF" : "Pacientes capturados"}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column: Capture/Edit Form (or Lifecycle / Monitor Read-Only Notice) */}
          <div className="lg:col-span-7 space-y-5">
            {isStudyClosedForCapture ? (
              <div className="apple-card rounded-2xl border border-amber-300/70 bg-amber-50/70 p-6 space-y-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4" />
                  Estudio en fase «{studyLifecycle ? STUDY_STATUS_LABEL[studyLifecycle.study_status] : "Cerrado"}» — Captura bloqueada
                </div>
                <p className="text-xs leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                  El ciclo de vida del estudio impide crear o modificar registros CRF. Un Coordinador o Investigador Principal debe cambiar el estado del estudio en <strong>Equipo y gobernanza</strong> para reabrir la captura.
                </p>
              </div>
            ) : !canCapture ? (
              <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-6 space-y-2 dark:border-white/[0.08] dark:bg-[#141416]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Modo Monitorización Clínica (CRA) — Solo lectura y verificación
                </div>
                <p className="text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                  Como Monitor Clínico puedes revisar los registros CRF capturados, abrir queries sobre variables, inspeccionar el historial de versiones y firmar electrónicamente verificaciones SDV o bloqueos, sin modificar datos clínicos directamente.
                </p>
              </div>
            ) : (
              <>
                {/* Free-text AI Clinical Extraction Panel */}
                <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 space-y-3.5 dark:border-white/[0.08] dark:bg-[#141416]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0071E3]/10 text-[#0071E3] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div>
                        <h2 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                          Autocompletar desde texto clínico libre
                        </h2>
                        <p className="mt-0.5 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                          Pega una nota clínica o informe de alta. Solo se rellenarán los campos vacíos sin sobrescribir lo que ya hayas escrito.
                        </p>
                      </div>
                    </div>
                  </div>

                  {governance && !aiExtractAuthorized && (
                    <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                      <strong>Extracción IA desactivada por defecto en este estudio.</strong> Un administrador debe habilitarla y confirmar el DPA en <strong>Equipo y gobernanza</strong> antes de enviar texto libre a modelos externos.
                    </div>
                  )}

                  <textarea
                    rows={4}
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    disabled={extracting || submitting || !aiExtractAuthorized}
                    placeholder="Ej: Varón de 67 años (código pseudonimizado SUBJ-A1B2C3), fumador activo, antecedentes de diabetes e HTA. PAS 148 mmHg, creatinina 1.4 mg/dL…"
                    data-testid="ai-freetext-input"
                    className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2.5 text-xs leading-relaxed text-[#1D1D1F] placeholder:text-[#86868B] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 disabled:opacity-60 dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15"
                  />

                  <label className="flex items-start gap-2.5 rounded-xl border border-black/[0.06] bg-[#F5F5F7]/70 px-3 py-2 text-[11px] leading-relaxed text-[#424245] dark:border-white/[0.08] dark:bg-[#1C1C1E]/70 dark:text-[#D1D1D6]">
                    <input
                      type="checkbox"
                      checked={deidentifiedConfirmed}
                      disabled={!aiExtractAuthorized || extracting}
                      onChange={(e) => setDeidentifiedConfirmed(e.target.checked)}
                      data-testid="ai-deidentified-checkbox"
                      className="mt-0.5 h-3.5 w-3.5 rounded border-black/20 text-[#0071E3]"
                    />
                    <span>
                      Confirmo que el texto pegado no contiene nombre completo, DNI/NIE, NHC, teléfono, correo electrónico ni otros identificadores directos. El filtro automático de servidor bloquea patrones comunes pero no sustituye la revisión humana ni garantiza anonimización absoluta.
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-[#86868B] dark:text-[#98989D]">
                      Los campos detectados quedarán resaltados para tu revisión antes de guardar.
                    </span>
                    <button
                      type="button"
                      disabled={extracting || !form || !aiExtractAuthorized || !deidentifiedConfirmed || freeText.trim().length < 5}
                      onClick={() => void handleExtractFromText()}
                      data-testid="ai-extract-btn"
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#0077ED] disabled:opacity-50 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" />
                      {extracting ? "Analizando texto…" : "Detectar variables y rellenar vacíos"}
                    </button>
                  </div>

                  {aiFilledKeys.size > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#0071E3]/25 bg-[#0071E3]/[0.06] px-3.5 py-2.5 text-xs text-[#1D1D1F] dark:border-[#0A84FF]/30 dark:bg-[#0A84FF]/[0.1] dark:text-[#F5F5F7]">
                      <div>
                        <strong className="font-semibold">{aiFilledKeys.size} campo(s) autocompletados para revisar.</strong>{" "}
                        {aiNotes && <span className="text-[#424245] dark:text-[#D1D1D6]">{aiNotes}</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setAiFilledKeys(new Set())}
                        className="font-medium text-[#0071E3] hover:underline dark:text-[#0A84FF]"
                      >
                        Ocultar marcas
                      </button>
                    </div>
                  )}
                </div>

                {/* Structured CRF Form */}
                <form
                  onSubmit={(e) => void handleSubmit(e)}
                  className="apple-card rounded-2xl border border-black/[0.06] bg-white p-6 space-y-5 dark:border-white/[0.08] dark:bg-[#141416]"
                >
                  {editingRecord && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/70 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                      <span>
                        Editando registro v{editingRecord.version ?? 1} (guardado el {formatShortDate(editingRecord.created_at)})
                      </span>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="inline-flex items-center gap-1 font-medium text-amber-800 hover:underline dark:text-amber-300"
                      >
                        <X className="h-3.5 w-3.5" />
                        Cancelar edición
                      </button>
                    </div>
                  )}

                  {/* Participant Pseudonymization & CRF Status Strip */}
                  <div className="grid grid-cols-1 gap-3 rounded-2xl border border-black/[0.06] bg-[#F5F5F7]/70 p-4 sm:grid-cols-2 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                        Código pseudonimizado del participante{" "}
                        {governance?.require_active_consent ? "(obligatorio)" : "(opcional)"}
                      </label>
                      {vaultSubjects.length > 0 ? (
                        <select
                          value={subjectPseudoId}
                          onChange={(e) => setSubjectPseudoId(e.target.value)}
                          required={Boolean(governance?.require_active_consent)}
                          data-testid="crf-subject-select"
                          className="w-full rounded-xl border border-transparent bg-white px-3 py-2 font-mono text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                        >
                          <option value="">
                            {governance?.require_active_consent
                              ? "— Selecciona un sujeto con consentimiento vigente —"
                              : "— Sin vínculo a bóveda / introducir abajo —"}
                          </option>
                          {vaultSubjects.map((s) => (
                            <option key={s.subject_pseudo_id} value={s.subject_pseudo_id}>
                              {s.subject_pseudo_id} ({CONSENT_STATUS_LABEL[s.consent_status]})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={subjectPseudoId}
                          required={Boolean(governance?.require_active_consent)}
                          onChange={(e) => setSubjectPseudoId(e.target.value)}
                          placeholder="SUBJ-..."
                          data-testid="crf-subject-input"
                          className="w-full rounded-xl border border-transparent bg-white px-3 py-2 font-mono text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                        />
                      )}
                      {matchedConsentSubject && matchedConsentSubject.consent_status !== "vigente" && (
                        <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                          Consentimiento «{CONSENT_STATUS_LABEL[matchedConsentSubject.consent_status]}»: la captura será bloqueada.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                        Estado del registro CRF
                      </label>
                      <select
                        value={crfStatus}
                        onChange={(e) => setCrfStatus(e.target.value as "borrador" | "completado" | "enviado")}
                        data-testid="crf-status-select"
                        className="w-full rounded-xl border border-transparent bg-white px-3 py-2 text-xs font-medium text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                      >
                        <option value="borrador">Borrador</option>
                        <option value="completado">Completado</option>
                        <option value="enviado">Enviado para monitorización</option>
                      </select>
                    </div>
                  </div>

                  {form?.fields.map((field) => (
                    <FieldInput
                      key={field.name}
                      field={field}
                      value={values[field.name]}
                      aiFilled={aiFilledKeys.has(field.name)}
                      onChange={(val) => {
                        setValues((prev) => ({ ...prev, [field.name]: val }));
                        if (aiFilledKeys.has(field.name)) {
                          setAiFilledKeys((prev) => {
                            const next = new Set(prev);
                            next.delete(field.name);
                            return next;
                          });
                        }
                      }}
                      disabled={submitting}
                    />
                  ))}

                  {editingRecord && (
                    <div className="space-y-1.5 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
                      <label className="block text-xs font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                        Motivo de modificación (obligatorio, mín. 5 caracteres) *
                      </label>
                      <input
                        type="text"
                        required
                        minLength={5}
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                        placeholder="Ej: Actualización de resultado analítico de laboratorio"
                        data-testid="crf-edit-reason-input"
                        className="w-full rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3.5 py-2.5 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                      />
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-end gap-2.5">
                    {editingRecord && (
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="rounded-full border border-black/[0.08] bg-white px-4 py-2.5 text-sm font-medium text-[#1D1D1F] transition hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={submitting || !form || (Boolean(editingRecord) && editReason.trim().length < 5)}
                      data-testid="submit-record-btn"
                      className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {submitting
                        ? "Validando y guardando…"
                        : editingRecord
                          ? "Guardar cambios del paciente"
                          : "Guardar paciente"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>

          {/* Right Column: Captured Patient Records with Version History & Workflow Locks */}
          <div className="lg:col-span-5 space-y-3">
            <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
              <h3 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                Registros de pacientes capturados ({records.length})
              </h3>
              <p className="mt-0.5 text-xs text-[#6E6E73] dark:text-[#98989D]">
                Cada modificación genera una versión inmutable. Los registros verificados/bloqueados impiden edición directa.
              </p>

              <div className="mt-4 max-h-[680px] overflow-y-auto divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                {!records.length ? (
                  <p className="py-8 text-center text-xs text-[#86868B]">Todavía no hay pacientes registrados aquí.</p>
                ) : (
                  records.map((rec) => {
                    const firstKeys = form?.fields.slice(0, 3).map((f) => f.name) ?? Object.keys(rec.data).slice(0, 3);
                    const isEditingThis = editingRecord?.id === rec.id;
                    const status: CrfRecordStatus = rec.status ?? "borrador";
                    const isLocked = status === "verificado" || status === "bloqueado";
                    const openQCount = openQueryCountByRecord.get(rec.id) ?? 0;

                    return (
                      <div
                        key={rec.id}
                        className={`py-3.5 text-xs space-y-2 ${isEditingThis ? "bg-amber-50/70 px-2.5 rounded-xl dark:bg-amber-500/10" : ""}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono">
                              {rec.subject_pseudo_id || String(rec.data[firstKeys[0]] ?? rec.id.slice(0, 8))}
                            </span>
                            <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${CRF_STATUS_STYLE[status]}`}>
                              {CRF_STATUS_LABEL[status]} · v{rec.version ?? 1}
                            </span>
                            {openQCount > 0 && (
                              <span className="rounded-md bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-amber-800 dark:text-amber-300">
                                {openQCount} {openQCount === 1 ? "query abierta" : "queries abiertas"}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-[#86868B]">{formatShortDate(rec.created_at)}</span>
                        </div>

                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[#6E6E73] dark:text-[#98989D]">
                          {firstKeys.map((k) => (
                            <span key={k}>
                              {k}:{" "}
                              <strong className="font-mono text-[#1D1D1F] dark:text-[#E5E5EA]">
                                {String(rec.data[k] ?? "—")}
                              </strong>
                            </span>
                          ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {canCapture && !isLocked && (
                            <button
                              type="button"
                              onClick={() => handleStartEditRecord(rec)}
                              data-testid={`edit-crf-record-${rec.id}`}
                              className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-white px-2.5 py-1 text-[11px] font-medium text-[#1D1D1F] transition hover:border-[#0071E3] hover:text-[#0071E3] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#E5E5EA]"
                            >
                              <Pencil className="h-3 w-3" />
                              Editar
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => void handleOpenVersions(rec)}
                            data-testid={`versions-crf-record-${rec.id}`}
                            className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-white px-2.5 py-1 text-[11px] font-medium text-[#424245] transition hover:bg-[#F5F5F7] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#D1D1D6]"
                          >
                            <History className="h-3 w-3" />
                            Versiones
                          </button>

                          {canOpenQuery && (
                            <button
                              type="button"
                              onClick={() => {
                                setQueryTarget(rec);
                                setQueryVariable(form?.fields[0]?.name ?? "");
                                setQueryMessage("");
                              }}
                              data-testid={`open-query-record-${rec.id}`}
                              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/60 px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                            >
                              <MessageSquarePlus className="h-3 w-3" />
                              Query
                            </button>
                          )}

                          {canVerify && !isStudyFrozen && status !== "verificado" && status !== "bloqueado" && (
                            <button
                              type="button"
                              onClick={() => setActionTarget({ record: rec, type: "verificado" })}
                              data-testid={`verify-crf-record-${rec.id}`}
                              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                            >
                              <ShieldCheck className="h-3 w-3" />
                              Verificar
                            </button>
                          )}

                          {canVerify && !isStudyFrozen && status !== "bloqueado" && (
                            <button
                              type="button"
                              onClick={() => setActionTarget({ record: rec, type: "bloqueado" })}
                              data-testid={`lock-crf-record-${rec.id}`}
                              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                            >
                              <Lock className="h-3 w-3" />
                              Bloquear
                            </button>
                          )}

                          {canReopen && isLocked && (
                            <button
                              type="button"
                              onClick={() => setActionTarget({ record: rec, type: "reopen" })}
                              data-testid={`reopen-crf-record-${rec.id}`}
                              className="inline-flex items-center gap-1 rounded-full border border-[#0071E3]/30 bg-[#0071E3]/[0.08] px-2.5 py-1 text-[11px] font-medium text-[#0071E3] hover:bg-[#0071E3]/[0.15] dark:border-[#0A84FF]/40 dark:text-[#0A84FF]"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Reabrir
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Version History Modal */}
      {versionsTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-black/[0.08] bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#141416]">
            <div className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4 dark:border-white/[0.08]">
              <div>
                <h3 className="font-heading text-base font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                  Historial de versiones · {versionsTarget.subject_pseudo_id || versionsTarget.id.slice(0, 10)}
                </h3>
                <p className="text-xs text-[#6E6E73] dark:text-[#98989D]">
                  Comparación inmutable entre valores anteriores y nuevos con actor y motivo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVersionsTarget(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#86868B] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {loadingVersions ? (
                <p className="py-8 text-center text-xs text-[#86868B]">Cargando historial de versiones…</p>
              ) : !versionsList.length ? (
                <p className="py-8 text-center text-xs text-[#86868B]">
                  No se encontraron versiones registradas para este registro.
                </p>
              ) : (
                versionsList.map((ver) => {
                  const allKeys = Array.from(
                    new Set([...Object.keys(ver.previous_data), ...Object.keys(ver.new_data)])
                  );
                  const changedKeys = allKeys.filter(
                    (k) => JSON.stringify(ver.previous_data[k]) !== JSON.stringify(ver.new_data[k])
                  );
                  return (
                    <div
                      key={ver.id}
                      className="rounded-2xl border border-black/[0.06] bg-[#F5F5F7]/60 p-4 space-y-2 text-xs dark:border-white/[0.08] dark:bg-[#1C1C1E]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-[#1D1D1F] dark:text-white">
                          Versión v{ver.version} ·{" "}
                          {ver.previous_status ? `${CRF_STATUS_LABEL[ver.previous_status]} → ` : ""}
                          {CRF_STATUS_LABEL[ver.new_status]}
                        </span>
                        <span className="text-[11px] text-[#86868B]">
                          {ver.changed_by_name} · {formatShortDate(ver.changed_at)}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#424245] dark:text-[#D1D1D6]">
                        <strong>Motivo:</strong> {ver.reason}
                      </div>
                      {changedKeys.length > 0 && (
                        <div className="mt-2 space-y-1 rounded-xl bg-white p-2.5 font-mono text-[11px] dark:bg-[#141416]">
                          {changedKeys.map((k) => (
                            <div key={k} className="flex flex-wrap gap-1.5">
                              <span className="font-semibold text-[#6E6E73]">{k}:</span>
                              <span className="line-through text-rose-600 dark:text-rose-400">
                                {String(ver.previous_data[k] ?? "vacío")}
                              </span>
                              <span>→</span>
                              <span className="text-emerald-700 dark:text-emerald-400">
                                {String(ver.new_data[k] ?? "vacío")}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Open Monitoring Query Modal */}
      {queryTarget && form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-black/[0.08] bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#141416]">
            <div className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4 dark:border-white/[0.08]">
              <div>
                <h3 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                  Abrir query de monitorización
                </h3>
                <p className="font-mono text-[11px] text-[#86868B]">
                  {queryTarget.subject_pseudo_id || queryTarget.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQueryTarget(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#86868B] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={(e) => void handleCreateQuery(e)} className="p-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Variable afectada *
                </label>
                <select
                  value={queryVariable}
                  onChange={(e) => setQueryVariable(e.target.value)}
                  className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3 py-2 text-xs font-mono text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                >
                  {form.fields.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name} ({f.label})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Detalle de la discrepancia (mín. 5 caracteres) *
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={queryMessage}
                  onChange={(e) => setQueryMessage(e.target.value)}
                  placeholder="Ej: El valor de creatinina difiere del informe fuente de laboratorio; confirmar unidad y fecha."
                  data-testid="query-message-input"
                  className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setQueryTarget(null)}
                  className="rounded-full border border-black/[0.08] px-4 py-2 text-xs font-medium text-[#1D1D1F] dark:border-white/[0.12] dark:text-[#F5F5F7]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingQuery || queryMessage.trim().length < 5}
                  data-testid="query-submit-btn"
                  className="rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white hover:bg-[#0077ED] disabled:opacity-60"
                >
                  {creatingQuery ? "Abriendo…" : "Abrir query"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Re-authenticated Electronic Approval Modal for SDV / Lock / Reopen */}
      {actionTarget && resolvedProjectId && (
        <ElectronicApprovalModal
          open={Boolean(actionTarget)}
          projectId={resolvedProjectId}
          targetType="crf_record"
          targetId={actionTarget.record.id}
          targetVersion={actionTarget.record.version ?? 1}
          actionTitle={
            actionTarget.type === "reopen"
              ? "Reabrir registro bloqueado/verificado"
              : actionTarget.type === "verificado"
                ? "Verificar registro clínico (SDV)"
                : "Bloquear registro clínico"
          }
          defaultMeaning={
            actionTarget.type === "reopen"
              ? "Reapertura autorizada de CRF para corrección"
              : actionTarget.type === "verificado"
                ? "Verificación de datos fuente (SDV)"
                : "Bloqueo de registro CRF"
          }
          description={
            actionTarget.type === "reopen"
              ? "El registro volverá a estado Borrador permitiendo nuevas ediciones versionadas. Exige motivo documentado y reautenticación."
              : "Una vez verificado o bloqueado, el registro queda inmovilizado frente a edición directa sin reapertura autorizada."
          }
          onClose={() => setActionTarget(null)}
          onSigned={async (manifest, reason) => {
            if (!user) return;
            if (actionTarget.type === "reopen") {
              await reopenFormRecord(resolvedProjectId, actionTarget.record.id, reason, user, manifest.id);
              toast.success("Registro reabierto con aprobación electrónica firmada.");
            } else {
              await transitionFormRecordStatus(
                resolvedProjectId,
                actionTarget.record.id,
                actionTarget.type,
                reason,
                user,
                manifest.id
              );
              toast.success(
                `Registro marcado como ${CRF_STATUS_LABEL[actionTarget.type]} con aprobación electrónica.`
              );
            }
            await loadData();
          }}
        />
      )}
    </AppShell>
  );
}
