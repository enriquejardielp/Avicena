import { Routes, Route } from "react-router-dom";
import { SignIn, SignUp } from "@clerk/react";
import ClerkAuthProvider from "@/components/auth/ClerkAuthProvider";
import { AuthBridge } from "@/components/auth/AuthBridge";
import AppShell from "@/components/layout/AppShell";
import { Toaster } from "@/components/ui/sonner";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import ProjectPage from "@/pages/ProjectPage";
import FormBuilderPage from "@/pages/FormBuilderPage";
import FormFillPage from "@/pages/FormFillPage";
import UsersPage from "@/pages/UsersPage";
import AuthPage from "@/pages/AuthPage";

export default function App() {
  return (
    <ClerkAuthProvider>
      <AuthBridge>
        <Routes>
          <Route path="/bienvenida" element={<Landing />} />
          <Route path="/sign-in/*" element={<AuthPage><SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" withSignUp /></AuthPage>} />
          <Route path="/sign-up/*" element={<AuthPage><SignUp routing="path" path="/sign-up" signInUrl="/sign-in" /></AuthPage>} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/proyectos/:projectId" element={<ProjectPage />} />
            <Route path="/formularios/:formId/editar" element={<FormBuilderPage />} />
            <Route path="/proyectos/:projectId/formularios/nuevo" element={<FormBuilderPage />} />
            <Route path="/formularios/:formId/capturar" element={<FormFillPage />} />
            <Route path="/usuarios" element={<UsersPage />} />
          </Route>
          <Route path="*" element={<Landing />} />
        </Routes>
        <Toaster richColors />
      </AuthBridge>
    </ClerkAuthProvider>
  );
}
