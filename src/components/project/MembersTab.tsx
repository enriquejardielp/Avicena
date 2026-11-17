import { useEffect, useState } from "react";
import { Mail, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { removeProjectMemberFromFirestore, syncProjectMemberToFirestore } from "../../firebase.ts";
import { apiDelete, apiGet, apiPatch, apiPost, errMsg } from "../../lib/api.ts";
import { ROLE_LABEL, type ProjectMember, type Role, type UserRow } from "../../lib/types.ts";

interface MembersResponse {
  owner_id: string;
  my_role: Role;
  members: ProjectMember[];
  registered_users: UserRow[];
}

const ROLE_OPTIONS: { value: Role; label: string; desc: string }[] = [
  {
    value: "admin",
    label: ROLE_LABEL.admin,
    desc: "Gestiona miembros y roles, edita datos, CRF, análisis y puede eliminar el estudio.",
  },
  {
    value: "investigador",
    label: ROLE_LABEL.investigador,
    desc: "Sube bases de datos, diseña formularios CRF y ejecuta análisis estadísticos e IA.",
  },
  {
    value: "capturador",
    label: ROLE_LABEL.capturador,
    desc: "Introduce y revisa registros de pacientes únicamente en los formularios clínicos CRF.",
  },
];

export function MembersTab({
  projectId,
  canManageTeam,
  myRole,
}: {
  projectId: string;
  canManageTeam: boolean;
  myRole: Role;
}) {
  const [data, setData] = useState<MembersResponse | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [roleInput, setRoleInput] = useState<Role>("investigador");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const res = await apiGet<MembersResponse>(`/projects/${projectId}/members`);
      setData(res);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    setSubmitting(true);
    try {
      const added = await apiPost<ProjectMember>(`/projects/${projectId}/members`, {
        email,
        role: roleInput,
      });
      void syncProjectMemberToFirestore(projectId, added);
      toast.success(`Estudio compartido con ${added.email} como ${ROLE_LABEL[added.role]}.`);
      setEmailInput("");
      await load();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo compartir el estudio."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (member: ProjectMember, nextRole: Role) => {
    const key = encodeURIComponent(member.user_id || member.email);
    try {
      const updated = await apiPatch<ProjectMember>(`/projects/${projectId}/members/${key}`, { role: nextRole });
      void syncProjectMemberToFirestore(projectId, updated);
      toast.success(`Rol de ${member.name} actualizado a ${ROLE_LABEL[updated.role]}.`);
      await load();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cambiar el rol."));
    }
  };

  const handleRemove = async (member: ProjectMember) => {
    const rawKey = member.user_id || member.email;
    const key = encodeURIComponent(rawKey);
    try {
      await apiDelete(`/projects/${projectId}/members/${key}`);
      void removeProjectMemberFromFirestore(projectId, rawKey);
      toast.success(`${member.name} retirado del estudio.`);
      await load();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo retirar al miembro."));
    }
  };

  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-heading text-base font-semibold text-slate-900 dark:text-white">
              Compartir estudio y asignar roles
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {canManageTeam
                ? "Invita a colaboradores introduciendo su correo electrónico y elige su rol específico para este estudio. Si aún no tienen cuenta en Avicena, recibirán acceso en cuanto inicien sesión con ese correo."
                : `Tu rol en este estudio es ${ROLE_LABEL[myRole]}. Solo un Administrador del estudio puede invitar o modificar roles.`}
            </p>
          </div>
        </div>

        {canManageTeam && (
          <form
            onSubmit={handleShare}
            className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3 dark:border-slate-800 dark:bg-slate-950/60"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end">
              <div className="sm:col-span-6">
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Correo electrónico del colaborador
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="investigador@hospital.org"
                    className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    data-testid="share-email-input"
                  />
                </div>
              </div>

              <div className="sm:col-span-3">
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Rol en este estudio
                </label>
                <select
                  value={roleInput}
                  onChange={(e) => setRoleInput(e.target.value as Role)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  data-testid="share-role-select"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <button
                  type="submit"
                  disabled={submitting || !emailInput.trim()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60 dark:bg-sky-500 dark:hover:bg-sky-600"
                  data-testid="share-submit-btn"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {submitting ? "Compartiendo…" : "Compartir estudio"}
                </button>
              </div>
            </div>

            {data.registered_users.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500 dark:text-slate-400">
                <span>Usuarios ya registrados en Avicena:</span>
                {data.registered_users.map((u) => (
                  <button
                    key={u.user_id}
                    type="button"
                    onClick={() => setEmailInput(u.email)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-sky-400 hover:text-sky-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-600"
                  >
                    {u.name} ({u.email})
                  </button>
                ))}
              </div>
            )}
          </form>
        )}

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.members.map((m) => {
            const isOwner = Boolean(m.user_id && m.user_id === data.owner_id);
            const rowKey = m.user_id || m.email;
            return (
              <div key={rowKey} className="flex flex-wrap items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                    <span>{m.name}</span>
                    {isOwner && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Creador / Propietario
                      </span>
                    )}
                    {m.pending && (
                      <span className="text-xs font-normal text-amber-600 dark:text-amber-400">
                        · Invitación pendiente (se activará al iniciar sesión)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{m.email}</div>
                </div>

                <div className="flex items-center gap-2">
                  {canManageTeam && !isOwner ? (
                    <>
                      <select
                        aria-label={`Rol de ${m.name}`}
                        value={m.role}
                        onChange={(e) => handleRoleChange(m, e.target.value as Role)}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleRemove(m)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        Retirar
                      </button>
                    </>
                  ) : (
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {ROLE_LABEL[m.role]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Role Reference Grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {ROLE_OPTIONS.map((opt) => (
          <div
            key={opt.value}
            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="text-xs font-semibold text-slate-900 dark:text-white">{opt.label}</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{opt.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
