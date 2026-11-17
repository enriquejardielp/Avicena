import { useEffect, useState } from "react";
import { ArrowRight, Database, FileSpreadsheet, FolderPlus, Layers, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../components/layout/AppShell.tsx";
import { syncProjectToFirestore } from "../firebase.ts";
import { apiGet, apiPost, errMsg } from "../lib/api.ts";
import { useAuth } from "../lib/AuthContext.tsx";
import { Link, useNavigate } from "../lib/router.tsx";
import { ROLE_LABEL, type Me, type Project } from "../lib/types.ts";

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [meRes, projRes] = await Promise.all([apiGet<Me>("/me"), apiGet<Project[]>("/projects")]);
      setMe(meRes);
      setProjects(projRes);
    } catch (err) {
      toast.error(errMsg(err, "Error al cargar los estudios clínicos."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await apiPost<Project>("/projects", {
        name: newName.trim(),
        description: newDesc.trim(),
      });
      if (user) {
        void syncProjectToFirestore(created.id, created.name, created.description, user);
      }
      toast.success(`Estudio «${created.name}» creado como Administrador.`);
      setShowNewModal(false);
      setNewName("");
      setNewDesc("");
      navigate(`/proyectos/${created.id}`);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo crear el estudio."));
    } finally {
      setCreating(false);
    }
  };

  const totalRecords = projects.reduce((acc, p) => acc + p.record_count, 0);
  const totalForms = projects.reduce((acc, p) => acc + p.form_count, 0);

  return (
    <AppShell me={me}>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-8">
        {/* Clean Research Workspace Header */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-medium text-sky-700 dark:text-sky-400">
                Espacio de trabajo · Avicena
              </p>
              <h1 className="mt-1.5 font-heading text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white text-balance">
                Estudios clínicos y análisis de datos
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Gestiona tus cohortes, diseña cuadernos CRF, asigna roles a tu equipo y ejecuta las 21 pruebas estadísticas desde un único panel.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-6 lg:gap-8">
              <div className="flex items-center gap-6 border-slate-200 pr-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <div>
                  <div className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {projects.length}
                  </div>
                  <div>Estudios</div>
                </div>
                <div>
                  <div className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {totalRecords}
                  </div>
                  <div>Registros</div>
                </div>
                <div>
                  <div className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {totalForms}
                  </div>
                  <div>Formularios CRF</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowNewModal(true)}
                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-600"
                data-testid="new-project-btn"
              >
                <FolderPlus className="h-4 w-4" />
                Nuevo estudio
              </button>
            </div>
          </div>
        </section>

        {/* Study Portfolio Grid */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold text-slate-900 dark:text-white">
              Mis estudios clínicos
            </h2>
            {me && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Sesión: <strong className="text-slate-700 dark:text-slate-200">{me.name}</strong>
              </span>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                />
              ))}
            </div>
          ) : !projects.length ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
              <h3 className="font-heading text-base font-semibold text-slate-900 dark:text-white">
                Todavía no hay estudios en tu espacio de trabajo
              </h3>
              <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Crea tu primer estudio clínico para importar cohortes CSV/Excel o diseñar formularios CRF. Quedarás asignado como Administrador y podrás invitar a otros miembros por correo electrónico.
              </p>
              <button
                type="button"
                onClick={() => setShowNewModal(true)}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-600"
                data-testid="empty-create-project-btn"
              >
                <FolderPlus className="h-4 w-4" />
                Crear mi primer estudio
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  to={`/proyectos/${p.id}`}
                  data-testid={`project-card-${p.id}`}
                  className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 transition-all hover:border-sky-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-700"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-heading text-base font-semibold text-slate-900 group-hover:text-sky-700 dark:text-white dark:group-hover:text-sky-400">
                        {p.name}
                      </h3>
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-sky-600" />
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {p.description || "Estudio observacional o ensayo clínico en Avicena."}
                    </p>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <Database className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                        {p.record_count} reg.
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <Layers className="h-3.5 w-3.5 text-slate-400" />
                        {p.dataset_count} bases
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        {p.form_count} CRF
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 font-medium text-sky-700 dark:text-sky-400">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {ROLE_LABEL[p.my_role]}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Create Project Dialog */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="font-heading text-lg font-semibold text-slate-900 dark:text-white">
              Crear nuevo estudio clínico
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Serás su Administrador desde el primer momento y podrás compartirlo con otros usuarios por correo asignando sus roles.
            </p>
            <form onSubmit={handleCreateProject} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Nombre del estudio *
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ej: Cohorte HTA Hospital Central 2026"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  data-testid="new-project-name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Descripción breve
                </label>
                <textarea
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Objetivo clínico, población y desenlace principal…"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  data-testid="new-project-desc"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                  data-testid="create-project-submit"
                >
                  {creating ? "Creando…" : "Crear estudio"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
