import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Database, FileText, Sigma, Sparkles, Users2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/components/auth/AuthBridge";
import DataTab from "@/components/project/DataTab";
import AnalysisTab from "@/components/project/AnalysisTab";
import CopilotTab from "@/components/project/CopilotTab";
import FormsTab from "@/components/project/FormsTab";
import MembersTab from "@/components/project/MembersTab";
import { apiGet, errMsg } from "@/lib/api";
import type { Dataset, Project } from "@/lib/types";

export default function ProjectPage() {
  const { projectId = "" } = useParams();
  const { data: me } = useMe();
  const analyst = me?.role === "admin" || me?.role === "investigador";
  const project = useQuery({ queryKey: ["project", projectId], queryFn: () => apiGet<Project>(`/projects/${projectId}`) });
  const datasets = useQuery({
    queryKey: ["datasets", projectId],
    queryFn: () => apiGet<Dataset[]>(`/projects/${projectId}/datasets`),
    enabled: analyst,
  });
  const [datasetId, setDatasetId] = useState<string>("");
  const [tab, setTab] = useState<string>("");

  useEffect(() => {
    const list = datasets.data ?? [];
    if (list.length && !list.some((d) => d.id === datasetId)) {
      setDatasetId((list.find((d) => d.n_rows > 0) ?? list[0]).id);
    }
  }, [datasets.data, datasetId]);

  const p = project.data;
  const current = analyst ? (tab || "datos") : "formularios";
  const shared = { project: p, datasets: datasets.data ?? [], datasetId, setDatasetId };

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6 md:px-8 md:py-8">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-900" data-testid="back-to-projects-link">
        <ChevronLeft className="size-4" /> Proyectos
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {p?.demo && <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">Demo · solo lectura</span>}
          </div>
          <h1 className="mt-1 truncate text-3xl font-semibold text-slate-900 md:text-4xl" data-testid="project-title">
            {p?.name ?? (project.isError ? "Proyecto no disponible" : "Cargando…")}
          </h1>
          <p className="mt-1 max-w-3xl text-slate-600">{p?.description || (project.isError ? errMsg(project.error) : "")}</p>
        </div>
      </div>

      <Tabs value={current} onValueChange={(v) => setTab(String(v))} className="mt-6">
        <TabsList className="h-11 rounded-full bg-slate-200/60 p-1">
          {analyst && (
            <>
              <TabsTrigger value="datos" className="rounded-full px-4" data-testid="tab-data"><Database className="size-4" /> Datos</TabsTrigger>
              <TabsTrigger value="analisis" className="rounded-full px-4" data-testid="tab-analysis"><Sigma className="size-4" /> Análisis</TabsTrigger>
              <TabsTrigger value="ia" className="rounded-full px-4" data-testid="tab-ai"><Sparkles className="size-4" /> Asistente IA</TabsTrigger>
            </>
          )}
          <TabsTrigger value="formularios" className="rounded-full px-4" data-testid="tab-forms"><FileText className="size-4" /> Formularios</TabsTrigger>
          <TabsTrigger value="miembros" className="rounded-full px-4" data-testid="tab-members"><Users2 className="size-4" /> Equipo</TabsTrigger>
        </TabsList>
        {analyst && (
          <>
            <TabsContent value="datos" className="mt-6"><DataTab {...shared} /></TabsContent>
            <TabsContent value="analisis" className="mt-6"><AnalysisTab {...shared} /></TabsContent>
            <TabsContent value="ia" className="mt-6"><CopilotTab {...shared} /></TabsContent>
          </>
        )}
        <TabsContent value="formularios" className="mt-6"><FormsTab project={p} /></TabsContent>
        <TabsContent value="miembros" className="mt-6"><MembersTab project={p} /></TabsContent>
      </Tabs>
    </div>
  );
}
