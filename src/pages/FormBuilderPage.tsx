import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FieldInput } from "../components/forms/FieldInput.tsx";
import { AppShell } from "../components/layout/AppShell.tsx";
import { apiGet, apiPost, apiPut, errMsg } from "../lib/api.ts";
import { Link, useNavigate } from "../lib/router.tsx";
import type { FieldType, Form, FormField } from "../lib/types.ts";
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
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!formId) return;
    apiGet<Form>(`/forms/${formId}`)
      .then((f) => {
        setResolvedProjectId(f.project_id);
        setName(f.name);
        setDescription(f.description);
        setFields(f.fields);
        setSelectedIdx(0);
      })
      .catch((err) => toast.error(errMsg(err, "No se pudo cargar el formulario.")));
  }, [formId]);

  const addField = (type: FieldType) => {
    const next = createEmptyField(type, fields.length);
    setFields((prev) => [...prev, next]);
    setSelectedIdx(fields.length);
  };

  const updateField = (idx: number, patch: Partial<FormField>) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const removeField = (idx: number) => {
    if (fields.length <= 1) {
      toast.error("El formulario debe conservar al menos un campo.");
      return;
    }
    setFields((prev) => prev.filter((_, i) => i !== idx));
    setSelectedIdx(Math.max(0, idx - 1));
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= fields.length) return;
    const copy = [...fields];
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    setFields(copy);
    setSelectedIdx(target);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Escribe un nombre para el formulario CRF.");
      return;
    }
    setSaving(true);
    try {
      if (isEdit && formId) {
        const updated = await apiPut<Form>(`/forms/${formId}`, { name: name.trim(), description: description.trim(), fields });
        toast.success("Diseño del CRF guardado.");
        navigate(`/proyectos/${updated.project_id}`);
      } else {
        const created = await apiPost<Form>(`/projects/${resolvedProjectId}/forms`, {
          name: name.trim(),
          description: description.trim(),
          fields,
        });
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

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              to={resolvedProjectId ? `/proyectos/${resolvedProjectId}` : "/"}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver al estudio
            </Link>
            <h1 className="mt-1 font-heading text-2xl font-bold text-slate-900 dark:text-white">
              {isEdit ? "Editar cuaderno clínico CRF" : "Diseñador de formulario clínico CRF"}
            </h1>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            data-testid="save-form-btn"
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving ? "Guardando…" : "Guardar formulario"}
          </button>
        </div>

        {/* Metadata bar */}
        <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Título del CRF *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              data-testid="form-title-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Descripción clínica</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Visita basal de inclusión y cribado"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>

        {/* 3-Column Designer */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Palette & Field Order */}
          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-heading text-sm font-semibold text-slate-900 dark:text-white">Añadir campo clínico</h3>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {FIELD_TYPES.map((ft) => (
                  <button
                    key={ft.type}
                    type="button"
                    onClick={() => addField(ft.type)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:border-sky-300 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    data-testid={`add-field-${ft.type}`}
                  >
                    <Plus className="h-3.5 w-3.5 text-sky-600" />
                    {ft.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-heading text-sm font-semibold text-slate-900 dark:text-white">
                Estructura ({fields.length} variables)
              </h3>
              <div className="mt-3 space-y-1.5">
                {fields.map((f, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedIdx(idx)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs transition-colors",
                      selectedIdx === idx
                        ? "border-sky-500 bg-sky-50/70 text-sky-900 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-100"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{f.label}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {f.name} · {f.type}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => moveField(idx, -1)}
                        className="rounded p-1 hover:bg-slate-200/70 dark:hover:bg-slate-800"
                        aria-label="Subir"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveField(idx, 1)}
                        className="rounded p-1 hover:bg-slate-200/70 dark:hover:bg-slate-800"
                        aria-label="Bajar"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeField(idx)}
                        className="rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
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
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="font-heading text-sm font-semibold text-slate-900 dark:text-white">
                  Propiedades de variable
                </h3>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Etiqueta visible</label>
                  <input
                    type="text"
                    value={activeField.label}
                    onChange={(e) =>
                      updateField(selectedIdx, {
                        label: e.target.value,
                        name: slugifyVarName(e.target.value),
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Nombre de columna (slug)
                  </label>
                  <input
                    type="text"
                    value={activeField.name}
                    onChange={(e) => updateField(selectedIdx, { name: slugifyVarName(e.target.value) })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={activeField.required}
                    onChange={(e) => updateField(selectedIdx, { required: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600"
                  />
                  Campo obligatorio en captura
                </label>

                {activeField.type === "number" && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Mínimo</label>
                      <input
                        type="number"
                        value={activeField.min ?? ""}
                        onChange={(e) =>
                          updateField(selectedIdx, { min: e.target.value === "" ? null : Number(e.target.value) })
                        }
                        className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Máximo</label>
                      <input
                        type="number"
                        value={activeField.max ?? ""}
                        onChange={(e) =>
                          updateField(selectedIdx, { max: e.target.value === "" ? null : Number(e.target.value) })
                        }
                        className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Unidad</label>
                      <input
                        type="text"
                        value={activeField.unit}
                        placeholder="mmHg"
                        onChange={(e) => updateField(selectedIdx, { unit: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  </div>
                )}

                {(activeField.type === "select" || activeField.type === "radio" || activeField.type === "checkbox") && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                      Opciones (una por línea)
                    </label>
                    <textarea
                      rows={4}
                      value={activeField.choices.join("\n")}
                      onChange={(e) =>
                        updateField(selectedIdx, {
                          choices: e.target.value
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Texto de ayuda clínica
                  </label>
                  <input
                    type="text"
                    value={activeField.help}
                    onChange={(e) => updateField(selectedIdx, { help: e.target.value })}
                    placeholder="Instrucción breve para el capturador…"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Live Preview */}
          <div className="lg:col-span-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                  Vista previa en vivo
                </div>
                <h3 className="mt-0.5 font-heading text-base font-semibold text-slate-900 dark:text-white">{name}</h3>
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
