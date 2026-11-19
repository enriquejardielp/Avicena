import { useState, type ReactNode } from "react";
import { FolderKanban, KeyRound, LogOut, MailCheck, Moon, ShieldCheck, Sun, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth, type TotpEnrollmentStart } from "../../lib/AuthContext.tsx";
import { errMsg } from "../../lib/api.ts";
import { Link, useLocation } from "../../lib/router.tsx";
import { useTheme } from "../../lib/theme.tsx";
import type { Me } from "../../lib/types.ts";
import { cn } from "../../lib/utils.ts";

interface AppShellProps {
  children: ReactNode;
  me?: Me | null;
}

export function AppShell({ children, me }: AppShellProps) {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const {
    user,
    mfaEnrolledFactors,
    hasActiveMfaSession,
    startTotpEnrollment,
    finalizeTotpEnrollment,
    unenrollMfaFactor,
    signOutUser,
    resendVerification,
  } = useAuth();

  const [securityOpen, setSecurityOpen] = useState(false);
  const [totpStart, setTotpStart] = useState<TotpEnrollmentStart | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  const displayName = me?.name || user?.displayName || user?.email?.split("@")[0] || "Investigador";
  const displayEmail = me?.email || user?.email || "";

  const handleResendVerification = async () => {
    try {
      await resendVerification();
      toast.success("Hemos reenviado el correo de verificación.");
    } catch (err) {
      toast.error(errMsg(err, "No se pudo reenviar el correo de verificación."));
    }
  };

  const handleBeginTotp = async () => {
    setMfaBusy(true);
    try {
      const started = await startTotpEnrollment();
      setTotpStart(started);
      setTotpCode("");
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
        toast.error(
          "MFA TOTP requiere habilitar Identity Platform / Multi-Factor Authentication en Firebase Console."
        );
      } else if (code === "auth/requires-recent-login") {
        toast.error("Por seguridad, cierra sesión y vuelve a entrar antes de registrar un factor MFA.");
      } else {
        toast.error(errMsg(err, "No se pudo iniciar la configuración TOTP."));
      }
    } finally {
      setMfaBusy(false);
    }
  };

  const handleConfirmTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpStart || !totpCode.trim()) return;
    setMfaBusy(true);
    try {
      await finalizeTotpEnrollment(totpStart.secret, totpCode);
      setTotpStart(null);
      setTotpCode("");
      toast.success("Autenticación multifactor (TOTP) activada correctamente.");
    } catch (err) {
      toast.error(errMsg(err, "Código TOTP no válido."));
    } finally {
      setMfaBusy(false);
    }
  };

  const handleUnenroll = async (factorUid: string) => {
    setMfaBusy(true);
    try {
      await unenrollMfaFactor(factorUid);
      toast.success("Factor MFA retirado de la cuenta.");
    } catch (err) {
      toast.error(errMsg(err, "No se pudo retirar el factor MFA."));
    } finally {
      setMfaBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F5F7] text-[#1D1D1F] dark:bg-black dark:text-[#F5F5F7]">
      <header className="sticky top-0 z-40 h-14 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0D0D0F]/80">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-8 px-4 sm:px-6">
          <div className="flex items-center gap-7 min-w-0">
            <Link
              to="/"
              className="flex items-center gap-2.5 shrink-0 whitespace-nowrap group"
              data-testid="brand-logo"
            >
              <img
                src="/avicena-logo.png"
                alt="Avicena"
                className="h-8 w-8 drop-shadow-xs transition-transform duration-200 group-hover:scale-[1.03]"
              />
              <span className="font-heading text-[17px] font-semibold tracking-tight text-[#1D1D1F] dark:text-white">
                Avicena
              </span>
            </Link>

            <nav className="flex items-center gap-1" aria-label="Navegación principal">
              <Link
                to="/"
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors",
                  pathname === "/" || pathname.startsWith("/proyectos") || pathname.startsWith("/formularios")
                    ? "bg-black/[0.05] text-[#1D1D1F] dark:bg-white/[0.1] dark:text-white"
                    : "text-[#6E6E73] hover:bg-black/[0.04] hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:bg-white/[0.06] dark:hover:text-white"
                )}
                data-testid="nav-estudios"
              >
                <FolderKanban className="h-3.5 w-3.5" />
                Estudios
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {user && !user.emailVerified && (
              <button
                type="button"
                onClick={handleResendVerification}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-amber-300/80 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
                title="Verifica tu correo electrónico para sincronizar proyectos en la nube"
              >
                <MailCheck className="h-3.5 w-3.5" />
                Verificar correo
              </button>
            )}

            <button
              type="button"
              onClick={() => setSecurityOpen(true)}
              data-testid="account-security-btn"
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-[#1D1D1F] transition-colors hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-[#2C2C2E]"
              title="Seguridad de cuenta y autenticación multifactor"
            >
              <ShieldCheck
                className={cn(
                  "h-3.5 w-3.5",
                  mfaEnrolledFactors.length > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-[#6E6E73] dark:text-[#98989D]"
                )}
              />
              <span className="hidden md:inline">Seguridad</span>
            </button>

            <div className="hidden sm:flex flex-col text-right leading-tight pr-1.5">
              <span className="text-xs font-semibold text-[#1D1D1F] dark:text-white">{displayName}</span>
              <span className="text-[11px] text-[#6E6E73] dark:text-[#98989D]">{displayEmail}</span>
            </div>

            <button
              type="button"
              onClick={() => void signOutUser()}
              data-testid="logout-btn"
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-[#1D1D1F] transition-colors hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-[#2C2C2E]"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Salir</span>
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Activar tema claro" : "Activar tema oscuro"}
              data-testid="theme-toggle"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-white text-[#6E6E73] transition-colors hover:bg-[#F5F5F7] hover:text-[#1D1D1F] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#98989D] dark:hover:bg-[#2C2C2E] dark:hover:text-white"
            >
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </header>

      {securityOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Seguridad de cuenta"
        >
          <div className="w-full max-w-lg rounded-[24px] border border-black/[0.08] bg-white p-6 shadow-2xl dark:border-white/[0.12] dark:bg-[#141416] space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-heading text-lg font-semibold text-[#1D1D1F] dark:text-white">
                  Seguridad de cuenta y sesión
                </h2>
                <p className="mt-0.5 text-xs text-[#6E6E73] dark:text-[#98989D]">
                  Controles de acceso y autenticación multifactor (MFA) real con Firebase Identity.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSecurityOpen(false);
                  setTotpStart(null);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] text-[#6E6E73] hover:text-[#1D1D1F] dark:border-white/[0.12] dark:text-[#98989D] dark:hover:text-white"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-2xl border border-black/[0.06] bg-[#F5F5F7]/70 p-4 space-y-2 text-xs dark:border-white/[0.08] dark:bg-[#1C1C1E]/70">
              <div className="flex items-center justify-between">
                <span className="text-[#6E6E73] dark:text-[#98989D]">Correo verificado</span>
                <span className={user?.emailVerified ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-semibold text-amber-600"}>
                  {user?.emailVerified ? "Verificado" : "Pendiente"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#6E6E73] dark:text-[#98989D]">Persistencia de sesión</span>
                <span className="font-medium text-[#1D1D1F] dark:text-white">Solo pestaña actual + bloqueo tras 15 min</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#6E6E73] dark:text-[#98989D]">Sesión con 2.º factor MFA</span>
                <span className={hasActiveMfaSession ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-medium text-[#6E6E73] dark:text-[#98989D]"}>
                  {hasActiveMfaSession ? "Activa" : "No en esta sesión"}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-[#1D1D1F] dark:text-white">
                    Autenticador TOTP (MFA)
                  </h3>
                  <p className="text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                    {mfaEnrolledFactors.length > 0
                      ? `${mfaEnrolledFactors.length} factor(es) registrado(s).`
                      : "Sin factores registrados todavía."}
                  </p>
                </div>
                {!totpStart && (
                  <button
                    type="button"
                    disabled={mfaBusy}
                    onClick={() => void handleBeginTotp()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF]"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    Configurar TOTP
                  </button>
                )}
              </div>

              {mfaEnrolledFactors.map((f) => (
                <div
                  key={f.uid}
                  className="flex items-center justify-between rounded-xl border border-black/[0.06] bg-white px-3.5 py-2.5 text-xs dark:border-white/[0.08] dark:bg-[#1C1C1E]"
                >
                  <div>
                    <div className="font-semibold text-[#1D1D1F] dark:text-white">
                      {f.displayName || "Autenticador TOTP"}
                    </div>
                    <div className="text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                      ID: {f.uid.slice(0, 12)}…
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={mfaBusy}
                    onClick={() => void handleUnenroll(f.uid)}
                    className="inline-flex items-center gap-1 rounded-full border border-rose-200 px-2.5 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-400"
                  >
                    <Trash2 className="h-3 w-3" />
                    Retirar
                  </button>
                </div>
              ))}

              {totpStart && (
                <form
                  onSubmit={(e) => void handleConfirmTotp(e)}
                  className="rounded-2xl border border-[#0071E3]/30 bg-[#0071E3]/[0.04] p-4 space-y-3 dark:border-[#0A84FF]/30 dark:bg-[#0A84FF]/[0.08]"
                >
                  <div className="text-xs font-semibold text-[#1D1D1F] dark:text-white">
                    1. Añade esta clave secreta en tu app autenticadora
                  </div>
                  <div className="rounded-xl bg-white px-3 py-2 font-mono text-xs select-all break-all text-[#1D1D1F] border border-black/[0.08] dark:bg-[#141416] dark:text-white dark:border-white/[0.1]">
                    {totpStart.secretKey}
                  </div>
                  <div className="text-[11px] text-[#6E6E73] dark:text-[#98989D] break-all">
                    URI TOTP: <span className="font-mono">{totpStart.qrCodeUri}</span>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                      2. Introduce el código de 6 dígitos para confirmar
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      placeholder="123456"
                      className="w-full rounded-xl border border-black/[0.1] bg-white px-3 py-2 font-mono text-sm tracking-widest text-[#1D1D1F] dark:border-white/[0.12] dark:bg-[#141416] dark:text-white"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setTotpStart(null)}
                      className="rounded-full border border-black/[0.08] bg-white px-3.5 py-1.5 text-xs font-medium text-[#1D1D1F] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={mfaBusy || !totpCode.trim()}
                      className="rounded-full bg-[#0071E3] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF]"
                    >
                      {mfaBusy ? "Activando…" : "Activar MFA"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      <main className="flex-1">{children}</main>
    </div>
  );
}
