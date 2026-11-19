import { ClipboardList, FilePlus2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { errMsg } from "../../lib/api.ts";
import { useAuth } from "../../lib/AuthContext.tsx";
import { deleteForm } from "../../lib/firestoreDb.ts";
import { Link } from "../../lib/router.tsx";
import type { Dataset, Form } from "../../lib/types.ts";

interface FormsTabProps {
  projectId: string;
  forms: Form[];
  datasets?: Dataset[];
  canEdit: boolean;
  onChanged: () => void;
}

export function FormsTab({ projectId, forms, datasets, canEdit, onChanged }: FormsTabProps) {
  const { user } = useAuth();

  const handleDelete = async (f: Form) => {
    if (!user) return;
    const linkedDs = datasets?.find((d) => d.id === f.dataset_id);
    try {
      await deleteForm(projectId, f, user);
      if (linkedDs?.source === "upload") {
        toast.success(`Formulario «${f.name}» eliminado. La base importada «${linkedDs.name}» se ha conservado.`);
      } else {
        toast.success(`Formulario «${f.name}» eliminado.`);
      }
      onChanged();
    } catch (err) {
      toast.error(errMsg(err, "No se pudo eliminar el formulario."));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
            Cuadernos de recogida de datos clínicos (CRF)
          </h3>
          <p className="mt-0.5 text-xs text-[#6E6E73] dark:text-[#98989D]">
            Cada registro capturado valida rangos clínicos y alimenta automáticamente su base de datos en tiempo real.
          </p>
        </div>
        {canEdit && (
          <Link
            to={`/proyectos/${projectId}/formularios/nuevo`}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full bg-[#0071E3] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#0077ED] dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
            data-testid="new-form-btn"
          >
            <FilePlus2 className="h-4 w-4" />
            Nuevo formulario CRF
          </Link>
        )}
      </div>

      {!forms.length ? (
        <div className="apple-card rounded-3xl border border-dashed border-black/[0.12] bg-white p-14 text-center dark:border-white/[0.12] dark:bg-[#141416]">
          <p className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
            Este estudio aún no tiene formularios clínicos CRF configurados.
          </p>
          <p className="mt-1.5 text-xs text-[#6E6E73] dark:text-[#98989D]">
            Diseña un formulario nuevo o importa un Excel/CSV en Datos para generarlo automáticamente.
          </p>
          {canEdit && (
            <Link
              to={`/proyectos/${projectId}/formularios/nuevo`}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#0071E3] px-5 py-2.5 text-xs font-medium text-white transition-colors hover:bg-[#0077ED] dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
            >
              <FilePlus2 className="h-4 w-4" />
              Diseñar primer CRF
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {forms.map((f) => {
            const linkedDs = datasets?.find((d) => d.id === f.dataset_id);
            return (
              <div
                key={f.id}
                className="apple-card flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-white p-6 transition-all hover:border-black/[0.12] dark:border-white/[0.08] dark:bg-[#141416] dark:hover:border-white/[0.15]"
                data-testid={`form-card-${f.id}`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-heading text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                        {f.name}
                      </h4>
                      <p className="mt-1 text-xs leading-relaxed text-[#6E6E73] dark:text-[#98989D]">
                        {f.description || "Cuaderno de recogida clínica estructurada."}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[#6E6E73] dark:text-[#98989D]">
                    <span className="font-mono tabular-nums font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                      {f.fields.length} campos
                    </span>
                    <span>·</span>
                    <span className="font-mono tabular-nums font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                      {f.record_count} capturados por CRF
                    </span>
                    {linkedDs && linkedDs.source === "upload" && (
                      <>
                        <span>·</span>
                        <span>
                          Base importada: <strong className="font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">{linkedDs.name}</strong>{" "}
                          (<span className="font-mono tabular-nums">{linkedDs.n_rows}</span> totales)
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-black/[0.05] pt-4 dark:border-white/[0.06]">
                  <Link
                    to={`/proyectos/${projectId}/formularios/${f.id}/capturar`}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                    data-testid={`capture-form-${f.id}`}
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    Capturar paciente
                  </Link>

                {canEdit && (
                  <>
                    <Link
                      to={`/proyectos/${projectId}/formularios/${f.id}/editar`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3.5 py-2 text-xs font-medium text-[#1D1D1F] transition hover:bg-[#F5F5F7] dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:hover:bg-white/[0.08]"
                      data-testid={`edit-form-${f.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5 text-[#6E6E73] dark:text-[#98989D]" />
                      Editar diseño
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(f)}
                      className="inline-flex items-center gap-1 rounded-full border border-rose-200/80 bg-white px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/30 dark:bg-[#1C1C1E] dark:text-rose-400 dark:hover:bg-rose-950/30"
                      aria-label={`Eliminar formulario ${f.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
