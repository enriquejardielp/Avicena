import { ClipboardList, FilePlus2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, errMsg } from "../../lib/api.ts";
import { Link } from "../../lib/router.tsx";
import type { Form } from "../../lib/types.ts";

interface FormsTabProps {
  projectId: string;
  forms: Form[];
  canEdit: boolean;
  onChanged: () => void;
}

export function FormsTab({ projectId, forms, canEdit, onChanged }: FormsTabProps) {
  const handleDelete = async (f: Form) => {
    try {
      await apiDelete(`/forms/${f.id}`);
      toast.success(`Formulario «${f.name}» eliminado.`);
      onChanged();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo eliminar el formulario."));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-semibold text-slate-900 dark:text-white">
            Cuadernos de recogida de datos clínicos (CRF)
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cada registro capturado valida rangos clínicos y alimenta automáticamente su base de datos en tiempo real.
          </p>
        </div>
        {canEdit && (
          <Link
            to={`/proyectos/${projectId}/formularios/nuevo`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-600"
            data-testid="new-form-btn"
          >
            <FilePlus2 className="h-4 w-4" />
            Nuevo formulario CRF
          </Link>
        )}
      </div>

      {!forms.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Este estudio aún no tiene formularios clínicos CRF configurados.
          </p>
          {canEdit && (
            <Link
              to={`/proyectos/${projectId}/formularios/nuevo`}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700"
            >
              <FilePlus2 className="h-4 w-4" />
              Diseñar primer CRF
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {forms.map((f) => (
            <div
              key={f.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              data-testid={`form-card-${f.id}`}
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-heading text-base font-semibold text-slate-900 dark:text-white">{f.name}</h4>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {f.description || "Cuaderno de recogida clínica estructurada."}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                    {f.fields.length} campos
                  </span>
                  <span>·</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                    {f.record_count} pacientes capturados
                  </span>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                <Link
                  to={`/formularios/${f.id}/capturar`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                  data-testid={`capture-form-${f.id}`}
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  Capturar paciente
                </Link>

                {canEdit && (
                  <>
                    <Link
                      to={`/formularios/${f.id}/editar`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      data-testid={`edit-form-${f.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar diseño
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(f)}
                      className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
