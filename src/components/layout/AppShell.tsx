import { type ReactNode } from "react";
import { FolderKanban, LogOut, MailCheck, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../lib/AuthContext.tsx";
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
  const { user, signOutUser, resendVerification } = useAuth();

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

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A] dark:bg-[#0B1120] dark:text-[#F8FAFC]">
      <header className="sticky top-0 z-40 h-16 border-b border-slate-200 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6 min-w-0">
            <Link
              to="/"
              className="flex items-center gap-2.5 shrink-0 whitespace-nowrap group"
              data-testid="brand-logo"
            >
              <img
                src="/avicena-logo.svg"
                alt="Avicena"
                className="h-9 w-9 rounded-xl shadow-sm transition-transform group-hover:scale-[1.03]"
              />
              <span className="font-heading text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                Avicena
              </span>
            </Link>

            <nav className="flex items-center gap-1" aria-label="Navegación principal">
              <Link
                to="/"
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors",
                  pathname === "/" || pathname.startsWith("/proyectos") || pathname.startsWith("/formularios")
                    ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
                    : "text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white"
                )}
                data-testid="nav-estudios"
              >
                <FolderKanban className="h-4 w-4" />
                Estudios
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {user && !user.emailVerified && (
              <button
                type="button"
                onClick={handleResendVerification}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
                title="Verifica tu correo electrónico para sincronizar proyectos en la nube"
              >
                <MailCheck className="h-3.5 w-3.5" />
                Verificar correo
              </button>
            )}

            <div className="hidden sm:flex flex-col text-right leading-tight pr-1">
              <span className="text-xs font-semibold text-slate-900 dark:text-white">{displayName}</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">{displayEmail}</span>
            </div>

            <button
              type="button"
              onClick={() => void signOutUser()}
              data-testid="logout-btn"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Salir</span>
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Activar tema claro" : "Activar tema oscuro"}
              data-testid="theme-toggle"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
