import { Logo } from "@/components/layout/AppShell";

export default function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-slate-900 lg:flex">
        <img
          src="https://images.unsplash.com/photo-1579154204601-01588f351e67?crop=entropy&cs=srgb&fm=jpg&q=80&w=1400"
          alt="Laboratorio clínico"
          className="absolute inset-0 h-full w-full object-cover opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/40 to-transparent" />
        <div className="relative mt-auto p-12 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Bioestadística para clínicos</p>
          <h2 className="mt-3 max-w-md text-4xl font-semibold leading-tight">De la historia clínica al valor p, sin escribir código.</h2>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center gap-8 px-4 py-10">
        <Logo />
        {children}
      </div>
    </div>
  );
}
