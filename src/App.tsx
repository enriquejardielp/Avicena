import { useState } from "react";
import { MailCheck, RefreshCw, LogOut } from "lucide-react";
import { Toaster, toast } from "sonner";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { FirebaseAuthProvider, useAuth } from "./lib/AuthContext.tsx";
import { errMsg } from "./lib/api.ts";
import { matchPath, Router, useLocation } from "./lib/router.tsx";
import { ThemeProvider } from "./lib/theme.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import FormBuilderPage from "./pages/FormBuilderPage.tsx";
import FormFillPage from "./pages/FormFillPage.tsx";
import Landing from "./pages/Landing.tsx";
import ProjectPage from "./pages/ProjectPage.tsx";

function VerifyEmailGate() {
  const { user, resendVerification, reloadUserStatus, signOutUser } = useAuth();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const verified = await reloadUserStatus();
      if (verified) {
        toast.success("Correo verificado correctamente.");
      } else {
        toast.info("El correo todavía aparece sin verificar. Revisa tu bandeja o spam.");
      }
    } catch (err) {
      toast.error(errMsg(err, "No se pudo comprobar el estado de verificación."));
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await resendVerification();
      toast.success("Hemos enviado un nuevo enlace de verificación a tu correo.");
    } catch (err) {
      toast.error(errMsg(err, "No se pudo reenviar el correo de verificación."));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F5F7] px-4 dark:bg-black">
      <div className="w-full max-w-md rounded-[26px] border border-black/[0.07] bg-white p-8 text-center shadow-[0_20px_50px_-18px_rgba(0,0,0,0.1)] dark:border-white/[0.09] dark:bg-[#141416]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <MailCheck className="h-6 w-6" />
        </div>
        <h1 className="mt-4 font-heading text-xl font-semibold tracking-tight text-[#1D1D1F] dark:text-white">
          Verifica tu correo electrónico
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
          Por seguridad clínica y control de acceso, debes verificar{" "}
          <strong className="font-medium text-[#1D1D1F] dark:text-white">{user?.email || "tu cuenta"}</strong> antes de acceder a estudios clínicos.
        </p>

        <div className="mt-6 space-y-2.5">
          <button
            type="button"
            disabled={checking}
            onClick={() => void handleCheck()}
            data-testid="check-email-verified-btn"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#0071E3] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
          >
            <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
            {checking ? "Comprobando…" : "Ya lo he verificado"}
          </button>

          <button
            type="button"
            disabled={resending}
            onClick={() => void handleResend()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-black/[0.08] bg-white px-4 py-2.5 text-xs font-medium text-[#1D1D1F] transition-colors hover:bg-[#F5F5F7] disabled:opacity-60 dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-white dark:hover:bg-[#2C2C2E]"
          >
            {resending ? "Enviando…" : "Reenviar correo de verificación"}
          </button>

          <button
            type="button"
            onClick={() => void signOutUser()}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium text-[#6E6E73] transition-colors hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { pathname } = useLocation();
  const { user, authReady } = useAuth();

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F7] dark:bg-black">
        <div className="flex flex-col items-center gap-3">
          <img src="/avicena-logo.png" alt="Avicena" className="h-12 w-12 drop-shadow-sm animate-pulse" />
          <p className="text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">Cargando Avicena…</p>
        </div>
      </div>
    );
  }

  // Presentación acts as the Login gate when unauthenticated
  if (!user) {
    return <Landing />;
  }

  if (!user.emailVerified) {
    return <VerifyEmailGate />;
  }

  const newFormMatch = matchPath("/proyectos/:projectId/formularios/nuevo", pathname);
  if (newFormMatch) return <FormBuilderPage projectId={newFormMatch.projectId} />;

  const editScopedFormMatch = matchPath("/proyectos/:projectId/formularios/:formId/editar", pathname);
  if (editScopedFormMatch) {
    return <FormBuilderPage projectId={editScopedFormMatch.projectId} formId={editScopedFormMatch.formId} />;
  }

  const fillScopedFormMatch = matchPath("/proyectos/:projectId/formularios/:formId/capturar", pathname);
  if (fillScopedFormMatch) {
    return <FormFillPage projectId={fillScopedFormMatch.projectId} formId={fillScopedFormMatch.formId} />;
  }

  const editFormMatch = matchPath("/formularios/:formId/editar", pathname);
  if (editFormMatch) return <FormBuilderPage formId={editFormMatch.formId} />;

  const fillFormMatch = matchPath("/formularios/:formId/capturar", pathname);
  if (fillFormMatch) return <FormFillPage formId={fillFormMatch.formId} />;

  const projectMatch = matchPath("/proyectos/:projectId", pathname);
  if (projectMatch) return <ProjectPage projectId={projectMatch.projectId} />;

  return <Dashboard />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <FirebaseAuthProvider>
          <Router>
            <AppRoutes />
            <Toaster position="bottom-right" richColors closeButton />
          </Router>
        </FirebaseAuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
