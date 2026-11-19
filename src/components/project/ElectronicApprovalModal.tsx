import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { errMsg } from "../../lib/api.ts";
import { useAuth } from "../../lib/AuthContext.tsx";
import { signElectronicApproval } from "../../lib/firestoreDb.ts";
import type { ElectronicSignatureManifest } from "../../lib/types.ts";

interface ElectronicApprovalModalProps {
  open: boolean;
  projectId: string;
  targetType: "crf_record" | "study_lifecycle";
  targetId: string;
  targetVersion?: number;
  actionTitle: string;
  defaultMeaning: string;
  description?: string;
  requireReason?: boolean;
  onClose: () => void;
  onSigned: (manifest: ElectronicSignatureManifest, reason: string) => Promise<void>;
}

export function ElectronicApprovalModal({
  open,
  projectId,
  targetType,
  targetId,
  targetVersion,
  actionTitle,
  defaultMeaning,
  description,
  requireReason = true,
  onClose,
  onSigned,
}: ElectronicApprovalModalProps) {
  const { user, authProviderKind, reauthenticateSession } = useAuth();
  const [meaning, setMeaning] = useState(defaultMeaning);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setMeaning(defaultMeaning);
      setReason("");
      setPassword("");
    }
  }, [open, defaultMeaning, targetId]);

  if (!open) return null;

  const isPasswordProvider = authProviderKind === "password";
  const reasonTrimmed = reason.trim();
  const canSubmit =
    !submitting &&
    Boolean(user) &&
    meaning.trim().length >= 3 &&
    (!requireReason || reasonTrimmed.length >= 5) &&
    (!isPasswordProvider || password.length >= 6);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (requireReason && reasonTrimmed.length < 5) {
      toast.error("Indica un motivo de aprobación de al menos 5 caracteres.");
      return;
    }
    if (isPasswordProvider && !password) {
      toast.error("Introduce tu contraseña actual para confirmar tu identidad.");
      return;
    }

    setSubmitting(true);
    try {
      await reauthenticateSession(isPasswordProvider ? password : undefined);
      const effectiveReason = reasonTrimmed || `${meaning.trim()} (${targetId})`;
      const manifest = await signElectronicApproval(
        projectId,
        {
          targetType,
          targetId,
          ...(targetVersion !== undefined ? { targetVersion } : {}),
          meaning: meaning.trim(),
          reason: effectiveReason,
        },
        user
      );
      await onSigned(manifest, effectiveReason);
      setPassword("");
      setReason("");
      onClose();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo completar la reautenticación y aprobación electrónica."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="electronic-approval-title"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-black/[0.08] bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#141416]">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4 dark:border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#0071E3]/10 text-[#0071E3] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div>
              <h3
                id="electronic-approval-title"
                className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]"
              >
                {actionTitle}
              </h3>
              <p className="font-mono text-[11px] tabular-nums text-[#86868B]">
                {targetType === "crf_record" ? "Registro CRF" : "Ciclo de vida del estudio"} · {targetId}
                {targetVersion !== undefined ? ` · v${targetVersion}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#86868B] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-4">
          {description && (
            <p className="text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">{description}</p>
          )}

          <div className="rounded-2xl border border-[#0071E3]/20 bg-[#0071E3]/[0.05] px-4 py-3 text-[11px] leading-relaxed text-[#1D1D1F] dark:border-[#0A84FF]/25 dark:bg-[#0A84FF]/[0.08] dark:text-[#E5E5EA]">
            <strong>Aprobación electrónica con reautenticación</strong> (trazabilidad técnica alineada con 21 CFR Part 11 e ICH E6(R3) mediante reautenticación reciente y sellado HMAC-SHA256;{" "}
            <strong>no sustituye</strong> a una Firma Electrónica Cualificada eIDAS).
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
              Significado de la aprobación *
            </label>
            <input
              type="text"
              required
              minLength={3}
              maxLength={120}
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
              data-testid="esign-meaning-input"
              className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
              Motivo / justificación clínica {requireReason ? "(obligatorio, mín. 5 caracteres) *" : "(opcional)"}
            </label>
            <textarea
              rows={2}
              required={requireReason}
              minLength={requireReason ? 5 : 0}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: Revisión de datos fuente (SDV) completada sin discrepancias"
              data-testid="esign-reason-input"
              className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
            />
          </div>

          <div className="rounded-2xl border border-black/[0.06] bg-[#F5F5F7]/70 p-4 space-y-2.5 dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
              <KeyRound className="h-3.5 w-3.5 text-[#0071E3] dark:text-[#0A84FF]" />
              Reautenticación obligatoria ({user?.email || "usuario autenticado"})
            </div>
            {isPasswordProvider ? (
              <div>
                <label className="mb-1 block text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                  Introduce nuevamente tu contraseña de acceso para emitir la atestación firmada:
                </label>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Contraseña actual"
                  data-testid="esign-password-input"
                  className="w-full rounded-xl border border-black/[0.08] bg-white px-3.5 py-2 text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:outline-none dark:border-white/[0.1] dark:bg-[#141416] dark:text-[#F5F5F7]"
                />
              </div>
            ) : (
              <p className="text-[11px] leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                Al confirmar se abrirá la ventana segura de tu proveedor ({authProviderKind === "google" ? "Google" : "SSO institucional"}) para verificar tu sesión en este instante (ventana máxima 300 s).
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="rounded-full border border-black/[0.08] px-4 py-2 text-xs font-medium text-[#1D1D1F] transition hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:text-[#F5F5F7] dark:hover:bg-white/[0.06]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="esign-confirm-btn"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#0077ED] disabled:opacity-50 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {submitting ? "Reautenticando y firmando…" : "Reautenticar y aprobar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
