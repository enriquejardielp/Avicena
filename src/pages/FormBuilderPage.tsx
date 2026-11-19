import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FieldInput } from "../components/forms/FieldInput.tsx";
import { AppShell } from "../components/layout/AppShell.tsx";
import { errMsg } from "../lib/api.ts";
import { useAuth } from "../lib/AuthContext.tsx";
import { createForm, findFormProjectId, getForm, updateForm } from "../lib/firestoreDb.ts";
import { Link, useNavigate } from "../lib/router.tsx";
import type { FieldType, FormField } from "../lib/types.ts";
import { cn, slugifyVarName } from "../lib/utils.ts";

const FIELD_TYPES: { type: FieldType; label: string }[] = [
  { type: "text", label: "Texto corto" },
  { type: "number", label: "Número clínico" },
  { type: "date", label: "Fecha" },
  { type: "select", label: "Desplegable" },
  { type: "radio", label: "Opción única (radio)" },
  { type: "yesno", label: "Sí / No" },
  { type: "checkbox", label: "Selección múltiple" },
  { type: "textarea", label: "Observaciones" },
];

function createEmptyField(type: FieldType, existingCount: number): FormField {
  const baseLabel = FIELD_TYPES.find((t) => t.type === type)?.label ?? "Campo";
  const label = `${baseLabel} ${existingCount + 1}`;
  return {
    name: slugifyVarName(label),
    label,
    type,
    required: false,
    choices: type === "select" || type === "radio" || type === "checkbox" ? ["Opción 1", "Opción 2"] : [],
    min: null,
    max: null,
    unit: "",
    help: "",
  };
}

export default function FormBuilderPage({ projectId, formId }: { projectId?: string; formId?: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isEdit = Boolean(formId);

  const [resolvedProjectId, setResolvedProjectId] = useState(projectId ?? "");
  const [name, setName] = useState("Nuevo cuaderno CRF");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([
    {
      name: "id_paciente",
      label: "ID del paciente",
      type: "text",
      required: true,
      choices: [],
      min: null,
      max: null,
      unit: "",
      help: "Identificador anonimizado del participante",
    },
    {
      name: "edad",
      label: "Edad",
      type: "number",
      required: true,
      choices: [],
      min: 18,
      max: 110,
      unit: "años",
      help: "",
    },
  ]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [choicesDraft, setChoicesDraft] = useState("");
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  // Sync raw textarea draft when switching selected field (preserves trailing newlines while typing)
  useEffect(() => {
    const f = fields[selectedIdx];
    setChoicesDraft(f ? f.choices.join("\n") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx]);

  useEffect(() => {
    if (!formId || !user) return;
    let active = true;
    (async () => {
      try {
        const pid = projectId || (await findFormProjectId(formId, user));
        if (!pid) {
          throw new Error("No se encontró el estudio de este formulario.");
        }
        const f = await getForm(pid, formId);
        if (!active) return;
        setResolvedProjectId(f.project_id);
        setName(f.name);
        setDescription(f.description);
        setFields(f.fields);
        setSelectedIdx(0);
        setChoicesDraft(f.fields[0]?.choices.join("\n") ?? "");
      } catch (err) {
        if (active) toast.error(errMsg(err, "No se pudo cargar el formulario."));
      }
    })();
    return () => {
      active = false;
    };
  }, [formId, projectId, user]);

  const addField = (type: FieldType) => {
    const next = createEmptyField(type, fields.length);
    const nextIdx = fields.length;
    setFields((prev) => [...prev, next]);
    setSelectedIdx(nextIdx);
    setChoicesDraft(next.choices.join("\n"));
  };

  const updateField = (idx: number, patch: Partial<FormField>) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const removeField = (idx: number) => {
    if (fields.length <= 1) {
      toast.error("El formulario debe conservar al menos un campo.");
      return;
    }
    const nextFields = fields.filter((_, i) => i !== idx);
    const nextIdx = Math.max(0, idx - 1);
    setFields(nextFields);
    setSelectedIdx(nextIdx);
    setChoicesDraft(nextFields[nextIdx]?.choices.join("\n") ?? "");
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= fields.length) return;
    const copy = [...fields];
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    setFields(copy);
    setSelectedIdx(target);
    setChoicesDraft(copy[target]?.choices.join("\n") ?? "");
  };

  const handleSave = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast.error("Escribe un nombre para el formulario CRF.");
      return;
    }
    if (!resolvedProjectId) {
      toast.error("No se pudo identificar el estudio destino.");
      return;
    }
    const sanitizedFields = fields.map((f) => ({
      ...f,
      choices: f.choices.map((s) => s.trim()).filter(Boolean),
    }));

    setSaving(true);
    try {
      if (isEdit && formId) {
        const updated = await updateForm(
          resolvedProjectId,
          formId,
          { name: name.trim(), description: description.trim(), fields: sanitizedFields },
          user
        );
        toast.success("Diseño del CRF guardado.");
        navigate(`/proyectos/${updated.project_id}`);
      } else {
        const created = await createForm(
          resolvedProjectId,
          {
            name: name.trim(),
            description: description.trim(),
            fields: sanitizedFields,
          },
          user
        );
        toast.success(`Formulario «${created.name}» creado.`);
        navigate(`/proyectos/${created.project_id}`);
      }
    } catch (err) {
      toast.error(errMsg(err, "No se pudo guardar el formulario."));
    } finally {
      setSaving(false);
    }
  };

  const activeField = fields[selectedIdx] ?? null;
  const builderInputClass =
    "w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2 text-sm text-[#1D1D1F] placeholder:text-[#86868B] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:focus:border-[#0A84FF] dark:focus:ring-[#0A84FF]/15";

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              to={resolvedProjectId ? `/proyectos/${resolvedProjectId}` : "/"}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6E6E73] transition-colors hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver al estudio
            </Link>
            <h1 className="mt-1.5 font-heading text-2xl font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
              {isEdit ? "Editar cuaderno clínico CRF" : "Diseñador de formulario clínico CRF"}
            </h1>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            data-testid="save-form-btn"
            className="inline-flex items-center gap-2 rounded-full bg-[#0071E3] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0077ED] disabled:opacity-60 dark:bg-[#0A84FF] dark:hover:bg-[#1E8EFF]"
          >
            <Save className="h-4 w-4" />
            {saving ? "Guardando…" : "Guardar formulario"}
          </button>
        </div>

        {/* Metadata bar */}
        <div className="apple-card grid grid-cols-1 gap-4 rounded-2xl border border-black/[0.06] bg-white p-5 sm:grid-cols-2 dark:border-white/[0.08] dark:bg-[#141416]">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">Título del CRF *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={builderInputClass}
              data-testid="form-title-input"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">Descripción clínica</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Visita basal de inclusión y cribado"
              className={builderInputClass}
            />
          </div>
        </div>

        {/* 3-Column Designer */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Palette & Field Order */}
          <div className="lg:col-span-4 space-y-4">
            <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
              <h3 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                Añadir campo clínico
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {FIELD_TYPES.map((ft) => (
                  <button
                    key={ft.type}
                    type="button"
                    onClick={() => addField(ft.type)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.06] bg-[#F5F5F7]/70 px-3 py-2 text-left text-xs font-medium text-[#1D1D1F] transition-all hover:border-[#0071E3]/40 hover:bg-[#0071E3]/[0.06] dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#E5E5EA] dark:hover:border-[#0A84FF]/50 dark:hover:bg-[#0A84FF]/[0.1]"
                    data-testid={`add-field-${ft.type}`}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-[#0071E3] dark:text-[#0A84FF]" />
                    {ft.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.08] dark:bg-[#141416]">
              <h3 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                Estructura ({fields.length} variables)
              </h3>
              <div className="mt-3 space-y-1.5">
                {fields.map((f, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedIdx(idx)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-xs transition-all",
                      selectedIdx === idx
                        ? "border-[#0071E3]/50 bg-[#0071E3]/[0.06] text-[#1D1D1F] dark:border-[#0A84FF]/60 dark:bg-[#0A84FF]/[0.12] dark:text-white"
                        : "border-black/[0.05] bg-white text-[#424245] hover:bg-[#F5F5F7] dark:border-white/[0.06] dark:bg-[#141416] dark:text-[#D1D1D6] dark:hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{f.label}</div>
                      <div className="font-mono text-[11px] text-[#86868B]">
                        {f.name} · {f.type}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => moveField(idx, -1)}
                        className="rounded-lg p-1 text-[#6E6E73] transition hover:bg-black/[0.06] hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:bg-white/[0.08] dark:hover:text-white"
                        aria-label="Subir"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveField(idx, 1)}
                        className="rounded-lg p-1 text-[#6E6E73] transition hover:bg-black/[0.06] hover:text-[#1D1D1F] dark:text-[#98989D] dark:hover:bg-white/[0.08] dark:hover:text-white"
                        aria-label="Bajar"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeField(idx)}
                        className="rounded-lg p-1 text-rose-500 transition hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        aria-label="Eliminar campo"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Field Property Editor */}
          <div className="lg:col-span-4">
            {activeField && (
              <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 space-y-4 dark:border-white/[0.08] dark:bg-[#141416]">
                <h3 className="font-heading text-sm font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                  Propiedades de variable
                </h3>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">Etiqueta visible</label>
                  <input
                    type="text"
                    value={activeField.label}
                    onChange={(e) =>
                      updateField(selectedIdx, {
                        label: e.target.value,
                        name: slugifyVarName(e.target.value),
                      })
                    }
                    className={builderInputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Nombre de columna (slug)
                  </label>
                  <input
                    type="text"
                    value={activeField.name}
                    onChange={(e) => updateField(selectedIdx, { name: slugifyVarName(e.target.value) })}
                    className={cn(builderInputClass, "font-mono text-xs")}
                  />
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[#1D1D1F] dark:text-[#E5E5EA]">
                  <input
                    type="checkbox"
                    checked={activeField.required}
                    onChange={(e) => updateField(selectedIdx, { required: e.target.checked })}
                    className="h-4 w-4 rounded border-black/20 text-[#0071E3] focus:ring-[#0071E3] dark:border-white/20 dark:text-[#0A84FF]"
                  />
                  Campo obligatorio en captura
                </label>

                {activeField.type === "number" && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">Mínimo</label>
                      <input
                        type="number"
                        value={activeField.min ?? ""}
                        onChange={(e) =>
                          updateField(selectedIdx, { min: e.target.value === "" ? null : Number(e.target.value) })
                        }
                        className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-2.5 py-1.5 font-mono text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">Máximo</label>
                      <input
                        type="number"
                        value={activeField.max ?? ""}
                        onChange={(e) =>
                          updateField(selectedIdx, { max: e.target.value === "" ? null : Number(e.target.value) })
                        }
                        className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-2.5 py-1.5 font-mono text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">Unidad</label>
                      <input
                        type="text"
                        value={activeField.unit}
                        placeholder="mmHg"
                        onChange={(e) => updateField(selectedIdx, { unit: e.target.value })}
                        className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-2.5 py-1.5 font-mono text-xs text-[#1D1D1F] focus:border-[#0071E3] focus:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7]"
                      />
                    </div>
                  </div>
                )}

                {(activeField.type === "select" || activeField.type === "radio" || activeField.type === "checkbox") && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                      Opciones (una por línea · pulsa Enter para añadir filas)
                    </label>
                    <textarea
                      rows={5}
                      value={choicesDraft}
                      data-testid="field-choices-textarea"
                      onChange={(e) => {
                        const raw = e.target.value;
                        setChoicesDraft(raw);
                        updateField(selectedIdx, {
                          choices: raw
                            .split(/\r?\n/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                        });
                      }}
                      placeholder={"Opción 1\nOpción 2\nOpción 3"}
                      className="w-full rounded-xl border border-transparent bg-[#F5F5F7] px-3.5 py-2.5 text-xs leading-relaxed text-[#1D1D1F] focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#F5F5F7] dark:focus:border-[#0A84FF]"
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#424245] dark:text-[#D1D1D6]">
                    Texto de ayuda clínica
                  </label>
                  <input
                    type="text"
                    value={activeField.help}
                    onChange={(e) => updateField(selectedIdx, { help: e.target.value })}
                    placeholder="Instrucción breve para el capturador…"
                    className={cn(builderInputClass, "text-xs")}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Live Preview */}
          <div className="lg:col-span-4">
            <div className="apple-card rounded-2xl border border-black/[0.06] bg-white p-5 space-y-4 dark:border-white/[0.08] dark:bg-[#141416]">
              <div className="border-b border-black/[0.05] pb-3 dark:border-white/[0.06]">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#0071E3] dark:text-[#0A84FF]">
                  Vista previa en vivo
                </div>
                <h3 className="mt-0.5 font-heading text-base font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7]">
                  {name}
                </h3>
              </div>
              <div className="space-y-4">
                {fields.map((f, idx) => (
                  <FieldInput
                    key={idx}
                    field={f}
                    value={previewValues[f.name]}
                    onChange={(val) => setPreviewValues((prev) => ({ ...prev, [f.name]: val }))}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
