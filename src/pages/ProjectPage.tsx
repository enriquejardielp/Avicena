import { useEffect, useState } from "react";
import { ArrowLeft, BarChart3, ClipboardList, Database, MessageSquareText, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../components/layout/AppShell.tsx";
import { AnalysisTab } from "../components/project/AnalysisTab.tsx";
import { CopilotTab } from "../components/project/CopilotTab.tsx";
import { DataTab } from "../components/project/DataTab.tsx";
import { FormsTab } from "../components/project/FormsTab.tsx";
import { MembersTab } from "../components/project/MembersTab.tsx";
import { apiDelete, apiGet, errMsg } from "../lib/api.ts";
import { Link, useNavigate } from "../lib/router.tsx";
import { ROLE_LABEL, type Dataset, type Form, type Me, type Project } from "../lib/types.ts";
import { cn } from "../lib/utils.ts";

type TabId = "datos" | "bioestadistica" | "ia" | "formularios" | "equipo";

export default function ProjectPage({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [forms, setForms] = useState<Form[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("datos");
  const [pendingCopilotPrompt, setPendingCopilotPrompt] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadStudy = async () => {
    setLoading(true);
    try {
      const [meRes, projRes, formsRes] = await Promise.all([
        apiGet<Me>("/me"),
        apiGet<Project>(`/projects/${projectId}`),
        apiGet<Form[]>(`/projects/${projectId}/forms`),
      ]);
      setMe(meRes);
      setProject(projRes);
      setForms(formsRes);

      if (projRes.my_role === "capturador") {
        setDatasets([]);
        setActiveTab((prev) => (prev === "equipo" ? "equipo" : "formularios"));
      } else {
        const dsRes = await apiGet<Dataset[]>(`/projects/${projectId}/datasets`);
        setDatasets(dsRes);
        setActiveDatasetId((prev) => (prev && dsRes.some((d) => d.id === prev) ? prev : dsRes[0]?.id ?? ""));
      }
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cargar el estudio."));
      navigate("/");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleDeleteProject = async () => {
    if (!project) return;
    try {
      await apiDelete(`/projects/${project.id}`);
      toast.success(`Estudio «${project.name}» eliminado.`);
      navigate("/");
    } catch (err) {
      toast.error(errMsg(err, "No se pudo eliminar el estudio."));
    }
  };

  const isCapturador = project?.my_role === "capturador";
  const isAdmin = project?.my_role === "admin";
  const tabs: { id: TabId; label: string; icon: typeof Database; hidden?: boolean }[] = [
    { id: "datos", label: "Datos", icon: Database, hidden: isCapturador },
    { id: "bioestadistica", label: "Bioestadística", icon: BarChart3, hidden: isCapturador },
    { id: "ia", label: "Asistente IA", icon: MessageSquareText, hidden: isCapturador },
    { id: "formularios", label: `Formularios CRF (${forms.length})`, icon: ClipboardList },
    { id: "equipo", label: "Equipo y compartir", icon: Users },
  ];

  return (
    <AppShell me={me}>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver a estudios
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                {project?.name ?? "Cargando estudio…"}
              </h1>
              {project && (
                <span className="text-xs font-medium text-sky-700 dark:text-sky-400">
                  · Rol: {ROLE_LABEL[project.my_role]}
                </span>
              )}
            </div>
            {project?.description && (
              <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">{project.description}</p>
            )}
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2">
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-400 dark:hover:bg-rose-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Eliminar estudio
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 dark:border-rose-900/60 dark:bg-rose-950/30">
                  <span className="text-xs font-medium text-rose-700 dark:text-rose-300">¿Confirmar eliminación?</span>
                  <button
                    type="button"
                    onClick={handleDeleteProject}
                    className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700"
                  >
                    Eliminar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Workspace Tab Bar */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2 dark:border-slate-800">
          {tabs
            .filter((t) => !t.hidden)
            .map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  data-testid={`tab-${t.id}`}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors",
                    active
                      ? "bg-sky-600 text-white shadow-xs dark:bg-sky-500"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
        </div>

        {loading && !project ? (
          <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        ) : (
          <div>
            {activeTab === "datos" && !isCapturador && (
              <DataTab
                projectId={projectId}
                datasets={datasets}
                activeDatasetId={activeDatasetId}
                onSelectDataset={setActiveDatasetId}
                onDatasetsChanged={loadStudy}
                canEdit={Boolean(project?.can_edit)}
              />
            )}

            {activeTab === "bioestadistica" && !isCapturador && (
              <AnalysisTab
                datasets={datasets}
                activeDatasetId={activeDatasetId}
                onSelectDataset={setActiveDatasetId}
                onAskCopilot={(prompt) => {
                  setPendingCopilotPrompt(prompt);
                  setActiveTab("ia");
                }}
              />
            )}

            {activeTab === "ia" && !isCapturador && (
              <CopilotTab
                datasets={datasets}
                activeDatasetId={activeDatasetId}
                onSelectDataset={setActiveDatasetId}
                pendingPrompt={pendingCopilotPrompt}
                onConsumePendingPrompt={() => setPendingCopilotPrompt(null)}
              />
            )}

            {activeTab === "formularios" && (
              <FormsTab
                projectId={projectId}
                forms={forms}
                canEdit={Boolean(project?.can_edit)}
                onChanged={loadStudy}
              />
            )}

            {activeTab === "equipo" && (
              <MembersTab
                projectId={projectId}
                canManageTeam={Boolean(project?.can_manage_team)}
                myRole={project?.my_role ?? "capturador"}
              />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
