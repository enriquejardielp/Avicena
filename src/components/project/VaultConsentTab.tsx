import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Eye,
  FileCheck2,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { errMsg } from "../../lib/api.ts";
import { useAuth } from "../../lib/AuthContext.tsx";
import {
  listConsents,
  listVaultSubjects,
  recordConsent,
  registerPseudonymizedSubject,
  reidentifySubject,
  updateConsentStatus,
} from "../../lib/firestoreDb.ts";
import {
  CONSENT_STATUS_LABEL,
  type ConsentMethod,
  type ConsentRecord,
  type ConsentStatus,
  type Role,
  type VaultSubjectSummary,
} from "../../lib/types.ts";
import { formatShortDate } from "../../lib/utils.ts";

interface VaultConsentTabProps {
  projectId: string;
  myRole: Role;
  canAccessVault: boolean;
  canRegisterVault: boolean;
  canWriteConsent: boolean;
}

const CONSENT_BADGE: Record<ConsentStatus, string> = {
  vigente: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  pendiente: "bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  requiere_reconsentimiento: "bg-orange-500/10 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  retirado: "bg-rose-500/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

export function VaultConsentTab({
  projectId,
  myRole,
  canAccessVault,
  canRegisterVault,
  canWriteConsent,
}: VaultConsentTabProps) {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<VaultSubjectSummary[]>([]);
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Registration form state
  const [fullName, setFullName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [nhc, setNhc] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [customPseudoId, setCustomPseudoId] = useState("");
  const [registering, setRegistering] = useState(false);

  // Consent form state
  const [consentSubjId, setConsentSubjId] = useState("");
  const [protocolVersion, setProtocolVersion] = useState("v1.0");
  const [documentTitle, setDocumentTitle] = useState("Hoja de información y consentimiento informado");
  const [consentMethod, setConsentMethod] = useState<ConsentMethod>("escrito");
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>("vigente");
  const [signedAt, setSignedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingConsent, setSavingConsent] = useState(false);

  // Controlled re-identification modal state
  const [reidTarget, setReidTarget] = useState<string | null>(null);
  const [reidReason, setReidReason] = useState("");
  const [reidentifying, setReidentifying] = useState(false);
  const [revealedIdentity, setRevealedIdentity] = useState<{
    subjectPseudoId: string;
    identity: {
      fullName: string;
      nationalId: string;
      nhc: string;
      birthDate?: string;
      phone?: string;
      email?: string;
    };
  } | null>(null);

  // Consent status update modal state
  const [withdrawTarget, setWithdrawTarget] = useState<{
    consent: ConsentRecord;
    nextStatus: ConsentStatus;
  } | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [subjRes, consRes] = await Promise.all([
        listVaultSubjects(projectId, canAccessVault),
        listConsents(projectId),
      ]);
      setSubjects(subjRes);
      setConsents(consRes);
      if (!consentSubjId && subjRes.length > 0) {
        setConsentSubjId(subjRes[0].subject_pseudo_id);
      }
    } catch (err) {
      toast.error(errMsg(err, "No se pudieron cargar los sujetos y consentimientos."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, canAccessVault]);

  const handleRegisterSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canRegisterVault) return;
    setRegistering(true);
    try {
      const created = await registerPseudonymizedSubject(
        projectId,
        {
          subjectPseudoId: customPseudoId.trim() || undefined,
          fullName: fullName.trim(),
          nationalId: nationalId.trim(),
          nhc: nhc.trim(),
          birthDate: birthDate.trim(),
          phone: phone.trim(),
          email: email.trim(),
        },
        user,
        canAccessVault
      );
      toast.success(
        `Participante sellado en bóveda cifrada bajo código pseudonimizado «${created.subject_pseudo_id}».`
      );
      setFullName("");
      setNationalId("");
      setNhc("");
      setBirthDate("");
      setPhone("");
      setEmail("");
      setCustomPseudoId("");
      setConsentSubjId(created.subject_pseudo_id);
      await load();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo pseudonimizar ni registrar al participante."));
    } finally {
      setRegistering(false);
    }
  };

  const handleRecordConsent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canWriteConsent) return;
    if (!consentSubjId.trim()) {
      toast.error("Selecciona o introduce un código pseudonimizado de participante.");
      return;
    }
    setSavingConsent(true);
    try {
      await recordConsent(
        projectId,
        {
          subjectPseudoId: consentSubjId.trim(),
          protocolVersion: protocolVersion.trim(),
          documentTitle: documentTitle.trim(),
          method: consentMethod,
          status: consentStatus,
          signedAt,
        },
        user
      );
      toast.success(`Consentimiento (${CONSENT_STATUS_LABEL[consentStatus]}) registrado para ${consentSubjId}.`);
      await load();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo registrar el consentimiento informado."));
    } finally {
      setSavingConsent(false);
    }
  };

  const handleReidentify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !reidTarget || !canAccessVault) return;
    if (reidReason.trim().length < 15) {
      toast.error("Debes especificar una justificación clínica o regulatoria de al menos 15 caracteres.");
      return;
    }
    setReidentifying(true);
    try {
      const res = await reidentifySubject(projectId, reidTarget, reidReason.trim(), user);
      setRevealedIdentity(res);
      toast.warning(`Acceso de reidentificación auditado para ${reidTarget}.`);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo descifrar la identidad del participante."));
    } finally {
      setReidentifying(false);
    }
  };

  const handleConfirmStatusUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !withdrawTarget) return;
    if (statusReason.trim().length < 5) {
      toast.error("Indica un motivo de al menos 5 caracteres.");
      return;
    }
    setUpdatingStatus(true);
    try {
      await updateConsentStatus(
        projectId,
        withdrawTarget.consent,
        withdrawTarget.nextStatus,
        statusReason.trim(),
        user
      );
      toast.success(
        `Consentimiento de ${withdrawTarget.consent.subject_pseudo_id} actualizado a ${CONSENT_STATUS_LABEL[withdrawTarget.nextStatus]}.`
      );
      setWithdrawTarget(null);
      setStatusReason("");
      await load();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo actualizar el estado del consentimiento."));
    } finally {
      setUpdatingStatus(false);
    }
  };

  const closeReidModal = () => {
    setReidTarget(null);
    setReidReason("");
    setRevealedIdentity(null);
  };

  const inputClass =
    "w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2 text-xs text-[#1D1D1F] placeholder:text-[#86868B] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15";

  return (
    <div className="space-y-6">
      {/* Architecture Separation Notice */}
      <div className="apple-card flex flex-wrap items-start gap-3 rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0071E3]/10 text-[#0071E3] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]">
          <KeyRound className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-[240px]">
          <h3 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
            Separación lógica de identidades y pseudonimización (AES-256-GCM + Índice ciego HMAC)
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
            Los datos identificativos civiles (nombre, DNI/NIE, NHC, contacto) se cifran en servidor con clave derivada por estudio y se almacenan aislados en la colección <code className="font-mono">identityVault</code>. Las variables clínicas de investigación utilizan únicamente códigos pseudonimizados (<code className="font-mono">SUBJ-...</code>).
            {!canAccessVault && (
              <>
                {" "}Tu rol actual (<strong>{myRole}</strong>) no autoriza la lectura ni reidentificación de la bóveda civil.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Panel 1: Pseudonymization & Identity Vault */}
        <div className="lg:col-span-6 space-y-5">
          {canRegisterVault && (
            <form
              onSubmit={handleRegisterSubject}
              className="apple-card rounded-2xl border border-black/[0.06] bg-white p-6 space-y-4 dark:border-white/[0.08] dark:bg-[#141416]"
            >
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-[#0071E3] dark:text-[#0A84FF]" />
                <h3 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                  Registrar y pseudonimizar participante
                </h3>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Nombre y apellidos (solo bóveda cifrada) *
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nombre completo del participante"
                    className={inputClass}
                    data-testid="vault-fullname-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    DNI / NIE / Pasaporte *
                  </label>
                  <input
                    type="text"
                    required
                    minLength={4}
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    placeholder="Documento civil"
                    className={`${inputClass} font-mono`}
                    data-testid="vault-nationalid-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    NHC / Historia clínica
                  </label>
                  <input
                    type="text"
                    value={nhc}
                    onChange={(e) => setNhc(e.target.value)}
                    placeholder="Opcional"
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Fecha de nacimiento
                  </label>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Teléfono / Contacto
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Opcional"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Opcional"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Código estudio (opcional)
                  </label>
                  <input
                    type="text"
                    value={customPseudoId}
                    onChange={(e) => setCustomPseudoId(e.target.value)}
                    placeholder="Automático SUBJ-..."
                    className={`${inputClass} font-mono`}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-[#86868B]">
                  Detecta duplicados mediante índice ciego HMAC sin exponer el DNI.
                </span>
                <button
                  type="submit"
                  disabled={registering || !fullName.trim() || !nationalId.trim()}
                  data-testid="vault-register-btn"
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
                >
                  <Lock className="h-3.5 w-3.5" />
                  {registering ? "Cifrando…" : "Pseudonimizar y guardar"}
                </button>
              </div>
            </form>
          )}

          {/* Pseudonymized subjects table (NO plaintext PII displayed) */}
          <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-6 space-y-3 dark:border-white/[0.08] dark:bg-[#141416]">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                Participantes pseudonimizados ({subjects.length})
              </h3>
              <span className="text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                Identidades cifradas en reposo
              </span>
            </div>

            {loading ? (
              <p className="py-6 text-center text-xs text-[#86868B]">Cargando participantes…</p>
            ) : !subjects.length ? (
              <p className="py-6 text-center text-xs text-[#86868B]">
                No hay participantes registrados en la bóveda de este estudio.
              </p>
            ) : (
              <div className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                {subjects.map((subj) => (
                  <div key={subj.subject_pseudo_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                          {subj.subject_pseudo_id}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${CONSENT_BADGE[subj.consent_status]}`}
                        >
                          Consentimiento: {CONSENT_STATUS_LABEL[subj.consent_status]}
                        </span>
                      </div>
                      {subj.created_at && (
                        <div className="mt-0.5 text-[11px] text-[#86868B]">
                          Alta en bóveda: {formatShortDate(subj.created_at)}
                        </div>
                      )}
                    </div>

                    {canAccessVault && (
                      <button
                        type="button"
                        onClick={() => {
                          setReidTarget(subj.subject_pseudo_id);
                          setReidReason("");
                          setRevealedIdentity(null);
                        }}
                        data-testid={`reidentify-btn-${subj.subject_pseudo_id}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/80 bg-amber-50/70 px-3 py-1.5 text-[11px] font-medium text-amber-900 transition hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                      >
                        <Eye className="h-3 w-3" />
                        Reidentificar (auditado)
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Panel 2: Informed Consents */}
        <div className="lg:col-span-6 space-y-5">
          {canWriteConsent && (
            <form
              onSubmit={handleRecordConsent}
              className="apple-card rounded-2xl border border-black/[0.06] bg-white p-6 space-y-4 dark:border-white/[0.08] dark:bg-[#141416]"
            >
              <div className="flex items-center gap-2">
                <FileCheck2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                  Registrar consentimiento informado
                </h3>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Código pseudonimizado *
                  </label>
                  {subjects.length > 0 ? (
                    <select
                      value={consentSubjId}
                      onChange={(e) => setConsentSubjId(e.target.value)}
                      className={`${inputClass} font-mono`}
                      data-testid="consent-subject-select"
                    >
                      {subjects.map((s) => (
                        <option key={s.subject_pseudo_id} value={s.subject_pseudo_id}>
                          {s.subject_pseudo_id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      value={consentSubjId}
                      onChange={(e) => setConsentSubjId(e.target.value)}
                      placeholder="SUBJ-..."
                      className={`${inputClass} font-mono`}
                    />
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Versión del protocolo *
                  </label>
                  <input
                    type="text"
                    required
                    value={protocolVersion}
                    onChange={(e) => setProtocolVersion(e.target.value)}
                    placeholder="v1.0"
                    className={`${inputClass} font-mono`}
                    data-testid="consent-protocol-input"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Documento ético / Hoja de consentimiento *
                  </label>
                  <input
                    type="text"
                    required
                    value={documentTitle}
                    onChange={(e) => setDocumentTitle(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Modalidad
                  </label>
                  <select
                    value={consentMethod}
                    onChange={(e) => setConsentMethod(e.target.value as ConsentMethod)}
                    className={inputClass}
                  >
                    <option value="escrito">Firma escrita presencial</option>
                    <option value="electronico">Consentimiento electrónico (eConsent)</option>
                    <option value="testigo_imparcial">Testigo imparcial / representante</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Estado inicial
                  </label>
                  <select
                    value={consentStatus}
                    onChange={(e) => setConsentStatus(e.target.value as ConsentStatus)}
                    className={inputClass}
                    data-testid="consent-status-select"
                  >
                    <option value="vigente">Vigente</option>
                    <option value="pendiente">Pendiente</option>
                    <option value="requiere_reconsentimiento">Requiere reconsentimiento</option>
                    <option value="retirado">Retirado</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Fecha de firma *
                  </label>
                  <input
                    type="date"
                    required
                    value={signedAt}
                    onChange={(e) => setSignedAt(e.target.value)}
                    className={`${inputClass} font-mono`}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingConsent || !consentSubjId.trim()}
                  data-testid="save-consent-btn"
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {savingConsent ? "Guardando…" : "Registrar consentimiento"}
                </button>
              </div>
            </form>
          )}

          {/* Consent History */}
          <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-6 space-y-3 dark:border-white/[0.08] dark:bg-[#141416]">
            <h3 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
              Registro de consentimientos informados ({consents.length})
            </h3>

            {loading ? (
              <p className="py-6 text-center text-xs text-[#86868B]">Cargando consentimientos…</p>
            ) : !consents.length ? (
              <p className="py-6 text-center text-xs text-[#86868B]">
                No hay consentimientos registrados todavía.
              </p>
            ) : (
              <div className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                {consents.map((c) => (
                  <div key={c.id} className="py-3.5 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                          {c.subject_pseudo_id}
                        </span>
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${CONSENT_BADGE[c.status]}`}>
                          {CONSENT_STATUS_LABEL[c.status]}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-[#86868B]">
                        Protocolo {c.protocol_version} · {c.signed_at}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                      {c.document_title} · Registrado por {c.recorded_by_name}
                    </div>
                    {c.withdrawal_reason && (
                      <div className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                        Motivo de retirada/cambio: {c.withdrawal_reason}
                      </div>
                    )}
                    {canWriteConsent && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {c.status !== "vigente" && (
                          <button
                            type="button"
                            onClick={() => {
                              setWithdrawTarget({ consent: c, nextStatus: "vigente" });
                              setStatusReason("");
                            }}
                            className="rounded-full border border-emerald-200 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                          >
                            Marcar vigente
                          </button>
                        )}
                        {c.status !== "requiere_reconsentimiento" && (
                          <button
                            type="button"
                            onClick={() => {
                              setWithdrawTarget({ consent: c, nextStatus: "requiere_reconsentimiento" });
                              setStatusReason("");
                            }}
                            className="rounded-full border border-orange-200 bg-orange-50/60 px-2.5 py-1 text-[11px] font-medium text-orange-700 hover:bg-orange-100 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300"
                          >
                            Solicitar reconsentimiento
                          </button>
                        )}
                        {c.status !== "retirado" && (
                          <button
                            type="button"
                            onClick={() => {
                              setWithdrawTarget({ consent: c, nextStatus: "retirado" });
                              setStatusReason("");
                            }}
                            className="rounded-full border border-rose-200 bg-rose-50/60 px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                          >
                            Retirar consentimiento
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Controlled Re-identification Modal */}
      {reidTarget && canAccessVault && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-black/[0.08] bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#141416]">
            <div className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4 dark:border-white/[0.08]">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <h3 className="font-heading text-base font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                  Reidentificación controlada · {reidTarget}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeReidModal}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#86868B] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Este acceso queda registrado de forma inmutable en la cadena de auditoría HMAC (<code className="font-mono">REIDENTIFICATION_ACCESS</code>) con tu usuario, rol, fecha UTC y motivo declarado.
                </span>
              </div>

              {!revealedIdentity ? (
                <form onSubmit={handleReidentify} className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                      Motivo clínico o regulatorio justificado (mínimo 15 caracteres) *
                    </label>
                    <textarea
                      rows={3}
                      required
                      minLength={15}
                      value={reidReason}
                      onChange={(e) => setReidReason(e.target.value)}
                      placeholder="Ej: Notificación de acontecimiento adverso grave / ejercicio de derecho de acceso RGPD"
                      className={inputClass}
                      data-testid="reidentify-reason-input"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeReidModal}
                      className="rounded-full border border-black/[0.08] px-4 py-2 text-xs font-medium text-[#1D1D1F] dark:border-white/[0.12] dark:text-[#F5F5F7]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={reidentifying || reidReason.trim().length < 15}
                      data-testid="confirm-reidentify-btn"
                      className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {reidentifying ? "Descifrando…" : "Revelar identidad"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-3 text-xs">
                  <div className="rounded-2xl border border-black/[0.08] bg-[#F5F5F7]/70 p-4 space-y-2 dark:border-white/[0.08] dark:bg-[#1C1C1E]">
                    <div>
                      <span className="text-[#6E6E73] dark:text-[#98989D]">Nombre completo: </span>
                      <strong className="text-[#1D1D1F] dark:text-white">{revealedIdentity.identity.fullName}</strong>
                    </div>
                    <div>
                      <span className="text-[#6E6E73] dark:text-[#98989D]">DNI / Documento civil: </span>
                      <strong className="font-mono text-[#1D1D1F] dark:text-white">
                        {revealedIdentity.identity.nationalId}
                      </strong>
                    </div>
                    {revealedIdentity.identity.nhc && (
                      <div>
                        <span className="text-[#6E6E73] dark:text-[#98989D]">NHC / Historia clínica: </span>
                        <strong className="font-mono text-[#1D1D1F] dark:text-white">
                          {revealedIdentity.identity.nhc}
                        </strong>
                      </div>
                    )}
                    {revealedIdentity.identity.birthDate && (
                      <div>
                        <span className="text-[#6E6E73] dark:text-[#98989D]">Fecha nacimiento: </span>
                        <strong className="font-mono text-[#1D1D1F] dark:text-white">
                          {revealedIdentity.identity.birthDate}
                        </strong>
                      </div>
                    )}
                    {revealedIdentity.identity.phone && (
                      <div>
                        <span className="text-[#6E6E73] dark:text-[#98989D]">Teléfono: </span>
                        <strong className="text-[#1D1D1F] dark:text-white">{revealedIdentity.identity.phone}</strong>
                      </div>
                    )}
                    {revealedIdentity.identity.email && (
                      <div>
                        <span className="text-[#6E6E73] dark:text-[#98989D]">Correo: </span>
                        <strong className="text-[#1D1D1F] dark:text-white">{revealedIdentity.identity.email}</strong>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={closeReidModal}
                      className="rounded-full bg-[#0071E3] px-5 py-2 text-xs font-medium text-white hover:bg-[#0077ED]"
                    >
                      Ocultar y cerrar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Consent Status Update Modal */}
      {withdrawTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-black/[0.08] bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#141416]">
            <div className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4 dark:border-white/[0.08]">
              <h3 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                Cambiar estado a «{CONSENT_STATUS_LABEL[withdrawTarget.nextStatus]}»
              </h3>
              <button
                type="button"
                onClick={() => setWithdrawTarget(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#86868B] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmStatusUpdate} className="p-6 space-y-4">
              <div className="text-xs text-[#6E6E73] dark:text-[#98989D]">
                Participante: <strong className="font-mono text-[#1D1D1F] dark:text-white">{withdrawTarget.consent.subject_pseudo_id}</strong>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Motivo documentado (mínimo 5 caracteres) *
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  placeholder="Describe la solicitud del participante o enmienda del protocolo"
                  className={inputClass}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setWithdrawTarget(null)}
                  className="rounded-full border border-black/[0.08] px-4 py-2 text-xs font-medium text-[#1D1D1F] dark:border-white/[0.12] dark:text-[#F5F5F7]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={updatingStatus || statusReason.trim().length < 5}
                  className="rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white hover:bg-[#0077ED] disabled:opacity-60"
                >
                  {updatingStatus ? "Guardando…" : "Confirmar cambio"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
