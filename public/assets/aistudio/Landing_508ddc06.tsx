import { Link } from "react-router-dom";
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, CartesianGrid } from "recharts";
import { ArrowRight, BarChart3, ClipboardList, ShieldCheck, Sparkles, Sigma } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/layout/AppShell";
import { cn } from "@/lib/utils";

const KM = Array.from({ length: 25 }, (_, i) => ({
  t: i * 2,
  a: Math.exp(-i * 0.045) * (1 - (i % 3) * 0.004),
  b: Math.exp(-i * 0.09) * (1 - (i % 4) * 0.005),
}));

const FEATURES = [
  { icon: Sigma, title: "Estadística tipo Stata / SPSS", text: "Descriptivos, t de Student, χ², ANOVA con Tukey, correlaciones, regresión lineal y logística, Kaplan-Meier y Tabla 1.", span: "md:col-span-7" },
  { icon: Sparkles, title: "Asistente IA", text: "Pregunta en lenguaje natural. La IA elige la prueba, la ejecuta en Python y te explica el resultado.", span: "md:col-span-5" },
  { icon: ClipboardList, title: "Formularios tipo REDCap", text: "Diseña CRFs con validaciones de rango y captura pacientes; los datos llegan al instante al análisis.", span: "md:col-span-5" },
  { icon: ShieldCheck, title: "Multiusuario y roles", text: "Administrador, Investigador y Capturador de datos, con proyectos compartidos por equipo.", span: "md:col-span-7" },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_600px_at_80%_-10%,#E0F2FE_0%,transparent_60%),radial-gradient(900px_500px_at_-10%_30%,#CCFBF1_0%,transparent_55%)]">
      <header className="sticky top-0 z-40 border-b border-white/60 bg-white/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Logo />
          <div className="flex items-center gap-2">
            <Link to="/sign-in" className={buttonVariants({ variant: "ghost" })} data-testid="landing-signin-button">Iniciar sesión</Link>
            <Link to="/sign-up" className={cn(buttonVariants(), "rounded-full px-5")} data-testid="landing-signup-button">Empezar gratis</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-12 lg:pt-24">
        <div className="lg:col-span-6 animate-fade-up">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Bioestadística para médicos</p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.05] text-slate-900 md:text-6xl" data-testid="landing-title">
            Tus datos clínicos,<br />
            <span className="bg-gradient-to-r from-sky-600 to-teal-500 bg-clip-text text-transparent">respuestas claras.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate-600">
            Recoge datos con formularios tipo REDCap, analízalos con la potencia de Stata y SPSS, y deja que la IA te explique cada valor p.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/sign-up" className={cn(buttonVariants({ size: "lg" }), "h-12 rounded-full px-7 text-base")} data-testid="landing-cta-button">
              Crear mi cuenta <ArrowRight className="ml-1 size-4" />
            </Link>
            <Link to="/sign-in" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-12 rounded-full bg-white/70 px-7 text-base")}>
              Ya tengo cuenta
            </Link>
          </div>
        </div>

        <div className="relative lg:col-span-6">
          <div className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-[0_30px_80px_-30px_rgba(2,132,199,0.35)] backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">ONCO-SURV · Supervivencia global</p>
                <p className="font-heading text-lg font-semibold">Curva de Kaplan-Meier</p>
              </div>
              <span className="rounded-full bg-sky-50 px-3 py-1 font-mono text-xs font-semibold text-sky-700">log-rank p &lt; 0.001</span>
            </div>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={KM} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: "#94A3B8" }} stroke="#CBD5E1" />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: "#94A3B8" }} stroke="#CBD5E1" />
                  <Line type="stepAfter" dataKey="a" stroke="#0284C7" strokeWidth={2.5} dot={false} />
                  <Line type="stepAfter" dataKey="b" stroke="#0D9488" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="absolute -bottom-16 -left-6 max-w-[260px] rounded-2xl border border-white/70 bg-white/90 p-4 shadow-xl backdrop-blur-xl animate-float">
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-700"><Sparkles className="size-3.5" /> Asistente IA</div>
            <p className="mt-1.5 text-sm leading-snug text-slate-700">La inmunoterapia se asocia a <b>mayor supervivencia</b> (mediana 26 vs 11 meses).</p>
          </div>
          <div className="absolute -right-4 -top-14 rounded-2xl border border-white/70 bg-white/90 px-4 py-3 shadow-lg backdrop-blur-xl">
            <BarChart3 className="mb-1 size-4 text-teal-600" />
            <p className="font-mono text-sm font-semibold">OR 2.71</p>
            <p className="text-[11px] text-slate-500">IC95% 1.42–5.18</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-5 md:grid-cols-12">
          {FEATURES.map((f) => (
            <div key={f.title} className={cn("rounded-3xl border border-slate-200/80 bg-white/80 p-7 backdrop-blur transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg", f.span)}>
              <span className="grid size-10 place-items-center rounded-xl bg-slate-900 text-white"><f.icon className="size-5" /></span>
              <h3 className="mt-5 text-xl font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
