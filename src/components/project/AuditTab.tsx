import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { errMsg } from "../../lib/api.ts";
import { listAuditLogs, verifyProjectAuditTrail } from "../../lib/firestoreDb.ts";
import type { AuditLogEntry } from "../../lib/types.ts";

export function AuditTab({ projectId }: { projectId: string }) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("ALL");
  const [outcomeFilter, setOutcomeFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    checkedCount: number;
    brokenAtIndex: number | null;
    reason?: string;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const entries = await listAuditLogs(projectId);
      setLogs(entries);
      setVerifyResult(null);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cargar el registro de auditoría."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const distinctActions = useMemo(
    () => Array.from(new Set(logs.map((l) => l.action))).sort(),
    [logs]
  );

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...logs]
      .reverse()
      .filter((l) => {
        if (actionFilter !== "ALL" && l.action !== actionFilter) return false;
        if (outcomeFilter !== "ALL" && l.outcome !== outcomeFilter) return false;
        if (!q) return true;
        return (
          l.actor_name.toLowerCase().includes(q) ||
          l.actor_role.toLowerCase().includes(q) ||
          l.action.toLowerCase().includes(q) ||
          l.resource_id.toLowerCase().includes(q) ||
          l.reason.toLowerCase().includes(q)
        );
      });
  }, [logs, actionFilter, outcomeFilter, search]);

  const handleVerifyChain = async () => {
    setVerifying(true);
    try {
      const res = await verifyProjectAuditTrail(projectId, logs);
      setVerifyResult(res);
      if (res.valid) {
        toast.success(`Cadena HMAC íntegra (${res.checkedCount} eventos verificados).`);
      } else {
        toast.error(res.reason || "Se detectó una inconsistencia en la cadena de auditoría.");
      }
    } catch (err) {
      toast.error(errMsg(err, "No se pudo verificar la cadena criptográfica HMAC."));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="apple-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
        <div>
          <h3 className="font-heading text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
            Audit Trail inmutable (cadena HMAC-SHA256)
          </h3>
          <p className="mt-0.5 text-xs text-[#6E6E73] dark:text-[#98989D]">
            Cada acceso sensible, modificación de CRF, exportación y cambio de permisos queda encadenado criptográficamente en modo solo lectura/adición.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3.5 py-2 text-xs font-medium text-[#1D1D1F] transition hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </button>

          <button
            type="button"
            disabled={verifying || loading}
            onClick={() => void handleVerifyChain()}
            data-testid="verify-audit-chain-btn"
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {verifying ? "Verificando…" : "Verificar cadena criptográfica HMAC"}
          </button>
        </div>
      </div>

      {verifyResult && (
        <div
          data-testid="audit-verify-banner"
          className={`flex items-start gap-3 rounded-2xl border p-4 text-xs ${
            verifyResult.valid
              ? "border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
              : "border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
          }`}
        >
          {verifyResult.valid ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          )}
          <div>
            <div className="font-semibold">
              {verifyResult.valid
                ? `Cadena de auditoría íntegra (${verifyResult.checkedCount} eventos verificados sin alteraciones)`
                : `Integridad comprometida en el índice ${verifyResult.brokenAtIndex ?? "?"}`}
            </div>
            {verifyResult.reason && <p className="mt-0.5">{verifyResult.reason}</p>}
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="apple-card flex flex-wrap items-center gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/[0.08] dark:bg-[#141416]">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#86868B]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por actor, rol, acción, recurso o motivo…"
            className="w-full rounded-xl border border-transparent bg-[#F5F5F7] py-2 pl-9 pr-3 text-xs text-[#1D1D1F] placeholder:text-[#86868B] focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
          />
        </div>
        <select
          aria-label="Filtrar por acción"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3 py-2 text-xs font-medium text-[#1D1D1F] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
        >
          <option value="ALL">Todas las acciones</option>
          {distinctActions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por resultado"
          value={outcomeFilter}
          onChange={(e) => setOutcomeFilter(e.target.value)}
          className="rounded-xl border border-black/[0.08] bg-[#F5F5F7] px-3 py-2 text-xs font-medium text-[#1D1D1F] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
        >
          <option value="ALL">Todos los resultados</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="DENIED">DENIED</option>
          <option value="ERROR">ERROR</option>
        </select>
      </div>

      {/* Audit Log Table */}
      <div className="apple-card overflow-hidden rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.08] dark:bg-[#141416]">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-black/[0.06] bg-[#F5F5F7]/70 text-left text-[11px] font-semibold uppercase tracking-wider text-[#6E6E73] dark:border-white/[0.08] dark:bg-[#1C1C1E]/80 dark:text-[#98989D]">
                <th className="px-4 py-3">Fecha UTC</th>
                <th className="px-4 py-3">Actor / Rol</th>
                <th className="px-4 py-3">Acción</th>
                <th className="px-4 py-3">Recurso</th>
                <th className="px-4 py-3">Resultado</th>
                <th className="px-4 py-3">Motivo</th>
                <th className="px-4 py-3">Firma HMAC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[#86868B]">
                    Cargando eventos de auditoría…
                  </td>
                </tr>
              ) : !filteredLogs.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[#86868B]">
                    No hay eventos de auditoría que coincidan con el filtro.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((entry) => (
                  <tr key={entry.id} className="hover:bg-[#F5F5F7]/50 dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 whitespace-nowrap font-mono text-[11px] text-[#6E6E73] dark:text-[#98989D]">
                      {entry.timestamp_utc.replace("T", " ").slice(0, 19)}Z
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">{entry.actor_name}</div>
                      <div className="font-mono text-[10px] text-[#86868B]">{entry.actor_role}</div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap font-mono font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                      {entry.action}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap font-mono text-[11px] text-[#424245] dark:text-[#D1D1D6]">
                      {entry.resource_type}/{entry.resource_id.slice(0, 18)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span
                        className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold ${
                          entry.outcome === "SUCCESS"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : entry.outcome === "DENIED"
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                        }`}
                      >
                        {entry.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 max-w-xs truncate text-[#424245] dark:text-[#D1D1D6]" title={entry.reason}>
                      {entry.reason || "—"}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap font-mono text-[11px] text-[#86868B]" title={entry.entry_hash}>
                      {entry.entry_hash.slice(0, 12)}…
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
