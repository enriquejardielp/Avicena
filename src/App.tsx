import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { FirebaseAuthProvider, useAuth } from "./lib/AuthContext.tsx";
import { matchPath, Router, useLocation } from "./lib/router.tsx";
import { ThemeProvider } from "./lib/theme.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import FormBuilderPage from "./pages/FormBuilderPage.tsx";
import FormFillPage from "./pages/FormFillPage.tsx";
import Landing from "./pages/Landing.tsx";
import ProjectPage from "./pages/ProjectPage.tsx";

function AppRoutes() {
  const { pathname } = useLocation();
  const { user, authReady } = useAuth();

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-[#0B1120]">
        <div className="flex flex-col items-center gap-3">
          <img src="/avicena-logo.svg" alt="Avicena" className="h-11 w-11 rounded-xl shadow-sm animate-pulse" />
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Cargando Avicena…</p>
        </div>
      </div>
    );
  }

  // Presentación acts as the Login gate when unauthenticated
  if (!user) {
    return <Landing />;
  }

  const newFormMatch = matchPath("/proyectos/:projectId/formularios/nuevo", pathname);
  if (newFormMatch) return <FormBuilderPage projectId={newFormMatch.projectId} />;

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
