import { useState } from "react";
import { Lock, Mail, Moon, Sun, User } from "lucide-react";
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
import { useAuth } from "../lib/AuthContext.tsx";
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
  { factor: "Edad (>65 años)", hr: 1.62, ic: "1,14 – 2,31" },
  { factor: "Tabaquismo activo", hr: 2.18, ic: "1,38 – 3,45" },
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
    return "La contraseña debe tener al menos 6 caracteres.";
  }
  if (code === "auth/invalid-email") {
    return "Introduce una dirección de correo electrónico válida.";
  }
  if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
    return "El acceso con correo/contraseña aún no está habilitado en Firebase Console (Authentication → Sign-in method → Correo electrónico/contraseña).";
  }
  if (code === "auth/too-many-requests") {
    return "Demasiados intentos seguidos. Espera unos segundos e inténtalo de nuevo.";
  }
  return msg || "No se pudo completar la autenticación.";
}

export default function Landing() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [showcase, setShowcase] = useState<ShowcaseTab>("km");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGoogle = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      toast.success("Sesión iniciada con Google.");
    } catch (err) {
      const m = translateAuthError(err);
      setErrorMsg(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.trim() || !password) return;
    if (mode === "register" && !name.trim()) {
      setErrorMsg("Introduce tu nombre completo para crear la cuenta.");
      return;
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

  const gridStroke = theme === "dark" ? "rgba(148, 163, 184, 0.16)" : "rgba(148, 163, 184, 0.25)";
  const tickFill = theme === "dark" ? "#94A3B8" : "#64748B";

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A] dark:bg-[#0B1120] dark:text-[#F8FAFC]">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 h-16 border-b border-slate-200 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-8 px-4 sm:px-6">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <img src="/avicena-logo.svg" alt="Avicena" className="h-9 w-9 rounded-xl shadow-sm" />
            <span className="font-heading text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              Avicena
            </span>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Activar tema claro" : "Activar tema oscuro"}
            data-testid="theme-toggle"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:py-12">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-start">
          {/* Left Column: Clinical Positioning & Interactive Statistical Chart Showcase */}
          <section className="lg:col-span-7 space-y-8">
            <div className="space-y-4">
              <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
                Avicena · Bioestadística clínica y recogida de datos
              </p>
              <h1 className="max-w-2xl font-heading text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-[2.65rem] lg:leading-[1.12] dark:text-white text-balance">
                Tus datos clínicos, tus pruebas estadísticas y tus gráficos en un solo sitio
              </h1>
              <p className="max-w-2xl text-base leading-relaxed text-slate-600 dark:text-slate-300">
                Sube hojas de cálculo en CSV o Excel, crea formularios clínicos para tu equipo y obtén tablas de resultados y figuras listas para copiar directamente a un documento de Word.
              </p>
            </div>

            {/* Interactive Visualization Panel */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
                <div>
                  <h2 className="font-heading text-sm font-semibold text-slate-900 dark:text-white">
                    {showcase === "km"
                      ? "Supervivencia acumulada por brazo (Kaplan-Meier)"
                      : showcase === "roc"
                        ? "Curva ROC y discriminación diagnóstica"
                        : "Modelo multivariable de Cox (Hazard Ratios)"}
                  </h2>
                  <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {showcase === "km"
                      ? "Log-Rank χ² = 6,84 · p = 0,009 · Mediana control: 20,1 meses"
                      : showcase === "roc"
                        ? "AUC = 0,884 (IC 95%: 0,821 – 0,947) · Índice de Youden: 0,63"
                        : "C-index de Harrell = 0,79 · N = 180 · 46 eventos"}
                  </p>
                </div>

                {/* Functional Segmented Filter Tabs */}
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
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
                        "whitespace-nowrap shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        showcase === tab.id
                          ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                          : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 h-[250px] w-full">
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
                          backgroundColor: theme === "dark" ? "#0F172A" : "#FFFFFF",
                          borderColor: theme === "dark" ? "#1E293B" : "#E2E8F0",
                          borderRadius: "10px",
                          fontSize: "12px",
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
                        stroke="#0284C7"
                        strokeWidth={2.5}
                        dot={{ r: 2.5, fill: "#0284C7" }}
                        isAnimationActive={false}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="control"
                        name="Grupo control"
                        stroke="#059669"
                        strokeWidth={2.5}
                        strokeDasharray="5 3"
                        dot={{ r: 2.5, fill: "#059669" }}
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
                          <stop offset="5%" stopColor="#0284C7" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#0284C7" stopOpacity={0.02} />
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
                          backgroundColor: theme === "dark" ? "#0F172A" : "#FFFFFF",
                          borderColor: theme === "dark" ? "#1E293B" : "#E2E8F0",
                          borderRadius: "10px",
                          fontSize: "12px",
                        }}
                        formatter={(val: unknown) => [`${(Number(val) * 100).toFixed(1)}%`, "Sensibilidad"]}
                        labelFormatter={(fpr) => `1 − Especificidad: ${Number(fpr).toFixed(2)}`}
                      />
                      <ReferenceLine
                        segment={[
                          { x: 0, y: 0 },
                          { x: 1, y: 1 },
                        ]}
                        stroke="#94A3B8"
                        strokeDasharray="4 4"
                      />
                      <Area
                        type="monotone"
                        dataKey="tpr"
                        stroke="#0284C7"
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
                          backgroundColor: theme === "dark" ? "#0F172A" : "#FFFFFF",
                          borderColor: theme === "dark" ? "#1E293B" : "#E2E8F0",
                          borderRadius: "10px",
                          fontSize: "12px",
                        }}
                        formatter={(val: unknown, _n: unknown, item: { payload?: { ic?: string } }) => [
                          `${Number(val).toFixed(2)} (IC 95%: ${item?.payload?.ic ?? ""})`,
                          "Hazard Ratio",
                        ]}
                      />
                      <ReferenceLine y={1} stroke="#DC2626" strokeDasharray="4 4" strokeWidth={1.5} />
                      <Bar dataKey="hr" fill="#0284C7" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                {showcase === "km" ? (
                  <>
                    <div className="flex items-center gap-4">
                      <span className="font-medium text-sky-700 dark:text-sky-400">― Tratamiento A (72,5% a 24m)</span>
                      <span className="font-medium text-emerald-700 dark:text-emerald-400">--- Grupo control (42,3% a 24m)</span>
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

            {/* Clean Editorial Feature Strip (no boxed cards within cards) */}
            <div className="grid grid-cols-1 gap-6 border-t border-slate-200 pt-6 sm:grid-cols-3 dark:border-slate-800">
              <div>
                <h3 className="font-heading text-sm font-semibold text-slate-900 dark:text-white">
                  01. Trabajo en equipo por estudio
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  Quien crea un estudio es su Administrador y comparte el acceso por correo asignando roles de Investigador o Capturador.
                </p>
              </div>
              <div>
                <h3 className="font-heading text-sm font-semibold text-slate-900 dark:text-white">
                  02. 21 pruebas clínicas y asistente
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  Tabla 1, t de Student, Mann-Whitney, ANOVA, Friedman, Cox, Kaplan-Meier, ROC, Poisson, NNT y cálculo muestral.
                </p>
              </div>
              <div>
                <h3 className="font-heading text-sm font-semibold text-slate-900 dark:text-white">
                  03. Listo para llevar a Word
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  Copia tablas editables, resultados completos y gráficos en imagen directamente al portapapeles para pegarlos en tu manuscrito.
                </p>
              </div>
            </div>
          </section>

          {/* Right Column: Login & Register Card */}
          <aside className="lg:col-span-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-7 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-5">
                <h2 className="font-heading text-xl font-bold text-slate-900 dark:text-white">
                  {mode === "login" ? "Entrar a tus estudios" : "Crear cuenta profesional"}
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Inicia sesión con tu cuenta de Google o con tu correo electrónico.
                </p>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={handleGoogle}
                data-testid="google-login-btn"
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
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

              <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400">
                <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                <span>o con correo</span>
                <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              </div>

              {/* Login / Register Toggle */}
              <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setErrorMsg(null);
                  }}
                  data-testid="auth-tab-login"
                  className={cn(
                    "rounded-lg py-1.5 text-xs font-semibold transition-colors",
                    mode === "login"
                      ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
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
                    "rounded-lg py-1.5 text-xs font-semibold transition-colors",
                    mode === "register"
                      ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  )}
                >
                  Crear cuenta
                </button>
              </div>

              <form onSubmit={handleEmailSubmit} className="space-y-3.5">
                {mode === "register" && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Nombre completo
                    </label>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Dra. / Dr. Nombre y Apellido"
                        data-testid="auth-name-input"
                        className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Correo electrónico
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="investigador@hospital.org"
                      data-testid="auth-email-input"
                      className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Contraseña
                    </label>
                    {mode === "login" && (
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        className="text-[11px] font-medium text-sky-600 hover:underline dark:text-sky-400"
                      >
                        ¿Olvidaste tu contraseña?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      data-testid="auth-password-input"
                      className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </div>

                {errorMsg && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                    {errorMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  data-testid="auth-submit-btn"
                  className="w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:opacity-60 dark:bg-sky-500 dark:hover:bg-sky-600"
                >
                  {busy
                    ? "Conectando…"
                    : mode === "login"
                      ? "Entrar a Estudios"
                      : "Crear cuenta y entrar"}
                </button>
              </form>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
