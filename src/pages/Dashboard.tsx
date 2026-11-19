import { useEffect, useState } from "react";
import { ArrowRight, Database, FileSpreadsheet, FolderPlus, Layers, MailCheck, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../components/layout/AppShell.tsx";
import { errMsg } from "../lib/api.ts";
import { useAuth } from "../lib/AuthContext.tsx";
import { createProject, listProjects } from "../lib/firestoreDb.ts";
import { Link, useNavigate } from "../lib/router.tsx";
import { ROLE_LABEL, type Me, type Project } from "../lib/types.ts";

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, resendVerification } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [checkingVerify, setCheckingVerify] = useState(false);

  const me: Me | null = user
    ? {
        user_id: user.uid,
        email: user.email ?? "",
        name: user.displayName || user.email?.split("@")[0] || "Investigador",
        photo_url: user.photoURL,
      }
    : null;

  const loadAll = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const projRes = await listProjects(user);
      setProjects(projRes);
    } catch (err) {
      toast.error(errMsg(err, "Error al cargar los estudios clínicos."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, user?.emailVerified]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !user) return;
    setCreating(true);
    try {
      const created = await createProject(newName.trim(), newDesc.trim(), user);
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

  const handleRefreshVerification = async () => {
    if (!user) return;
    setCheckingVerify(true);
    try {
      await user.reload();
      if (user.emailVerified) {
        await user.getIdToken(true);
        toast.success("Correo verificado correctamente. Sincronizando espacio de trabajo…");
        window.location.reload();
      } else {
        toast.info("Tu correo aún figura como pendiente de verificación. Revisa tu bandeja de entrada o spam.");
      }
    } catch (err) {
      toast.error(errMsg(err, "No se pudo comprobar el estado de verificación."));
    } finally {
      setCheckingVerify(false);
    }
  };

  const handleResendVerification = async () => {
    try {
      await resendVerification();
      toast.success("Correo de verificación reenviado.");
    } catch (err) {
      toast.error(errMsg(err, "No se pudo reenviar el correo de verificación."));
    }
  };

  const totalRecords = projects.reduce((acc, p) => acc + p.record_count, 0);
  const totalForms = projects.reduce((acc, p) => acc + p.form_count, 0);

  return (
    <AppShell me={me}>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-8">
        {user && !user.emailVerified && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-300/70 bg-amber-50/90 px-5 py-4 text-xs text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200">
            <div className="flex items-start gap-3">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-semibold">Verifica tu dirección de correo ({user.email})</p>
                <p className="mt-0.5 text-amber-800/90 dark:text-amber-300/90">
                  Para crear estudios clínicos, guardar pacientes o compartir proyectos en la nube es necesario confirmar tu correo electrónico.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleResendVerification}
                className="rounded-full border border-amber-300 bg-white px-3.5 py-1.5 font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-[#1C1C1E] dark:text-amber-200"
              >
                Reenviar correo
              </button>
              <button
                type="button"
                disabled={checkingVerify}
                onClick={handleRefreshVerification}
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-3.5 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checkingVerify ? "animate-spin" : ""}`} />
                Ya lo he verificado
              </button>
            </div>
          </div>
        )}

        {/* Calm Apple-Inspired Research Header */}
        <section className="rounded-[24px] border border-black/[0.06] bg-white p-7 sm:p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_32px_-16px_rgba(0,0,0,0.06)] dark:border-white/[0.08] dark:bg-[#141416]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h1 className="font-heading text-3xl font-semibold tracking-[-0.03em] text-[#1D1D1F] sm:text-4xl dark:text-white text-balance">
                Estudios clínicos
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[#6E6E73] sm:text-[15px] dark:text-[#A1A1A6]">
                Organiza tus cohortes, diseña cuadernos de recogida de datos y accede a los análisis guardados de cada proyecto.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-6 lg:gap-8">
              <div className="flex items-center gap-7 text-xs text-[#6E6E73] dark:text-[#98989D]">
                <div>
                  <div className="font-mono text-2xl font-semibold tabular-nums text-[#1D1D1F] dark:text-white">
                    {projects.length}
                  </div>
                  <div>Estudios</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-semibold tabular-nums text-[#1D1D1F] dark:text-white">
                    {totalRecords}
                  </div>
                  <div>Registros</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-semibold tabular-nums text-[#1D1D1F] dark:text-white">
                    {totalForms}
                  </div>
                  <div>Formularios CRF</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowNewModal(true)}
                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[#0071E3] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#0077ED] dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
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
          <div className="flex items-center justify-between px-1">
            <h2 className="font-heading text-lg font-semibold text-[#1D1D1F] dark:text-white">
              Mis proyectos
            </h2>
            {me && (
              <span className="text-xs text-[#6E6E73] dark:text-[#98989D]">
                Sesión de <strong className="font-medium text-[#1D1D1F] dark:text-white">{me.name}</strong>
              </span>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-48 animate-pulse rounded-2xl border border-black/[0.05] bg-white dark:border-white/[0.06] dark:bg-[#141416]"
                />
              ))}
            </div>
          ) : !projects.length ? (
            <div className="rounded-[24px] border border-dashed border-black/[0.12] bg-white px-6 py-14 text-center dark:border-white/[0.14] dark:bg-[#141416]">
              <h3 className="font-heading text-base font-semibold text-[#1D1D1F] dark:text-white">
                Todavía no hay estudios en tu espacio de trabajo
              </h3>
              <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                Crea tu primer estudio clínico para importar cohortes CSV o Excel o diseñar formularios CRF. Quedarás asignado como Administrador y podrás invitar a colaboradores por correo electrónico.
              </p>
              <button
                type="button"
                onClick={() => setShowNewModal(true)}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#0071E3] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#0077ED] dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
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
                  className="group flex flex-col justify-between rounded-[22px] border border-black/[0.06] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0071E3]/40 hover:shadow-[0_16px_36px_-16px_rgba(0,0,0,0.12)] dark:border-white/[0.08] dark:bg-[#141416] dark:hover:border-[#0A84FF]/50"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-heading text-base font-semibold text-[#1D1D1F] transition-colors group-hover:text-[#0071E3] dark:text-white dark:group-hover:text-[#0A84FF]">
                        {p.name}
                      </h3>
                      <ArrowRight className="h-4 w-4 shrink-0 text-[#8E8E93] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#0071E3] dark:group-hover:text-[#0A84FF]" />
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                      {p.description || "Estudio observacional o ensayo clínico en Avicena."}
                    </p>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.05] pt-3.5 text-xs text-[#6E6E73] dark:border-white/[0.06] dark:text-[#98989D]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <Database className="h-3.5 w-3.5 text-[#0071E3] dark:text-[#0A84FF]" />
                        {p.record_count} reg.
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <Layers className="h-3.5 w-3.5 text-[#8E8E93]" />
                        {p.dataset_count} bases
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        {p.form_count} CRF
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 font-medium text-[#0071E3] dark:text-[#0A84FF]">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[24px] border border-black/[0.08] bg-white p-6 sm:p-7 shadow-2xl dark:border-white/[0.1] dark:bg-[#141416]">
            <h3 className="font-heading text-lg font-semibold text-[#1D1D1F] dark:text-white">
              Crear nuevo estudio clínico
            </h3>
            <p className="mt-1 text-xs text-[#6E6E73] dark:text-[#98989D]">
              Serás su Administrador desde el primer momento y podrás compartirlo con otros usuarios por correo asignando sus roles.
            </p>
            <form onSubmit={handleCreateProject} className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Nombre del estudio *
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ej: Cohorte HTA Hospital Central 2026"
                  className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2.5 text-sm text-[#1D1D1F] focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:bg-[#1C1C1E] dark:text-white dark:focus:border-[#0A84FF] dark:focus:bg-[#141416]"
                  data-testid="new-project-name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                  Descripción breve
                </label>
                <textarea
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Objetivo clínico, población y desenlace principal…"
                  className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2.5 text-sm text-[#1D1D1F] focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:bg-[#1C1C1E] dark:text-white dark:focus:border-[#0A84FF] dark:focus:bg-[#141416]"
                  data-testid="new-project-desc"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="rounded-full border border-black/[0.08] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:text-[#F5F5F7] dark:hover:bg-[#1C1C1E]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="rounded-full bg-[#0071E3] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
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
