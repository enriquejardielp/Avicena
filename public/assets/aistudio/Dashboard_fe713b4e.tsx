import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ArrowUpRight, Database, FileText, Plus, Users2, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/components/auth/AuthBridge";
import { apiGet, apiPost, errMsg } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

function NewProjectDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const m = useMutation({
    mutationFn: () => apiPost<Project>("/projects", { name, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Proyecto creado");
      setOpen(false);
      setName("");
      setDescription("");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="h-10 rounded-full px-5" data-testid="new-project-button" />}>
        <Plus className="size-4" /> Nuevo proyecto
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Nuevo proyecto de investigación</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="pname">Nombre del estudio</Label>
            <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Cohorte de insuficiencia cardiaca 2026" required data-testid="new-project-name-input" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pdesc">Descripción</Label>
            <Textarea id="pdesc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Objetivo, población, diseño…" data-testid="new-project-description-input" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || m.isPending} data-testid="new-project-submit-button">
              {m.isPending ? "Creando…" : "Crear proyecto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Database; value: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <Icon className="size-3.5 text-slate-400" />
      <span className="font-mono font-semibold text-slate-700">{value}</span> {label}
    </div>
  );
}

export default function Dashboard() {
  const { data: me } = useMe();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => apiGet<Project[]>("/projects") });
  const list = projects.data ?? [];
  const firstName = (me?.name || me?.email || "").split(/[ @]/)[0];
  const canCreate = me?.role === "admin" || me?.role === "investigador";

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-8 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Tus estudios</p>
          <h1 className="mt-2 text-4xl font-semibold text-slate-900" data-testid="dashboard-title">
            Hola{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="mt-2 text-slate-600">
            {me?.role === "capturador" ? "Elige un proyecto para capturar datos de pacientes." : "Elige un proyecto para explorar datos, analizar y preguntar a la IA."}
          </p>
        </div>
        {canCreate && <NewProjectDialog />}
      </div>

      {projects.isError && (
        <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800" data-testid="projects-error">
          No se pudieron cargar los proyectos. {errMsg(projects.error)}
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-12" data-testid="projects-grid">
        {projects.isLoading &&
          [0, 1, 2].map((i) => <div key={i} className="h-48 animate-pulse rounded-3xl bg-slate-200/60 md:col-span-6 lg:col-span-4" />)}
        {list.map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.35 }}
            className={cn(i === 0 ? "md:col-span-12 lg:col-span-7" : i === 1 ? "md:col-span-6 lg:col-span-5" : "md:col-span-6 lg:col-span-4")}
          >
            <Link
              to={`/proyectos/${p.id}`}
              data-testid={`project-card-${p.id}`}
              className={cn(
                "group relative flex h-full min-h-48 flex-col justify-between overflow-hidden rounded-3xl border p-6 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg",
                i === 0 ? "border-slate-800 bg-slate-900 text-white" : "border-slate-200 bg-white",
              )}
            >
              {i === 0 && <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-sky-500/30 blur-3xl" />}
              <div className="relative">
                <div className="flex items-center gap-2">
                  {p.demo && (
                    <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", i === 0 ? "bg-white/10 text-sky-200" : "bg-sky-50 text-sky-700")}>
                      Demo · solo lectura
                    </span>
                  )}
                  <ArrowUpRight className={cn("ml-auto size-5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5", i === 0 ? "text-white/60" : "text-slate-400")} />
                </div>
                <h3 className={cn("mt-4 text-2xl font-semibold", i === 0 ? "text-white" : "text-slate-900")} data-testid="project-card-name">{p.name}</h3>
                <p className={cn("mt-2 line-clamp-2 text-sm", i === 0 ? "text-slate-300" : "text-slate-600")}>{p.description || "Sin descripción"}</p>
              </div>
              <div className={cn("relative mt-6 flex flex-wrap gap-4", i === 0 && "[&_*]:!text-slate-300")}>
                <Stat icon={Database} value={p.dataset_count} label="bases" />
                <Stat icon={FileText} value={p.form_count} label="formularios" />
                <Stat icon={FlaskConical} value={p.record_count} label="registros" />
                <Stat icon={Users2} value={p.member_ids.length + 1} label="miembros" />
              </div>
            </Link>
          </motion.div>
        ))}
        {!projects.isLoading && !projects.isError && list.length === 0 && (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/60 p-10 text-center md:col-span-12" data-testid="projects-empty">
            <p className="font-heading text-lg font-semibold">Aún no tienes proyectos</p>
            <p className="mt-1 text-sm text-slate-500">{canCreate ? "Crea tu primer estudio para empezar." : "Pide a un investigador que te añada a su proyecto."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
