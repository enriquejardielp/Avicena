import { useState } from "react";
import { ArrowRight, Building2, FileText, KeyRound, Lock, Mail, Moon, ShieldCheck, Sun, User } from "lucide-react";
import TechnicalSecurityReportModal from "../components/landing/TechnicalSecurityReportModal.tsx";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { useAuth, validatePasswordStrength } from "../lib/AuthContext.tsx";
import { useTheme } from "../lib/theme.tsx";
import { cn } from "../lib/utils.ts";

type ShowcaseTab = "km" | "roc" | "hr";

const KM_PREVIEW_DATA = [
  { mes: 0, terapia: 100, control: 100 },
  { mes: 3, terapia: 96.4, control: 92.1 },
  { mes: 6, terapia: 92.8, control: 83.5 },
  { mes: 9, terapia: 88.6, control: 74.2 },
  { mes: 12, terapia: 84.1, control: 65.8 },
  { mes: 15, terapia: 80.5, control: 58.4 },
  { mes: 18, terapia: 77.2, control: 52.0 },
  { mes: 21, terapia: 74.8, control: 46.7 },
  { mes: 24, terapia: 72.5, control: 42.3 },
];

const ROC_PREVIEW_DATA = [
  { fpr: 0, tpr: 0 },
  { fpr: 0.04, tpr: 0.34 },
  { fpr: 0.09, tpr: 0.58 },
  { fpr: 0.15, tpr: 0.76 },
  { fpr: 0.22, tpr: 0.85 },
  { fpr: 0.32, tpr: 0.91 },
  { fpr: 0.48, tpr: 0.95 },
  { fpr: 0.68, tpr: 0.98 },
  { fpr: 1, tpr: 1 },
];

const HR_PREVIEW_DATA = [
  { factor: "Tratamiento A", hr: 0.56, ic: "0,39 – 0,81" },
  { factor: "FEV1 (+10%)", hr: 0.78, ic: "0,65 – 0,94" },
  { factor: "Edad (>65)", hr: 1.62, ic: "1,14 – 2,31" },
  { factor: "Tabaquismo", hr: 2.18, ic: "1,38 – 3,45" },
];

function translateAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  const msg = err instanceof Error ? err.message : String(err);
  if (code === "auth/popup-closed-by-user") return "Se cerró la ventana de Google antes de completar el acceso.";
  if (code === "auth/cancelled-popup-request") return "Operación de acceso cancelada.";
  if (code === "auth/popup-blocked") {
    return "El navegador bloqueó la ventana emergente de Google. Permite las ventanas emergentes para continuar.";
  }
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Correo o contraseña incorrectos.";
  }
  if (code === "auth/email-already-in-use") {
    return "Ya existe una cuenta registrada con ese correo. Inicia sesión o recupera tu contraseña.";
  }
  if (code === "auth/weak-password") {
    return "La contraseña debe tener al menos 12 caracteres, mayúscula, minúscula, número y símbolo.";
  }
  if (code === "auth/invalid-email") {
    return "Introduce una dirección de correo electrónico válida.";
  }
  if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
    return "Este método de acceso no está habilitado en la consola de autenticación.";
  }
  if (code === "auth/invalid-verification-code" || code === "auth/code-expired") {
    return "El código TOTP de verificación no es válido o ha caducado.";
  }
  if (code === "auth/too-many-requests") {
    return "Demasiados intentos seguidos. Espera unos segundos e inténtalo de nuevo.";
  }
  return msg || "No se pudo completar la autenticación.";
}

export default function Landing() {
  const {
    signInWithGoogle,
    signInWithInstitutionalSso,
    signInWithEmail,
    signUpWithEmail,
    resetPassword,
    pendingMfaResolver,
    resolveMfaSignIn,
    cancelMfaChallenge,
    ssoProviderId,
    ssoProviderLabel,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [showcase, setShowcase] = useState<ShowcaseTab>("km");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const handleGoogle = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      toast.success("Sesión iniciada con Google.");
    } catch (err) {
      if (err instanceof Error && err.message === "MFA_CHALLENGE_REQUIRED") {
        toast.info("Introduce el código de tu aplicación autenticadora para completar el acceso.");
      } else {
        const m = translateAuthError(err);
        setErrorMsg(m);
        toast.error(m);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleInstitutionalSso = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      await signInWithInstitutionalSso();
      toast.success("Sesión iniciada mediante SSO institucional.");
    } catch (err) {
      if (err instanceof Error && err.message === "MFA_CHALLENGE_REQUIRED") {
        toast.info("Introduce el código de tu aplicación autenticadora para completar el acceso.");
      } else {
        const m = translateAuthError(err);
        setErrorMsg(m);
        toast.error(m);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.trim() || !password) return;
    if (mode === "register") {
      if (!name.trim()) {
        setErrorMsg("Introduce tu nombre completo para crear la cuenta.");
        return;
      }
      const strengthErr = validatePasswordStrength(password);
      if (strengthErr) {
        setErrorMsg(strengthErr);
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await signInWithEmail(email, password);
        toast.success("Bienvenido a Avicena.");
      } else {
        await signUpWithEmail(name, email, password);
        toast.success("Cuenta creada. Hemos enviado un correo de verificación a tu bandeja.");
      }
    } catch (err) {
      if (err instanceof Error && err.message === "MFA_CHALLENGE_REQUIRED") {
        toast.info("Introduce el código TOTP de tu aplicación autenticadora.");
      } else {
        const m = translateAuthError(err);
        setErrorMsg(m);
        toast.error(m);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaCode.trim()) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await resolveMfaSignIn(mfaCode);
      setMfaCode("");
      toast.success("Segundo factor verificado. Bienvenido a Avicena.");
    } catch (err) {
      const m = translateAuthError(err);
      setErrorMsg(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setErrorMsg("Escribe primero tu correo electrónico para enviarte el enlace de recuperación.");
      return;
    }
    setErrorMsg(null);
    setBusy(true);
    try {
      await resetPassword(email);
      toast.success(`Enviamos un correo de recuperación a ${email.trim()}.`);
    } catch (err) {
      const m = translateAuthError(err);
      setErrorMsg(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  };

  const gridStroke = theme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const tickFill = theme === "dark" ? "#98989D" : "#6E6E73";

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F5F7] text-[#1D1D1F] dark:bg-black dark:text-[#F5F5F7]">
      {/* Frosted Top Navigation */}
      <header
        className={cn(
          "sticky top-0 z-40 h-14 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0D0D0F]/80",
          reportOpen && "no-print"
        )}
      >
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <img src="/avicena-logo.png" alt="Avicena" className="h-8 w-8 drop-shadow-xs" />
            <span className="font-heading text-[17px] font-semibold tracking-tight text-[#1D1D1F] dark:text-white">
              Avicena
            </span>
          </div>

          <div className="flex items-center gap-5 sm:gap-6">
            <nav aria-label="Navegación de seguridad" className="hidden items-center gap-5 sm:flex">
              <a
                href="#seguridad-publica"
                className="text-xs font-medium text-[#424245] transition-colors hover:text-[#1D1D1F] dark:text-[#A1A1A6] dark:hover:text-white"
              >
                Seguridad y privacidad
              </a>
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                data-testid="header-technical-report-btn"
                className="text-xs font-medium text-[#0071E3] transition-colors hover:text-[#0077ED] dark:text-[#0A84FF] dark:hover:text-[#389BFF]"
              >
                Informe para expertos
              </button>
            </nav>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Activar tema claro" : "Activar tema oscuro"}
              data-testid="theme-toggle"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-white text-[#6E6E73] transition-colors hover:bg-[#F5F5F7] hover:text-[#1D1D1F] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#98989D] dark:hover:bg-[#2C2C2E] dark:hover:text-white"
            >
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </header>

      <main className={cn("mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:py-14", reportOpen && "no-print")}>
        <div className="grid w-full grid-cols-1 gap-10 lg:grid-cols-12 lg:items-center lg:gap-12">
          {/* Left Column: Crisp Editorial Positioning & Interactive Statistical Figure */}
          <section className="lg:col-span-7 space-y-8">
            <div className="space-y-4">
              <h1 className="max-w-2xl font-heading text-4xl font-semibold tracking-[-0.03em] leading-[1.06] text-[#1D1D1F] sm:text-5xl dark:text-white text-balance">
                Tus cohortes, tus cuadernos clínicos y tu estadística, juntos.
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-[#6E6E73] sm:text-[17px] dark:text-[#A1A1A6]">
                Diseña formularios para tu equipo, importa hojas en CSV o Excel y obtén tablas y gráficas listas para copiar directamente a Word.
              </p>
            </div>

            {/* Interactive Clinical Visualization Showcase */}
            <div className="rounded-[22px] border border-black/[0.06] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_40px_-16px_rgba(0,0,0,0.08)] dark:border-white/[0.09] dark:bg-[#141416] dark:shadow-[0_16px_48px_-16px_rgba(0,0,0,0.75)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] pb-4 dark:border-white/[0.08]">
                <div>
                  <h2 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
                    {showcase === "km"
                      ? "Supervivencia acumulada por brazo (Kaplan-Meier)"
                      : showcase === "roc"
                        ? "Curva ROC y discriminación diagnóstica"
                        : "Modelo multivariable de Cox (Hazard Ratios)"}
                  </h2>
                  <p className="mt-0.5 font-mono text-xs tabular-nums text-[#6E6E73] dark:text-[#98989D]">
                    {showcase === "km"
                      ? "Log-Rank χ² = 6,84 · p = 0,009 · Mediana control: 20,1 meses"
                      : showcase === "roc"
                        ? "AUC = 0,884 (IC 95%: 0,821 – 0,947) · Índice de Youden: 0,63"
                        : "C-index de Harrell = 0,79 · N = 180 · 46 eventos"}
                  </p>
                </div>

                {/* Apple-style Segmented Control */}
                <div className="flex items-center gap-0.5 rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.07]">
                  {[
                    { id: "km" as const, label: "Kaplan-Meier" },
                    { id: "roc" as const, label: "Curva ROC" },
                    { id: "hr" as const, label: "Regresión Cox" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setShowcase(tab.id)}
                      className={cn(
                        "whitespace-nowrap shrink-0 rounded-lg px-3 py-1 text-xs font-medium transition-all",
                        showcase === tab.id
                          ? "bg-white text-[#1D1D1F] shadow-xs dark:bg-[#2C2C2E] dark:text-white"
                          : "text-[#6E6E73] hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:text-white"
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 h-[245px] w-full">
                {showcase === "km" && (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={KM_PREVIEW_DATA} margin={{ top: 10, right: 16, left: -8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis
                        dataKey="mes"
                        tick={{ fontSize: 11, fill: tickFill }}
                        tickLine={false}
                        axisLine={{ stroke: gridStroke }}
                        tickFormatter={(v) => `${v}m`}
                      />
                      <YAxis
                        domain={[30, 100]}
                        tick={{ fontSize: 11, fill: tickFill }}
                        tickLine={false}
                        axisLine={{ stroke: gridStroke }}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: theme === "dark" ? "#1C1C1E" : "#FFFFFF",
                          borderColor: theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
                          borderRadius: "12px",
                          fontSize: "12px",
                          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                        }}
                        formatter={(val: unknown, key: unknown) => [
                          `${Number(val).toFixed(1)}%`,
                          key === "terapia" ? "Tratamiento A" : "Grupo control",
                        ]}
                        labelFormatter={(m) => `Mes ${String(m)}`}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="terapia"
                        name="Tratamiento A"
                        stroke="#0071E3"
                        strokeWidth={2.5}
                        dot={{ r: 2.5, fill: "#0071E3" }}
                        isAnimationActive={false}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="control"
                        name="Grupo control"
                        stroke="#10B981"
                        strokeWidth={2.5}
                        strokeDasharray="5 3"
                        dot={{ r: 2.5, fill: "#10B981" }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}

                {showcase === "roc" && (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={ROC_PREVIEW_DATA} margin={{ top: 10, right: 16, left: -8, bottom: 4 }}>
                      <defs>
                        <linearGradient id="rocFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0071E3" stopOpacity={0.22} />
                          <stop offset="95%" stopColor="#0071E3" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis
                        type="number"
                        dataKey="fpr"
                        domain={[0, 1]}
                        tick={{ fontSize: 11, fill: tickFill }}
                        tickLine={false}
                        axisLine={{ stroke: gridStroke }}
                        tickFormatter={(v) => Number(v).toFixed(1)}
                      />
                      <YAxis
                        type="number"
                        domain={[0, 1]}
                        tick={{ fontSize: 11, fill: tickFill }}
                        tickLine={false}
                        axisLine={{ stroke: gridStroke }}
                        tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: theme === "dark" ? "#1C1C1E" : "#FFFFFF",
                          borderColor: theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
                          borderRadius: "12px",
                          fontSize: "12px",
                          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                        }}
                        formatter={(val: unknown) => [`${(Number(val) * 100).toFixed(1)}%`, "Sensibilidad"]}
                        labelFormatter={(fpr) => `1 − Especificidad: ${Number(fpr).toFixed(2)}`}
                      />
                      <ReferenceLine
                        segment={[
                          { x: 0, y: 0 },
                          { x: 1, y: 1 },
                        ]}
                        stroke="#98989D"
                        strokeDasharray="4 4"
                      />
                      <Area
                        type="monotone"
                        dataKey="tpr"
                        stroke="#0071E3"
                        strokeWidth={2.5}
                        fill="url(#rocFill)"
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}

                {showcase === "hr" && (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={HR_PREVIEW_DATA} margin={{ top: 10, right: 16, left: -8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                      <XAxis
                        dataKey="factor"
                        tick={{ fontSize: 11, fill: tickFill }}
                        tickLine={false}
                        axisLine={{ stroke: gridStroke }}
                      />
                      <YAxis
                        domain={[0, 2.5]}
                        tick={{ fontSize: 11, fill: tickFill }}
                        tickLine={false}
                        axisLine={{ stroke: gridStroke }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: theme === "dark" ? "#1C1C1E" : "#FFFFFF",
                          borderColor: theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
                          borderRadius: "12px",
                          fontSize: "12px",
                          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                        }}
                        formatter={(val: unknown, _n: unknown, item: { payload?: { ic?: string } }) => [
                          `${Number(val).toFixed(2)} (IC 95%: ${item?.payload?.ic ?? ""})`,
                          "Hazard Ratio",
                        ]}
                      />
                      <ReferenceLine y={1} stroke="#EF4444" strokeDasharray="4 4" strokeWidth={1.5} />
                      <Bar dataKey="hr" fill="#0071E3" radius={[7, 7, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.05] pt-3 text-xs text-[#6E6E73] dark:border-white/[0.06] dark:text-[#98989D]">
                {showcase === "km" ? (
                  <>
                    <div className="flex items-center gap-4">
                      <span className="font-medium text-[#0071E3] dark:text-[#0A84FF]">― Tratamiento A (72,5% a 24m)</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">--- Grupo control (42,3% a 24m)</span>
                    </div>
                    <span className="font-mono tabular-nums">Diferencia absoluta: +30,2%</span>
                  </>
                ) : showcase === "roc" ? (
                  <>
                    <span>Punto óptimo de Youden: sensibilidad 85,0% · especificidad 78,0%</span>
                    <span className="font-mono tabular-nums">p &lt; 0,001</span>
                  </>
                ) : (
                  <>
                    <span>Línea discontinua roja = efecto nulo (HR = 1,00)</span>
                    <span className="font-mono tabular-nums">Modelo ajustado por covariables</span>
                  </>
                )}
              </div>
            </div>

            {/* Quiet Editorial Capabilities */}
            <div className="grid grid-cols-1 gap-6 border-t border-black/[0.07] pt-6 sm:grid-cols-3 dark:border-white/[0.08]">
              <div>
                <h3 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
                  Equipos por estudio
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                  Quien crea el proyecto administra el estudio y asigna por correo roles de Investigador o Capturador.
                </p>
              </div>
              <div>
                <h3 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
                  21 pruebas bioestadísticas
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                  Tabla 1, t de Student, Mann-Whitney, ANOVA, Friedman, Cox, Kaplan-Meier, ROC, Poisson y tamaño muestral.
                </p>
              </div>
              <div>
                <h3 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
                  Directo a tu manuscrito
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                  Guarda cada análisis en el estudio y copia tablas editables o gráficos en PNG directamente a Word.
                </p>
              </div>
            </div>
          </section>

          {/* Right Column: Apple-Style Authentication Panel */}
          <aside className="lg:col-span-5">
            <div className="rounded-[26px] border border-black/[0.07] bg-white p-7 sm:p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_20px_50px_-18px_rgba(0,0,0,0.1)] dark:border-white/[0.09] dark:bg-[#141416] dark:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)]">
              <div className="mb-6 flex flex-col items-center text-center">
                <img src="/avicena-logo.png" alt="Avicena" className="h-12 w-12 drop-shadow-sm" />
                <h2 className="mt-3.5 font-heading text-2xl font-semibold tracking-tight text-[#1D1D1F] dark:text-white">
                  {pendingMfaResolver
                    ? "Verificación en dos pasos"
                    : mode === "login"
                      ? "Inicia sesión en Avicena"
                      : "Crea tu cuenta"}
                </h2>
                <p className="mt-1 text-xs text-[#6E6E73] dark:text-[#98989D]">
                  {pendingMfaResolver
                    ? "Introduce el código de 6 dígitos generado por tu aplicación autenticadora."
                    : "Accede con tu cuenta de Google o con tu correo electrónico."}
                </p>
              </div>

              {pendingMfaResolver ? (
                <form onSubmit={handleMfaVerify} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                      Código TOTP (6 dígitos)
                    </label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8E8E93]" />
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                        maxLength={8}
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value)}
                        placeholder="000000"
                        data-testid="mfa-code-input"
                        className="w-full rounded-xl border border-transparent bg-[#F5F5F7] py-2.5 pl-10 pr-3.5 font-mono text-sm tracking-widest text-[#1D1D1F] placeholder:text-[#8E8E93] transition-all focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:bg-[#1C1C1E] dark:text-white dark:focus:border-[#0A84FF] dark:focus:bg-[#141416] dark:focus:ring-[#0A84FF]/15"
                      />
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                      {errorMsg}
                    </div>
                  )}

                  <div className="space-y-2">
                    <button
                      type="submit"
                      disabled={busy || !mfaCode.trim()}
                      data-testid="mfa-submit-btn"
                      className="w-full rounded-full bg-[#0071E3] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
                    >
                      {busy ? "Verificando…" : "Verificar código y entrar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        cancelMfaChallenge();
                        setMfaCode("");
                        setErrorMsg(null);
                      }}
                      className="w-full rounded-full border border-black/[0.08] bg-white px-4 py-2 text-xs font-medium text-[#6E6E73] transition-colors hover:bg-[#F5F5F7] hover:text-[#1D1D1F] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#98989D] dark:hover:text-white"
                    >
                      Cancelar y volver
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleGoogle}
                      data-testid="google-login-btn"
                      className="flex w-full items-center justify-center gap-2.5 rounded-full border border-black/[0.1] bg-white px-4 py-2.5 text-sm font-medium text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:bg-[#F5F5F7] disabled:opacity-60 dark:border-white/[0.14] dark:bg-[#1C1C1E] dark:text-white dark:hover:bg-[#2C2C2E]"
                    >
                      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="#4285F4"
                          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.37 24 12 24Z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                        />
                      </svg>
                      Continuar con Google
                    </button>

                    {ssoProviderId && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleInstitutionalSso}
                        data-testid="sso-login-btn"
                        className="flex w-full items-center justify-center gap-2 rounded-full border border-black/[0.1] bg-white px-4 py-2.5 text-sm font-medium text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:bg-[#F5F5F7] disabled:opacity-60 dark:border-white/[0.14] dark:bg-[#1C1C1E] dark:text-white dark:hover:bg-[#2C2C2E]"
                      >
                        <Building2 className="h-4 w-4 text-[#0071E3] dark:text-[#0A84FF]" />
                        {ssoProviderLabel}
                      </button>
                    )}
                  </div>

                  <div className="my-5 flex items-center gap-3 text-[11px] font-medium text-[#8E8E93]">
                    <div className="h-px flex-1 bg-black/[0.07] dark:bg-white/[0.08]" />
                    <span>o bien</span>
                    <div className="h-px flex-1 bg-black/[0.07] dark:bg-white/[0.08]" />
                  </div>

                  {/* Login / Register Toggle */}
                  <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.07]">
                    <button
                      type="button"
                      onClick={() => {
                        setMode("login");
                        setErrorMsg(null);
                      }}
                      data-testid="auth-tab-login"
                      className={cn(
                        "rounded-lg py-1.5 text-xs font-semibold transition-all",
                        mode === "login"
                          ? "bg-white text-[#1D1D1F] shadow-xs dark:bg-[#2C2C2E] dark:text-white"
                          : "text-[#6E6E73] hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:text-white"
                      )}
                    >
                      Iniciar sesión
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("register");
                        setErrorMsg(null);
                      }}
                      data-testid="auth-tab-register"
                      className={cn(
                        "rounded-lg py-1.5 text-xs font-semibold transition-all",
                        mode === "register"
                          ? "bg-white text-[#1D1D1F] shadow-xs dark:bg-[#2C2C2E] dark:text-white"
                          : "text-[#6E6E73] hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:text-white"
                      )}
                    >
                      Crear cuenta
                    </button>
                  </div>

                  <form onSubmit={handleEmailSubmit} className="space-y-3.5">
                    {mode === "register" && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                          Nombre completo
                        </label>
                        <div className="relative">
                          <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8E8E93]" />
                          <input
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Dra. / Dr. Nombre y Apellido"
                            data-testid="auth-name-input"
                            className="w-full rounded-xl border border-transparent bg-[#F5F5F7] py-2.5 pl-10 pr-3.5 text-sm text-[#1D1D1F] placeholder:text-[#8E8E93] transition-all focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:bg-[#1C1C1E] dark:text-white dark:focus:border-[#0A84FF] dark:focus:bg-[#141416] dark:focus:ring-[#0A84FF]/15"
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                        Correo electrónico
                      </label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8E8E93]" />
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="investigador@hospital.org"
                          data-testid="auth-email-input"
                          className="w-full rounded-xl border border-transparent bg-[#F5F5F7] py-2.5 pl-10 pr-3.5 text-sm text-[#1D1D1F] placeholder:text-[#8E8E93] transition-all focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:bg-[#1C1C1E] dark:text-white dark:focus:border-[#0A84FF] dark:focus:bg-[#141416] dark:focus:ring-[#0A84FF]/15"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                          Contraseña
                        </label>
                        {mode === "login" && (
                          <button
                            type="button"
                            onClick={handleForgotPassword}
                            className="text-[11px] font-medium text-[#0071E3] hover:underline dark:text-[#0A84FF]"
                          >
                            ¿Olvidaste tu contraseña?
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8E8E93]" />
                        <input
                          type="password"
                          required
                          minLength={mode === "register" ? 12 : 6}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={mode === "register" ? "Mín. 12 caracteres (Aa1!)" : "Tu contraseña"}
                          data-testid="auth-password-input"
                          className="w-full rounded-xl border border-transparent bg-[#F5F5F7] py-2.5 pl-10 pr-3.5 text-sm text-[#1D1D1F] placeholder:text-[#8E8E93] transition-all focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:bg-[#1C1C1E] dark:text-white dark:focus:border-[#0A84FF] dark:focus:bg-[#141416] dark:focus:ring-[#0A84FF]/15"
                        />
                      </div>
                      {mode === "register" && (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                          Requisito clínico: mínimo 12 caracteres con mayúscula, minúscula, número y símbolo.
                        </p>
                      )}
                    </div>

                    {errorMsg && (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                        {errorMsg}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={busy}
                      data-testid="auth-submit-btn"
                      className="w-full rounded-full bg-[#0071E3] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
                    >
                      {busy
                        ? "Conectando…"
                        : mode === "login"
                          ? "Entrar a Estudios"
                          : "Crear cuenta y entrar"}
                    </button>
                  </form>
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2 text-xs text-[#6E6E73] dark:text-[#98989D]">
              <a
                href="#seguridad-publica"
                className="inline-flex items-center gap-1.5 font-medium text-[#424245] transition-colors hover:text-[#1D1D1F] dark:text-[#D1D1D6] dark:hover:text-white"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-[#0071E3] dark:text-[#0A84FF]" />
                Cómo protegemos los datos
              </a>
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                data-testid="aside-technical-report-btn"
                className="inline-flex items-center gap-1 font-medium text-[#0071E3] transition-colors hover:underline dark:text-[#0A84FF]"
              >
                Informe técnico para expertos
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </aside>
        </div>

        {/* Public-Facing Security & Privacy Explanation */}
        <section
          id="seguridad-publica"
          aria-labelledby="seguridad-publica-titulo"
          className="mt-20 border-t border-black/[0.08] pt-14 sm:mt-24 sm:pt-16 dark:border-white/[0.09]"
        >
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs font-semibold tracking-wide text-[#0071E3] dark:text-[#0A84FF]">
                Privacidad y confianza clínica
              </p>
              <h2
                id="seguridad-publica-titulo"
                className="font-heading text-3xl font-semibold tracking-tight text-[#1D1D1F] sm:text-4xl dark:text-white text-balance"
              >
                Cómo protege Avicena la privacidad de cada paciente y la integridad de cada estudio.
              </h2>
              <p className="text-base leading-relaxed text-[#6E6E73] dark:text-[#A1A1A6]">
                Una explicación clara, sin tecnicismos innecesarios, para pacientes, equipos médicos y responsables de investigación.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setReportOpen(true)}
              data-testid="open-technical-report-btn"
              className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-full bg-[#1D1D1F] px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#333336] dark:bg-white dark:text-[#1D1D1F] dark:hover:bg-[#E5E5EA] lg:self-end"
            >
              <FileText className="h-3.5 w-3.5" />
              Leer informe técnico para expertos
            </button>
          </div>

          {/* Asymmetric Bento Editorial Layout */}
          <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-12">
            <article className="lg:col-span-7 rounded-[22px] border border-black/[0.07] bg-white p-7 dark:border-white/[0.09] dark:bg-[#141416]">
              <p className="font-mono text-xs font-medium tabular-nums text-[#6E6E73] dark:text-[#98989D]">
                01 · Separación de identidad
              </p>
              <h3 className="mt-2 font-heading text-xl font-semibold tracking-tight text-[#1D1D1F] dark:text-white">
                Tus datos personales nunca viajan junto a tus datos médicos
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#424245] dark:text-[#D1D1D6]">
                Cuando un paciente participa en un estudio, su nombre, DNI, teléfono o número de historia clínica se guardan en una bóveda digital cifrada aparte (AES-256-GCM). Quienes analizan la investigación trabajan únicamente con códigos anónimos de estudio, evitando duplicados mediante huellas matemáticas ciegas sin exponer quién es cada persona.
              </p>
            </article>

            <article className="lg:col-span-5 rounded-[22px] border border-black/[0.07] bg-white p-7 dark:border-white/[0.09] dark:bg-[#141416]">
              <p className="font-mono text-xs font-medium tabular-nums text-[#6E6E73] dark:text-[#98989D]">
                02 · Mínimo privilegio
              </p>
              <h3 className="mt-2 font-heading text-xl font-semibold tracking-tight text-[#1D1D1F] dark:text-white">
                Cada perfil solo ve lo que necesita
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#424245] dark:text-[#D1D1D6]">
                El acceso se divide en siete funciones concretas: investigador principal, coordinador, monitor clínico, estadístico, capturador, administrador y soporte técnico. Quien atiende incidencias técnicas tiene bloqueada la lectura de historiales, respuestas clínicas e identidad de participantes.
              </p>
            </article>

            <article className="lg:col-span-4 rounded-[22px] border border-black/[0.07] bg-white p-7 dark:border-white/[0.09] dark:bg-[#141416]">
              <p className="font-mono text-xs font-medium tabular-nums text-[#6E6E73] dark:text-[#98989D]">
                03 · Acceso protegido
              </p>
              <h3 className="mt-2 font-heading text-lg font-semibold tracking-tight text-[#1D1D1F] dark:text-white">
                Correo verificado, doble factor y cierre automático
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-[#424245] dark:text-[#D1D1D6]">
                Nadie entra sin confirmar su correo. Los estudios pueden exigir un código temporal en el móvil (TOTP) y la sesión se cierra automáticamente tras 15 minutos sin actividad.
              </p>
            </article>

            <article className="lg:col-span-4 rounded-[22px] border border-black/[0.07] bg-white p-7 dark:border-white/[0.09] dark:bg-[#141416]">
              <p className="font-mono text-xs font-medium tabular-nums text-[#6E6E73] dark:text-[#98989D]">
                04 · Trazabilidad clínica
              </p>
              <h3 className="mt-2 font-heading text-lg font-semibold tracking-tight text-[#1D1D1F] dark:text-white">
                Nada se borra ni se cambia en secreto
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-[#424245] dark:text-[#D1D1D6]">
                Cualquier corrección pide explicar el motivo, conserva las versiones previas, permite revisiones de calidad (queries) y queda sellada en un registro de auditoría verificable.
              </p>
            </article>

            <article className="lg:col-span-4 rounded-[22px] border border-black/[0.07] bg-white p-7 dark:border-white/[0.09] dark:bg-[#141416]">
              <p className="font-mono text-xs font-medium tabular-nums text-[#6E6E73] dark:text-[#98989D]">
                05 · Estadística e IA segura
              </p>
              <h3 className="mt-2 font-heading text-lg font-semibold tracking-tight text-[#1D1D1F] dark:text-white">
                Cálculo propio sin enviar pacientes a la IA
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-[#424245] dark:text-[#D1D1D6]">
                Las 21 pruebas estadísticas se calculan en el servidor de Avicena. La IA está apagada por defecto y bloquea de forma automática nombres, DNI, teléfonos o fechas si alguien intenta escribirlos.
              </p>
            </article>
          </div>

          {/* Honest Scope & Infrastructure Transparency Strip */}
          <div className="mt-6 flex flex-col justify-between gap-5 rounded-[22px] border border-black/[0.07] bg-white/80 p-6 sm:flex-row sm:items-center dark:border-white/[0.09] dark:bg-[#141416]/80">
            <div className="max-w-3xl space-y-1">
              <h3 className="font-heading text-sm font-semibold text-[#1D1D1F] dark:text-white">
                Transparencia sobre el uso con pacientes reales
              </h3>
              <p className="text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                Todos los controles de cifrado, permisos, auditoría y protección frente a datos personales descritos arriba están implementados en el código de Avicena. Antes de registrar datos reales de pacientes, el centro investigador debe desplegar su infraestructura Cloud dedicada (copias automáticas PITR, custodia externa inmutable y gestión de secretos) y contar con su evaluación RGPD (EIPD/DPIA) y dictamen del Comité de Ética (CEIm).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 self-start text-xs font-semibold text-[#0071E3] hover:underline sm:self-center dark:text-[#0A84FF]"
            >
              Ver detalles técnicos completos
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>
      </main>

      <footer
        className={cn(
          "border-t border-black/[0.06] bg-white/60 py-6 text-xs text-[#6E6E73] dark:border-white/[0.08] dark:bg-[#0D0D0F]/60 dark:text-[#98989D]",
          reportOpen && "no-print"
        )}
      >
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 px-4 sm:flex-row sm:items-center sm:px-6">
          <div className="flex items-center gap-2">
            <span className="font-heading font-semibold text-[#1D1D1F] dark:text-white">Avicena</span>
            <span>· Cuadernos de recogida de datos clínicos (EDC/eCRF) y bioestadística</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="#seguridad-publica" className="hover:text-[#1D1D1F] dark:hover:text-white">
              Seguridad pública
            </a>
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="font-medium text-[#0071E3] hover:underline dark:text-[#0A84FF]"
            >
              Informe técnico para expertos
            </button>
          </div>
        </div>
      </footer>

      <TechnicalSecurityReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}
