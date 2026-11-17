import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FieldInput, type FieldValue } from "@/components/forms/FieldInput";
import { apiGet, apiPost, errMsg } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import type { Form, RecordOut } from "@/lib/types";

export default function FormFillPage() {
  const { formId = "" } = useParams();
  const form = useQuery({ queryKey: ["form", formId], queryFn: () => apiGet<Form>(`/forms/${formId}`) });
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [saved, setSaved] = useState(0);
  const f = form.data;

  const submit = useMutation({
    mutationFn: () => apiPost<RecordOut>(`/forms/${formId}/records`, { data: values }),
    onSuccess: () => {
      toast.success("Registro guardado");
      setValues({});
      setSaved((n) => n + 1);
      queryClient.invalidateQueries({ queryKey: ["form", formId] });
      queryClient.invalidateQueries({ queryKey: ["forms", f?.project_id] });
      queryClient.invalidateQueries({ queryKey: ["records", formId] });
      queryClient.invalidateQueries({ queryKey: ["datasets", f?.project_id] });
      queryClient.invalidateQueries({ queryKey: ["rows", f?.dataset_id] });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const missing = (f?.fields ?? []).filter((x) => x.required && (values[x.name] === undefined || values[x.name] === "" || values[x.name] === null || (Array.isArray(values[x.name]) && !(values[x.name] as string[]).length)));

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <Link to={f ? `/proyectos/${f.project_id}` : "/"} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900" data-testid="fill-back-link">
        <ChevronLeft className="size-4" /> Volver al proyecto
      </Link>
      <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-7 shadow-[0_30px_70px_-40px_rgba(15,23,42,0.35)] md:p-9">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Captura de datos</p>
        <h1 className="mt-2 text-3xl font-semibold" data-testid="fill-form-title">{f?.name ?? (form.isError ? "Formulario no disponible" : "Cargando…")}</h1>
        {f?.description && <p className="mt-1 text-slate-500">{f.description}</p>}
        {form.isError && <p className="mt-3 text-sm text-amber-700">{errMsg(form.error)}</p>}
        {saved > 0 && (
          <div className="mt-5 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 animate-fade-up" data-testid="fill-success-banner">
            <CheckCircle2 className="size-4" /> {saved} registro(s) guardado(s) en esta sesión. Total en el formulario: {f?.record_count ?? "—"}.
          </div>
        )}
        <form className="mt-8 space-y-6" onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
          {f?.fields.map((x) => (
            <div key={x.name} className="space-y-2">
              <Label className="text-sm font-medium">{x.label}{x.required && <span className="text-rose-500"> *</span>}</Label>
              <FieldInput f={x} value={values[x.name] ?? (x.type === "checkbox" ? [] : null)} onChange={(v) => setValues({ ...values, [x.name]: v })} />
              {x.help && <p className="text-xs text-slate-400">{x.help}</p>}
            </div>
          ))}
          {f && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-6">
              <p className="text-xs text-slate-400">{missing.length ? `Faltan ${missing.length} campo(s) obligatorio(s)` : "Listo para guardar"}</p>
              <Button type="submit" size="lg" className="rounded-full px-7" disabled={submit.isPending || missing.length > 0} data-testid="fill-submit-button">
                {submit.isPending ? "Guardando…" : "Guardar registro"}
              </Button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
