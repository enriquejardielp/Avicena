import { useEffect, useState } from "react";
import {
  Archive,
  ArrowLeft,
  BarChart3,
  ClipboardList,
  Database,
  FileCheck2,
  KeyRound,
  MessageSquareText,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../components/layout/AppShell.tsx";
import { AnalysisTab } from "../components/project/AnalysisTab.tsx";
import { AuditTab } from "../components/project/AuditTab.tsx";
import { CopilotTab } from "../components/project/CopilotTab.tsx";
import { DataTab } from "../components/project/DataTab.tsx";
import { FormsTab } from "../components/project/FormsTab.tsx";
import { MembersTab } from "../components/project/MembersTab.tsx";
import { MonitoringTab } from "../components/project/MonitoringTab.tsx";
import { SavedAnalysesTab } from "../components/project/SavedAnalysesTab.tsx";
import { VaultConsentTab } from "../components/project/VaultConsentTab.tsx";
import { errMsg } from "../lib/api.ts";
import { useAuth } from "../lib/AuthContext.tsx";
import {
  deleteProject,
  getProject,
  getStudyLifecycle,
  listDatasets,
  listForms,
  listSavedAnalyses,
} from "../lib/firestoreDb.ts";
import { Link, useNavigate } from "../lib/router.tsx";
import {
  ROLE_LABEL,
  STUDY_STATUS_LABEL,
  type Dataset,
  type Form,
  type Me,
  type Project,
  type SavedAnalysis,
  type StudyLifecycle,
} from "../lib/types.ts";
import { cn } from "../lib/utils.ts";

type TabId =
  | "datos"
  | "bioestadistica"
  | "guardados"
  | "ia"
  | "formularios"
  | "monitorizacion"
  | "consentimientos"
  | "auditoria"
  | "equipo";

export default function ProjectPage({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [studyLifecycle, setStudyLifecycle] = useState<StudyLifecycle | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [forms, setForms] = useState<Form[]>([]);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("datos");
  const [pendingCopilotPrompt, setPendingCopilotPrompt] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(true);

  const me: Me | null = user
    ? {
        user_id: user.uid,
        email: user.email ?? "",
        name: user.displayName || user.email?.split("@")[0] || "Investigador",
        photo_url: user.photoURL,
      }
    : null;

  const loadStudy = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [projRes, lifecycleRes] = await Promise.all([
        getProject(projectId, user),
        getStudyLifecycle(projectId),
      ]);
      setProject(projRes);
      setStudyLifecycle(lifecycleRes);

      if (projRes.my_role === "admin_tecnico") {
        setForms([]);
        setDatasets([]);
        setSavedAnalyses([]);
        setActiveTab((prev) => (prev === "auditoria" || prev === "equipo" ? prev : "equipo"));
      } else if (projRes.my_role === "capturador") {
        const formsRes = await listForms(projectId);
        setForms(formsRes);
        setDatasets([]);
        setSavedAnalyses([]);
        setActiveTab((prev) =>
          prev === "formularios" || prev === "monitorizacion" || prev === "consentimientos" || prev === "equipo"
            ? prev
            : "formularios"
        );
      } else {
        const [formsRes, dsRes, savedRes] = await Promise.all([
          projRes.my_role !== "estadistico" ? listForms(projectId) : Promise.resolve([] as Form[]),
          listDatasets(projectId),
          listSavedAnalyses(projectId),
        ]);
        setForms(formsRes);
        setDatasets(dsRes);
        setSavedAnalyses(savedRes);
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
    void loadStudy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, user?.uid]);

  const handleDeleteProject = async () => {
    if (!project || !user) return;
    try {
      await deleteProject(project.id, user);
      toast.success(`Estudio «${project.name}» eliminado.`);
      navigate("/");
    } catch (err) {
      toast.error(errMsg(err, "No se pudo eliminar el estudio."));
    }
  };

  const handleAnalysisSaved = (saved: SavedAnalysis) => {
    setSavedAnalyses((prev) => [saved, ...prev.filter((a) => a.id !== saved.id)]);
  };

  const handleAnalysisUpdated = (updated: SavedAnalysis) => {
    setSavedAnalyses((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  const handleAnalysisDeleted = (analysisId: string) => {
    setSavedAnalyses((prev) => prev.filter((a) => a.id !== analysisId));
  };

  const myRole = project?.my_role ?? "capturador";
  const isCapturador = myRole === "capturador";
  const isAdminTecnico = myRole === "admin_tecnico";
  const isMonitor = myRole === "monitor_clinico";
  const isEstadistico = myRole === "estadistico";
  const isAdmin = myRole === "admin";

  const canSeeDatos = !isCapturador && !isAdminTecnico;
  const canSeeBioestadisticaAndAi = Boolean(project?.can_analyze) && !isCapturador && !isAdminTecnico;
  const canSeeGuardados = !isCapturador && !isAdminTecnico;
  const canSeeFormularios = !isAdminTecnico && !isEstadistico;
  const canSeeMonitorizacion = !isAdminTecnico && !isEstadistico;
  const canSeeConsentimientos = !isAdminTecnico && !isEstadistico;
  const canSeeAuditoria = Boolean(project?.can_view_audit);

  const canRegisterVault =
    myRole === "admin" || myRole === "coordinador" || myRole === "investigador" || myRole === "capturador";
  const canWriteConsent = canRegisterVault;

  const tabs: { id: TabId; label: string; icon: typeof Database; hidden?: boolean }[] = [
    { id: "datos", label: "Datos", icon: Database, hidden: !canSeeDatos },
    { id: "bioestadistica", label: "Bioestadística", icon: BarChart3, hidden: !canSeeBioestadisticaAndAi },
    { id: "guardados", label: `Análisis guardados (${savedAnalyses.length})`, icon: Archive, hidden: !canSeeGuardados },
    { id: "ia", label: "Asistente IA", icon: MessageSquareText, hidden: !canSeeBioestadisticaAndAi },
    { id: "formularios", label: `Formularios CRF (${forms.length})`, icon: ClipboardList, hidden: !canSeeFormularios },
    { id: "monitorizacion", label: "Monitorización y desviaciones", icon: ShieldAlert, hidden: !canSeeMonitorizacion },
    { id: "consentimientos", label: "Bóveda y consentimientos", icon: KeyRound, hidden: !canSeeConsentimientos },
    { id: "auditoria", label: "Auditoría", icon: FileCheck2, hidden: !canSeeAuditoria },
    { id: "equipo", label: "Equipo y gobernanza", icon: Users },
  ];

  return (
    <AppShell me={me}>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#6E6E73] transition-colors hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver a estudios
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <h1 className="font-heading text-2xl font-semibold tracking-tight text-[#1D1D1F] sm:text-3xl dark:text-white">
                {project?.name ?? "Cargando estudio…"}
              </h1>
              {project && (
                <span className="text-xs font-medium text-[#0071E3] dark:text-[#0A84FF]">
                  · {ROLE_LABEL[project.my_role]}
                </span>
              )}
              {studyLifecycle && (
                <span className="rounded-lg border border-black/[0.08] bg-white px-2.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-[#424245] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#D1D1D6]">
                  {STUDY_STATUS_LABEL[studyLifecycle.study_status]} · Protocolo v{studyLifecycle.protocol_version}
                </span>
              )}
            </div>
            {project?.description && (
              <p className="mt-1 max-w-3xl text-sm text-[#6E6E73] dark:text-[#A1A1A6]">{project.description}</p>
            )}
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2">
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-3.5 py-2 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-900/50 dark:bg-[#141416] dark:text-rose-400 dark:hover:bg-rose-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Eliminar estudio
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3.5 py-1.5 dark:border-rose-900/60 dark:bg-rose-950/30">
                  <span className="text-xs font-medium text-rose-700 dark:text-rose-300">¿Confirmar eliminación?</span>
                  <button
                    type="button"
                    onClick={() => void handleDeleteProject()}
                    className="rounded-full bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700"
                  >
                    Eliminar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-full border border-black/[0.08] bg-white px-3 py-1 text-xs font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Apple-Style Segmented Workspace Bar */}
        <div className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl bg-black/[0.045] p-1 dark:bg-white/[0.07]">
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
                    "inline-flex items-center gap-2 whitespace-nowrap shrink-0 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all",
                    active
                      ? "bg-white text-[#1D1D1F] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#2C2C2E] dark:text-white"
                      : "text-[#6E6E73] hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:text-white"
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5", active && "text-[#0071E3] dark:text-[#0A84FF]")} />
                  {t.label}
                </button>
              );
            })}
        </div>

        {loading && !project ? (
          <div className="h-80 animate-pulse rounded-2xl border border-black/[0.05] bg-white dark:border-white/[0.06] dark:bg-[#141416]" />
        ) : (
          <div>
            {activeTab === "datos" && canSeeDatos && (
              <DataTab
                projectId={projectId}
                projectOwnerId={project?.owner_id ?? ""}
                datasets={datasets}
                activeDatasetId={activeDatasetId}
                onSelectDataset={setActiveDatasetId}
                onDatasetsChanged={() => void loadStudy()}
                canEdit={Boolean(project?.can_edit)}
                canExport={Boolean(project?.can_export_data)}
                myRole={myRole}
              />
            )}

            {activeTab === "bioestadistica" && canSeeBioestadisticaAndAi && (
              <AnalysisTab
                projectId={projectId}
                datasets={datasets}
                activeDatasetId={activeDatasetId}
                onSelectDataset={setActiveDatasetId}
                onAskCopilot={(prompt) => {
                  setPendingCopilotPrompt(prompt);
                  setActiveTab("ia");
                }}
                onAnalysisSaved={handleAnalysisSaved}
                onAnalysisUpdated={handleAnalysisUpdated}
              />
            )}

            {activeTab === "guardados" && canSeeGuardados && (
              <SavedAnalysesTab
                projectId={projectId}
                datasets={datasets}
                analyses={savedAnalyses}
                canEdit={Boolean(project?.can_edit) && !isMonitor}
                onUpdated={handleAnalysisUpdated}
                onDeleted={handleAnalysisDeleted}
                onAskCopilot={(prompt) => {
                  setPendingCopilotPrompt(prompt);
                  setActiveTab("ia");
                }}
              />
            )}

            {activeTab === "ia" && canSeeBioestadisticaAndAi && (
              <CopilotTab
                projectId={projectId}
                datasets={datasets}
                activeDatasetId={activeDatasetId}
                onSelectDataset={setActiveDatasetId}
                pendingPrompt={pendingCopilotPrompt}
                onConsumePendingPrompt={() => setPendingCopilotPrompt(null)}
                onAnalysisSaved={handleAnalysisSaved}
              />
            )}

            {activeTab === "formularios" && canSeeFormularios && (
              <FormsTab
                projectId={projectId}
                forms={forms}
                datasets={datasets}
                canEdit={Boolean(project?.can_edit)}
                onChanged={() => void loadStudy()}
              />
            )}

            {activeTab === "monitorizacion" && canSeeMonitorizacion && (
              <MonitoringTab projectId={projectId} myRole={myRole} />
            )}

            {activeTab === "consentimientos" && canSeeConsentimientos && (
              <VaultConsentTab
                projectId={projectId}
                myRole={myRole}
                canAccessVault={Boolean(project?.can_access_identity_vault)}
                canRegisterVault={canRegisterVault}
                canWriteConsent={canWriteConsent}
              />
            )}

            {activeTab === "auditoria" && canSeeAuditoria && <AuditTab projectId={projectId} />}

            {activeTab === "equipo" && (
              <MembersTab
                projectId={projectId}
                canManageTeam={Boolean(project?.can_manage_team)}
                myRole={myRole}
                studyLifecycle={studyLifecycle}
                onLifecycleChanged={() => void loadStudy()}
              />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
