import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMe } from "@/components/auth/AuthBridge";
import { RoleBadge } from "@/components/common/RoleBadge";
import { apiGet, apiPatch, errMsg } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { ROLE_LABEL, type Role, type UserRow, type UsersList } from "@/lib/types";

const PERMS: Record<Role, string[]> = {
  admin: ["Ve y edita todos los proyectos", "Gestiona usuarios y roles", "Análisis, IA y formularios"],
  investigador: ["Crea proyectos e invita a su equipo", "Importa datos, analiza y usa la IA", "Diseña formularios"],
  capturador: ["Solo captura registros en formularios", "Ve únicamente sus propios registros", "Sin acceso a análisis"],
};

export default function UsersPage() {
  const { data: me } = useMe();
  const users = useQuery({ queryKey: ["users"], queryFn: () => apiGet<UsersList>("/users"), enabled: me?.role === "admin" });
  const change = useMutation({
    mutationFn: ({ uid, role }: { uid: string; role: Role }) => apiPatch<UserRow>(`/users/${uid}/role`, { role }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["users"] }); toast.success("Rol actualizado"); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (me && me.role !== "admin")
    return <div className="mx-auto max-w-3xl px-6 py-16 text-center text-slate-600" data-testid="users-forbidden">Solo los administradores pueden gestionar usuarios.</div>;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Administración</p>
      <h1 className="mt-2 text-4xl font-semibold" data-testid="users-title">Usuarios y roles</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {(Object.keys(PERMS) as Role[]).map((r) => (
          <div key={r} className="rounded-2xl border border-slate-200 bg-white p-5">
            <RoleBadge role={r} />
            <ul className="mt-3 space-y-1.5 text-sm text-slate-600">{PERMS[r].map((p) => <li key={p} className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-slate-400" />{p}</li>)}</ul>
          </div>
        ))}
      </div>
      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm" data-testid="users-table">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Usuario</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Email</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Rol</th>
            </tr>
          </thead>
          <tbody>
            {(users.data?.users ?? []).map((u) => (
              <tr key={u.user_id} className="border-t border-slate-100" data-testid={`user-row-${u.user_id}`}>
                <td className="px-4 py-3 font-medium">{u.name || "—"}{u.user_id === me?.user_id && <span className="ml-2 text-xs text-slate-400">(tú)</span>}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3">
                  <Select value={u.role} onValueChange={(v: string) => change.mutate({ uid: u.user_id, role: v as Role })}>
                    <SelectTrigger className="h-9 w-52 rounded-xl" data-testid={`user-role-select-${u.user_id}`}>
                      <SelectValue>{(v: string) => ROLE_LABEL[v as Role]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(users.data?.roles ?? []).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.isError && <p className="p-6 text-sm text-amber-700">{errMsg(users.error)}</p>}
      </div>
    </div>
  );
}
