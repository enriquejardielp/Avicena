import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { FieldInput } from "../components/forms/FieldInput.tsx";
import { AppShell } from "../components/layout/AppShell.tsx";
import { apiGet, apiPost, errMsg } from "../lib/api.ts";
import { Link } from "../lib/router.tsx";
import type { Form, RecordOut } from "../lib/types.ts";
import { formatShortDate } from "../lib/utils.ts";

export default function FormFillPage({ formId }: { formId: string }) {
  const [form, setForm] = useState<Form | null>(null);
  const [records, setRecords] = useState<RecordOut[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    try {
      const [fRes, recRes] = await Promise.all([
        apiGet<Form>(`/forms/${formId}`),
        apiGet<RecordOut[]>(`/forms/${formId}/records`),
      ]);
      setForm(fRes);
      setRecords(recRes);
    } catch (err) {
      toast.error(errMsg(err, "No se pudo cargar el cuaderno CRF."));
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSubmitting(true);
    try {
      await apiPost<RecordOut>(`/forms/${form.id}/records`, { data: values });
      toast.success("Registro clínico guardado y sincronizado con la base de datos.");
      setValues({});
      await loadData();
    } catch (err) {
      toast.error(errMsg(err, "Error de validación clínica al guardar el registro."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 space-y-6">
        {form && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <Link
                to={`/proyectos/${form.project_id}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Volver al estudio
              </Link>
              <h1 className="mt-1 font-heading text-2xl font-bold text-slate-900 dark:text-white">{form.name}</h1>
              {form.description && (
                <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{form.description}</p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-right dark:border-slate-800 dark:bg-slate-900">
              <div className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {form.record_count}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Pacientes capturados</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleSubmit}
            className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-6 space-y-5 dark:border-slate-800 dark:bg-slate-900"
          >
            {form?.fields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                value={values[field.name]}
                onChange={(val) => setValues((prev) => ({ ...prev, [field.name]: val }))}
                disabled={submitting}
              />
            ))}

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={submitting || !form}
                data-testid="submit-record-btn"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
              >
                <CheckCircle2 className="h-4 w-4" />
                {submitting ? "Validando y guardando…" : "Guardar paciente"}
              </button>
            </div>
          </form>

          {/* Recent Entries */}
          <div className="lg:col-span-5 space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-heading text-sm font-semibold text-slate-900 dark:text-white">
                Últimos registros capturados
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Sincronizados automáticamente con la sábana analítica.
              </p>

              <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                {!records.length ? (
                  <p className="py-6 text-center text-xs text-slate-500">Todavía no hay pacientes registrados aquí.</p>
                ) : (
                  records.slice(0, 8).map((rec) => {
                    const firstKeys = form?.fields.slice(0, 3).map((f) => f.name) ?? Object.keys(rec.data).slice(0, 3);
                    return (
                      <div key={rec.id} className="py-3 text-xs">
                        <div className="flex items-center justify-between font-medium text-slate-900 dark:text-white">
                          <span className="font-mono">{String(rec.data[firstKeys[0]] ?? rec.id.slice(0, 8))}</span>
                          <span className="text-[11px] text-slate-400">{formatShortDate(rec.created_at)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-500 dark:text-slate-400">
                          {firstKeys.slice(1).map((k) => (
                            <span key={k}>
                              {k}: <strong className="font-mono text-slate-700 dark:text-slate-200">{String(rec.data[k] ?? "—")}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
