import { useEffect, useState } from "react";
import { FilePlus2, GitBranch, Lock, Mail, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { errMsg } from "../../lib/api.ts";
import { useAuth } from "../../lib/AuthContext.tsx";
import {
  addStudyAmendment,
  getStudyGovernance,
  getStudyLifecycle,
  inviteProjectMember,
  listProjectMembers,
  removeProjectMember,
  updateMemberRole,
  updateStudyGovernance,
  updateStudyStatus,
} from "../../lib/firestoreDb.ts";
import {
  ROLE_LABEL,
  STUDY_STATUS_LABEL,
  type ProjectMember,
  type Role,
  type StudyGovernance,
  type StudyLifecycle,
  type StudyStatus,
  type UserRow,
} from "../../lib/types.ts";
import { formatShortDate } from "../../lib/utils.ts";
import { ElectronicApprovalModal } from "./ElectronicApprovalModal.tsx";

interface MembersResponse {
  owner_id: string;
  my_role: Role;
  members: ProjectMember[];
  registered_users: UserRow[];
}

const ROLE_OPTIONS: { value: Role; label: string; desc: string }[] = [
  {
    value: "admin",
    label: ROLE_LABEL.admin,
    desc: "Control total del estudio: gestión de miembros y gobernanza, acceso clínico, bóveda de reidentificación, exportación masiva y reapertura de CRF.",
  },
  {
    value: "coordinador",
    label: ROLE_LABEL.coordinador,
    desc: "Supervisa CRF, verifica y reabre registros bloqueados, gestiona consentimientos, accede a la bóveda de reidentificación y exportaciones masivas.",
  },
  {
    value: "investigador",
    label: ROLE_LABEL.investigador,
    desc: "Importa cohortes, diseña formularios CRF, captura datos, ejecuta bioestadística e IA y exporta datos pseudonimizados (hasta 500 filas).",
  },
  {
    value: "monitor_clinico",
    label: ROLE_LABEL.monitor_clinico,
    desc: "Revisa sábana de datos y consentimientos en solo lectura, verifica/bloquea registros CRF y consulta el historial de versiones y auditoría.",
  },
  {
    value: "estadistico",
    label: ROLE_LABEL.estadistico,
    desc: "Acceso analítico de solo lectura a datos pseudonimizados, pruebas bioestadísticas, análisis guardados, IA y exportación acotada.",
  },
  {
    value: "admin_tecnico",
    label: ROLE_LABEL.admin_tecnico,
    desc: "Supervisión de auditoría técnica HMAC y consulta en solo lectura del equipo y seguridad, SIN acceso a datos clínicos, CRF, bóveda de identidad, IA ni edición de roles/gobernanza.",
  },
  {
    value: "capturador",
    label: ROLE_LABEL.capturador,
    desc: "Introduce y corrige sus propios registros de pacientes en CRF, registra participantes pseudonimizados y consulta consentimientos.",
  },
];

export function MembersTab({
  projectId,
  canManageTeam,
  myRole,
  studyLifecycle,
  onLifecycleChanged,
}: {
  projectId: string;
  canManageTeam: boolean;
  myRole: Role;
  studyLifecycle?: StudyLifecycle | null;
  onLifecycleChanged?: () => void;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<MembersResponse | null>(null);
  const [governance, setGovernance] = useState<StudyGovernance | null>(null);
  const [lifecycle, setLifecycle] = useState<StudyLifecycle | null>(studyLifecycle ?? null);
  const [savingGov, setSavingGov] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [roleInput, setRoleInput] = useState<Role>("investigador");
  const [submitting, setSubmitting] = useState(false);

  // Study Lifecycle & Amendments state
  const [nextStudyStatus, setNextStudyStatus] = useState<StudyStatus>(studyLifecycle?.study_status ?? "reclutamiento");
  const [statusReason, setStatusReason] = useState("");
  const [savingLifecycle, setSavingLifecycle] = useState(false);
  const [pendingSignedStatus, setPendingSignedStatus] = useState<StudyStatus | null>(null);

  const [amdVersion, setAmdVersion] = useState("");
  const [amdDate, setAmdDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amdSummary, setAmdSummary] = useState("");
  const [savingAmendment, setSavingAmendment] = useState(false);

  const canManageLifecycle = myRole === "admin" || myRole === "coordinador";

  useEffect(() => {
    if (studyLifecycle) {
      setLifecycle(studyLifecycle);
      setNextStudyStatus(studyLifecycle.study_status);
    }
  }, [studyLifecycle]);

  const load = async () => {
    if (!user) return;
    try {
      const [res, gov, lc] = await Promise.all([
        listProjectMembers(projectId, user),
        getStudyGovernance(projectId),
        getStudyLifecycle(projectId),
      ]);
      setData(res);
      setGovernance(gov);
      setLifecycle(lc);
      setNextStudyStatus(lc.study_status);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, user?.uid]);

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    setSubmitting(true);
    try {
      const added = await inviteProjectMember(projectId, email, roleInput, user);
      toast.success(`Estudio compartido con ${added.email} como ${ROLE_LABEL[added.role]}.`);
      setEmailInput("");
      await load();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo compartir el estudio."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (member: ProjectMember, nextRole: Role) => {
    if (!user) return;
    try {
      const updated = await updateMemberRole(projectId, member, nextRole, user);
      toast.success(`Rol de ${member.name} actualizado a ${ROLE_LABEL[updated.role]}.`);
      await load();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cambiar el rol."));
    }
  };

  const handleRemove = async (member: ProjectMember) => {
    if (!user) return;
    try {
      await removeProjectMember(projectId, member, user);
      toast.success(`${member.name} retirado del estudio.`);
      await load();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo retirar al miembro."));
    }
  };

  const handleToggleGov = async (
    patch: Partial<Omit<StudyGovernance, "project_id" | "updated_by" | "updated_at">>
  ) => {
    if (!user || !governance || !canManageTeam) return;
    setSavingGov(true);
    try {
      const updated = await updateStudyGovernance(projectId, patch, user);
      setGovernance(updated);
      toast.success("Política de gobernanza actualizada.");
    } catch (err) {
      toast.error(errMsg(err, "No se pudo actualizar la configuración de gobernanza."));
    } finally {
      setSavingGov(false);
    }
  };

  const requiresElectronicSignatureForStatus = (currentStatus: StudyStatus, targetStatus: StudyStatus): boolean => {
    if (targetStatus === "bloqueado" || targetStatus === "archivado") return true;
    if (currentStatus === "cerrado" || currentStatus === "bloqueado" || currentStatus === "archivado") return true;
    return false;
  };

  const handleApplyStudyStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !lifecycle || !canManageLifecycle) return;
    if (nextStudyStatus === lifecycle.study_status) {
      toast.info("Selecciona un estado distinto al actual.");
      return;
    }
    if (requiresElectronicSignatureForStatus(lifecycle.study_status, nextStudyStatus)) {
      setPendingSignedStatus(nextStudyStatus);
      return;
    }
    if (statusReason.trim().length < 5) {
      toast.error("Indica un motivo de cambio de estado (mínimo 5 caracteres).");
      return;
    }
    setSavingLifecycle(true);
    try {
      const updated = await updateStudyStatus(projectId, nextStudyStatus, statusReason.trim(), user);
      setLifecycle(updated);
      setStatusReason("");
      toast.success(`Fase del estudio actualizada a «${STUDY_STATUS_LABEL[nextStudyStatus]}».`);
      onLifecycleChanged?.();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cambiar la fase del estudio."));
    } finally {
      setSavingLifecycle(false);
    }
  };

  const handleRegisterAmendment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canManageLifecycle) return;
    setSavingAmendment(true);
    try {
      const updated = await addStudyAmendment(
        projectId,
        {
          version: amdVersion,
          effectiveDate: amdDate,
          summary: amdSummary,
        },
        user
      );
      setLifecycle(updated);
      setAmdVersion("");
      setAmdSummary("");
      toast.success(`Enmienda de protocolo v${updated.protocol_version} registrada.`);
      onLifecycleChanged?.();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo registrar la enmienda de protocolo."));
    } finally {
      setSavingAmendment(false);
    }
  };

  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-6 space-y-5 dark:border-white/[0.08] dark:bg-[#141416]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-heading text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
              Compartir estudio y asignar roles
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
              {canManageTeam
                ? "Invita a colaboradores introduciendo su correo electrónico y elige su rol específico para este estudio. Si aún no tienen cuenta en Avicena, recibirán acceso en cuanto inicien sesión con ese correo."
                : `Tu rol en este estudio es ${ROLE_LABEL[myRole]}. Solo un Administrador del estudio puede invitar o modificar roles.`}
            </p>
          </div>
        </div>

        {canManageTeam && (
          <form
            onSubmit={handleShare}
            className="rounded-2xl border border-black/[0.06] bg-[#F5F5F7]/70 p-4 space-y-3 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end">
              <div className="sm:col-span-6">
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Correo electrónico del colaborador
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-2.5 h-4 w-4 text-[#86868B]" />
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="investigador@hospital.org"
                    className="w-full rounded-xl border border-transparent bg-white pl-10 pr-3.5 py-2 text-xs text-[#1D1D1F] placeholder:text-[#86868B] transition focus:border-[#0071E3] focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7] dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15"
                    data-testid="share-email-input"
                  />
                </div>
              </div>

              <div className="sm:col-span-3">
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Rol en este estudio
                </label>
                <select
                  value={roleInput}
                  onChange={(e) => setRoleInput(e.target.value as Role)}
                  className="w-full rounded-xl border border-transparent bg-white px-3 py-2 text-xs font-medium text-[#1D1D1F] transition focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7] dark:focus:border-[#0A84FF]"
                  data-testid="share-role-select"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <button
                  type="submit"
                  disabled={submitting || !emailInput.trim()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
                  data-testid="share-submit-btn"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {submitting ? "Compartiendo…" : "Compartir estudio"}
                </button>
              </div>
            </div>
          </form>
        )}

        <div className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
          {data.members.map((m) => {
            const isOwner = Boolean(m.user_id && m.user_id === data.owner_id);
            const rowKey = m.user_id || m.invite_id || m.email;
            return (
              <div key={rowKey} className="flex flex-wrap items-center justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                    <span>{m.name}</span>
                    {isOwner && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#0071E3] dark:text-[#0A84FF]">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Creador / Propietario
                      </span>
                    )}
                    {m.pending && (
                      <span className="text-xs font-normal text-amber-600 dark:text-amber-400">
                        · Invitación pendiente (se activará al iniciar sesión)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#6E6E73] dark:text-[#98989D]">{m.email}</div>
                </div>

                <div className="flex items-center gap-2">
                  {canManageTeam && !isOwner ? (
                    <>
                      <select
                        aria-label={`Rol de ${m.name}`}
                        value={m.role}
                        onChange={(e) => handleRoleChange(m, e.target.value as Role)}
                        className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3 py-1.5 text-xs font-medium text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleRemove(m)}
                        className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-[#1D1D1F] transition hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
                      >
                        <UserMinus className="h-3.5 w-3.5 text-[#6E6E73] dark:text-[#98989D]" />
                        Retirar
                      </button>
                    </>
                  ) : (
                    <span className="text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                      {ROLE_LABEL[m.role]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Study AI & MFA Governance Policy */}
      {governance && (
        <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-6 space-y-4 dark:border-white/[0.08] dark:bg-[#141416]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0071E3]/10 text-[#0071E3] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]">
              <Lock className="h-4 w-4" />
            </span>
            <div>
              <h3 className="font-heading text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                Gobernanza de IA externa y seguridad del estudio
              </h3>
              <p className="mt-0.5 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                Por defecto, Avicena bloquea el envío de texto o esquemas clínicos a proveedores externos de IA. Actívalos solo tras confirmar base jurídica / encargo de tratamiento (DPA) y asegurando ausencia de datos identificativos.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex items-start gap-3 rounded-xl border border-black/[0.06] bg-[#F5F5F7]/70 p-3.5 text-xs dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
              <input
                type="checkbox"
                disabled={!canManageTeam || savingGov}
                checked={governance.ai_dpa_confirmed}
                onChange={(e) => void handleToggleGov({ ai_dpa_confirmed: e.target.checked })}
                data-testid="gov-dpa-checkbox"
                className="mt-0.5 h-4 w-4 rounded border-black/20 text-[#0071E3]"
              />
              <div>
                <div className="font-semibold text-[#1D1D1F] dark:text-white">
                  Acuerdo de tratamiento (DPA) y base ética confirmados
                </div>
                <p className="mt-0.5 text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                  Requisito obligatorio para habilitar cualquier integración con modelos externos de IA.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-black/[0.06] bg-[#F5F5F7]/70 p-3.5 text-xs dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
              <input
                type="checkbox"
                disabled={!canManageTeam || savingGov}
                checked={governance.ai_enabled}
                onChange={(e) => void handleToggleGov({ ai_enabled: e.target.checked })}
                data-testid="gov-ai-enabled-checkbox"
                className="mt-0.5 h-4 w-4 rounded border-black/20 text-[#0071E3]"
              />
              <div>
                <div className="font-semibold text-[#1D1D1F] dark:text-white">
                  Habilitar funciones de IA externa en este estudio
                </div>
                <p className="mt-0.5 text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                  Mantiene bloqueada toda petición a modelos externos mientras esté desactivado.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-black/[0.06] bg-[#F5F5F7]/70 p-3.5 text-xs dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
              <input
                type="checkbox"
                disabled={!canManageTeam || savingGov}
                checked={governance.ai_allow_clinical_text}
                onChange={(e) => void handleToggleGov({ ai_allow_clinical_text: e.target.checked })}
                data-testid="gov-ai-text-checkbox"
                className="mt-0.5 h-4 w-4 rounded border-black/20 text-[#0071E3]"
              />
              <div>
                <div className="font-semibold text-[#1D1D1F] dark:text-white">
                  Permitir extracción IA desde texto clínico libre en CRF
                </div>
                <p className="mt-0.5 text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                  Aplica filtro automático de identificadores y exige confirmación de desidentificación previa.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-black/[0.06] bg-[#F5F5F7]/70 p-3.5 text-xs dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
              <input
                type="checkbox"
                disabled={!canManageTeam || savingGov}
                checked={governance.ai_allow_dataset_context}
                onChange={(e) => void handleToggleGov({ ai_allow_dataset_context: e.target.checked })}
                data-testid="gov-ai-copilot-checkbox"
                className="mt-0.5 h-4 w-4 rounded border-black/20 text-[#0071E3]"
              />
              <div>
                <div className="font-semibold text-[#1D1D1F] dark:text-white">
                  Permitir Asistente IA bioestadístico sobre metadatos del estudio
                </div>
                <p className="mt-0.5 text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                  Solo envía metadatos de variables no identificativas; los cálculos corren en servidor propio.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-black/[0.06] bg-[#F5F5F7]/70 p-3.5 text-xs md:col-span-2 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
              <input
                type="checkbox"
                disabled={!canManageTeam || savingGov}
                checked={governance.require_mfa}
                onChange={(e) => void handleToggleGov({ require_mfa: e.target.checked })}
                data-testid="gov-mfa-checkbox"
                className="mt-0.5 h-4 w-4 rounded border-black/20 text-[#0071E3]"
              />
              <div>
                <div className="font-semibold text-[#1D1D1F] dark:text-white">
                  Exigir autenticación multifactor (MFA) en las llamadas de API del estudio
                </div>
                <p className="mt-0.5 text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                  Cuando está activo, el backend rechaza operaciones del estudio si el token del usuario no incluye un segundo factor MFA verificado.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-black/[0.06] bg-[#F5F5F7]/70 p-3.5 text-xs md:col-span-2 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
              <input
                type="checkbox"
                disabled={!canManageTeam || savingGov}
                checked={Boolean(governance.require_active_consent)}
                onChange={(e) => void handleToggleGov({ require_active_consent: e.target.checked })}
                data-testid="gov-consent-checkbox"
                className="mt-0.5 h-4 w-4 rounded border-black/20 text-[#0071E3]"
              />
              <div>
                <div className="font-semibold text-[#1D1D1F] dark:text-white">
                  Exigir consentimiento informado «Vigente» para captura en CRF
                </div>
                <p className="mt-0.5 text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                  Impide guardar nuevos registros clínicos si el participante pseudonimizado no dispone de un consentimiento informado en estado Vigente.
                </p>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Study Lifecycle & Protocol Amendments */}
      {lifecycle && (
        <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-6 space-y-5 dark:border-white/[0.08] dark:bg-[#141416]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0071E3]/10 text-[#0071E3] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]">
                <GitBranch className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-heading text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                  Ciclo de vida del estudio y enmiendas de protocolo
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                  Cuando el estudio pasa a <strong>Cerrado</strong>, <strong>Bloqueado</strong> o <strong>Archivado</strong>, la captura y edición clínica quedan bloqueadas en API y reglas de Firestore. Bloquear, archivar o reabrir exige aprobación electrónica reautenticada.
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-black/[0.06] bg-[#F5F5F7] px-3.5 py-2 text-right dark:border-white/[0.08] dark:bg-[#1C1C1E]">
              <div className="text-[11px] text-[#6E6E73] dark:text-[#98989D]">Estado actual</div>
              <div className="font-mono text-xs font-semibold text-[#1D1D1F] dark:text-white">
                {STUDY_STATUS_LABEL[lifecycle.study_status]} · v{lifecycle.protocol_version}
              </div>
            </div>
          </div>

          {canManageLifecycle && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <form
                onSubmit={(e) => void handleApplyStudyStatus(e)}
                className="rounded-2xl border border-black/[0.06] bg-[#F5F5F7]/70 p-4 space-y-3 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70"
              >
                <div className="text-xs font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                  Transición de fase del estudio
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Nueva fase del estudio
                  </label>
                  <select
                    value={nextStudyStatus}
                    onChange={(e) => setNextStudyStatus(e.target.value as StudyStatus)}
                    data-testid="lifecycle-status-select"
                    className="w-full rounded-xl border border-transparent bg-white px-3 py-2 text-xs font-medium text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                  >
                    <option value="borrador">Borrador / Configuración</option>
                    <option value="reclutamiento">Activo (Reclutamiento)</option>
                    <option value="seguimiento">Seguimiento</option>
                    <option value="cerrado">Cerrado a captura</option>
                    <option value="bloqueado">Base bloqueada (Database Lock)</option>
                    <option value="archivado">Archivado</option>
                  </select>
                </div>
                {!requiresElectronicSignatureForStatus(lifecycle.study_status, nextStudyStatus) && (
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                      Motivo del cambio (mín. 5 caracteres) *
                    </label>
                    <input
                      type="text"
                      required
                      minLength={5}
                      value={statusReason}
                      onChange={(e) => setStatusReason(e.target.value)}
                      placeholder="Ej: Fin de ventana de reclutamiento, inicio de seguimiento"
                      className="w-full rounded-xl border border-transparent bg-white px-3 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                    />
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingLifecycle || nextStudyStatus === lifecycle.study_status}
                    data-testid="lifecycle-apply-btn"
                    className="rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white hover:bg-[#0077ED] disabled:opacity-50 dark:bg-[#0A84FF]"
                  >
                    {requiresElectronicSignatureForStatus(lifecycle.study_status, nextStudyStatus)
                      ? "Reautenticar y aplicar fase"
                      : savingLifecycle
                        ? "Actualizando…"
                        : "Aplicar nueva fase"}
                  </button>
                </div>
              </form>

              <form
                onSubmit={(e) => void handleRegisterAmendment(e)}
                className="rounded-2xl border border-black/[0.06] bg-[#F5F5F7]/70 p-4 space-y-3 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                  <FilePlus2 className="h-3.5 w-3.5 text-[#0071E3]" />
                  Registrar enmienda de protocolo
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                      Versión protocolo *
                    </label>
                    <input
                      type="text"
                      required
                      value={amdVersion}
                      onChange={(e) => setAmdVersion(e.target.value)}
                      placeholder="Ej: 2.0"
                      className="w-full rounded-xl border border-transparent bg-white px-3 py-2 font-mono text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                      Fecha efectiva *
                    </label>
                    <input
                      type="date"
                      required
                      value={amdDate}
                      onChange={(e) => setAmdDate(e.target.value)}
                      className="w-full rounded-xl border border-transparent bg-white px-3 py-2 font-mono text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Resumen de la enmienda y dictamen CEIm *
                  </label>
                  <input
                    type="text"
                    required
                    minLength={5}
                    value={amdSummary}
                    onChange={(e) => setAmdSummary(e.target.value)}
                    placeholder="Ej: Aprobación CEIm 2025-04 para criterio de inclusión ampliado"
                    className="w-full rounded-xl border border-transparent bg-white px-3 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.08] dark:bg-[#141416] dark:text-[#F5F5F7]"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingAmendment}
                    className="rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white hover:bg-[#0077ED] disabled:opacity-50 dark:bg-[#0A84FF]"
                  >
                    {savingAmendment ? "Registrando…" : "Registrar enmienda"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {lifecycle.amendments.length > 0 && (
            <div className="space-y-2 border-t border-black/[0.05] pt-3 dark:border-white/[0.06]">
              <div className="text-xs font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                Historial de enmiendas de protocolo ({lifecycle.amendments.length})
              </div>
              <div className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                {lifecycle.amendments.map((amd) => (
                  <div key={amd.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                    <div>
                      <span className="font-mono font-semibold text-[#0071E3] dark:text-[#0A84FF]">
                        v{amd.version}
                      </span>{" "}
                      <span className="text-[#1D1D1F] dark:text-[#F5F5F7]">{amd.summary}</span>
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-[#86868B]">
                      Efectiva: {amd.effective_date} · {amd.approved_by_name} · {formatShortDate(amd.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Role Reference Grid */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-4">
        {ROLE_OPTIONS.map((opt) => (
          <div
            key={opt.value}
            className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]"
          >
            <div className="text-xs font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">{opt.label}</div>
            <p className="mt-1 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">{opt.desc}</p>
          </div>
        ))}
      </div>

      <ElectronicApprovalModal
        open={Boolean(pendingSignedStatus)}
        projectId={projectId}
        targetType="study_lifecycle"
        targetId={projectId}
        actionTitle={
          pendingSignedStatus
            ? `Aprobar transición a «${STUDY_STATUS_LABEL[pendingSignedStatus]}»`
            : "Aprobar transición de estudio"
        }
        defaultMeaning={
          pendingSignedStatus === "bloqueado"
            ? "Aprobación de bloqueo de base clínica (Database Lock)"
            : pendingSignedStatus === "archivado"
              ? "Aprobación de archivo definitivo de estudio"
              : "Reapertura autorizada del ciclo de vida del estudio"
        }
        description="Esta transición impacta la congelación regulatoria del estudio y requiere reautenticación reciente y firma HMAC-SHA256."
        onClose={() => setPendingSignedStatus(null)}
        onSigned={async (manifest, reason) => {
          if (!user || !pendingSignedStatus) return;
          const updated = await updateStudyStatus(projectId, pendingSignedStatus, reason, user, manifest.id);
          setLifecycle(updated);
          toast.success(`Fase del estudio aprobada electrónicamente: ${STUDY_STATUS_LABEL[pendingSignedStatus]}.`);
          onLifecycleChanged?.();
        }}
      />
    </div>
  );
}
