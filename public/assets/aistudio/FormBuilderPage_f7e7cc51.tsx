import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, Calendar, CheckSquare, ChevronLeft, CircleDot, Hash, List, ToggleLeft, Trash2, Type, AlignLeft, Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldInput, type FieldValue } from "@/components/forms/FieldInput";
import { apiGet, apiPost, apiPut, errMsg } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import type { FieldType, Form, FormField } from "@/lib/types";
import { cn } from "@/lib/utils";

const PALETTE: { type: FieldType; label: string; icon: typeof Type }[] = [
  { type: "text", label: "Texto", icon: Type },
  { type: "number", label: "Numérico", icon: Hash },
  { type: "date", label: "Fecha", icon: Calendar },
  { type: "select", label: "Desplegable", icon: List },
  { type: "radio", label: "Opción única", icon: CircleDot },
  { type: "checkbox", label: "Casillas", icon: CheckSquare },
  { type: "yesno", label: "Sí / No", icon: ToggleLeft },
  { type: "textarea", label: "Texto largo", icon: AlignLeft },
];
const NEEDS_CHOICES: FieldType[] = ["select", "radio", "checkbox"];

function slug(s: string): string {
  const base = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z]/.test(base) ? base : `v_${base || "campo"}`;
}

function newField(type: FieldType, existing: FormField[]): FormField {
  let i = existing.length + 1;
  while (existing.some((f) => f.name === `campo_${i}`)) i++;
  return {
    name: `campo_${i}`, label: `Nuevo campo ${i}`, type, required: false,
    choices: NEEDS_CHOICES.includes(type) ? ["Opción 1", "Opción 2"] : [], min: null, max: null, unit: "", help: "",
  };
}

export default function FormBuilderPage() {
  const { formId, projectId } = useParams();
  const navigate = useNavigate();
  const existing = useQuery({ queryKey: ["form", formId], queryFn: () => apiGet<Form>(`/forms/${formId}`), enabled: !!formId });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [sel, setSel] = useState(0);
  const [preview, setPreview] = useState<Record<string, FieldValue>>({});
  const pid = projectId ?? existing.data?.project_id;

  useEffect(() => {
    if (existing.data) {
      setName(existing.data.name);
      setDescription(existing.data.description);
      setFields(existing.data.fields);
    }
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, fields };
      return formId ? apiPut<Form>(`/forms/${formId}`, body) : apiPost<Form>(`/projects/${pid}/forms`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forms", pid] });
      queryClient.invalidateQueries({ queryKey: ["datasets", pid] });
      queryClient.invalidateQueries({ queryKey: ["form", formId] });
      toast.success("Formulario guardado");
      navigate(`/proyectos/${pid}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const update = (i: number, patch: Partial<FormField>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
    setSel(j);
  };
  const f = fields[sel];

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to={pid ? `/proyectos/${pid}` : "/"} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900" data-testid="builder-back-link">
          <ChevronLeft className="size-4" /> Volver al proyecto
        </Link>
        <Button onClick={() => save.mutate()} disabled={!name.trim() || !fields.length || save.isPending} className="rounded-full px-5" data-testid="builder-save-button">
          <Save className="size-4" /> {save.isPending ? "Guardando…" : "Guardar formulario"}
        </Button>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-12">
        <aside className="space-y-4 lg:col-span-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Añadir campo</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {PALETTE.map((p) => (
                <button key={p.type} type="button" data-testid={`palette-${p.type}`}
                  onClick={() => { const nf = newField(p.type, fields); setFields([...fields, nf]); setSel(fields.length); }}
                  className="flex flex-col items-start gap-1.5 rounded-xl border border-slate-200 p-3 text-left text-xs font-medium text-slate-700 transition-[border-color,background-color,transform] duration-150 hover:-translate-y-px hover:border-sky-300 hover:bg-sky-50/50">
                  <p.icon className="size-4 text-sky-600" />{p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-2" data-testid="builder-field-list">
            {fields.map((x, i) => (
              <div key={i} className={cn("group flex items-center gap-1 rounded-xl px-2 py-1.5", sel === i ? "bg-sky-50" : "hover:bg-slate-50")}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSel(i)} data-testid={`builder-field-${i}`}>
                  <p className="truncate text-sm font-medium">{x.label}</p>
                  <p className="truncate font-mono text-[11px] text-slate-400">{x.name} · {x.type}</p>
                </button>
                <Button size="icon-xs" variant="ghost" onClick={() => move(i, -1)} aria-label="Subir"><ArrowUp className="size-3" /></Button>
                <Button size="icon-xs" variant="ghost" onClick={() => move(i, 1)} aria-label="Bajar"><ArrowDown className="size-3" /></Button>
                <Button size="icon-xs" variant="ghost" className="text-rose-500" aria-label="Eliminar campo" data-testid={`builder-field-delete-${i}`}
                  onClick={() => { setFields(fields.filter((_, j) => j !== i)); setSel(Math.max(0, i - 1)); }}><Trash2 className="size-3" /></Button>
              </div>
            ))}
            {!fields.length && <p className="p-4 text-center text-xs text-slate-400">Añade campos desde la paleta</p>}
          </div>
        </aside>

        <section className="space-y-4 lg:col-span-4">
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="space-y-1.5">
              <Label>Nombre del formulario</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. CRF Visita basal" data-testid="builder-name-input" />
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} data-testid="builder-description-input" />
            </div>
          </div>
          {f && (
            <div className="space-y-4 rounded-2xl border border-sky-200 bg-white p-5 shadow-sm" data-testid="field-editor">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">Propiedades del campo</p>
              <div className="space-y-1.5">
                <Label>Etiqueta</Label>
                <Input value={f.label} data-testid="field-label-input"
                  onChange={(e) => update(sel, { label: e.target.value, ...(f.name.startsWith("campo_") || f.name === slug(f.label) ? { name: slug(e.target.value) } : {}) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Nombre de variable</Label>
                <Input value={f.name} onChange={(e) => update(sel, { name: slug(e.target.value) })} className="font-mono" data-testid="field-name-input" />
              </div>
              {NEEDS_CHOICES.includes(f.type) && (
                <div className="space-y-1.5">
                  <Label>Opciones (una por línea)</Label>
                  <Textarea value={f.choices.join("\n")} rows={4} data-testid="field-choices-input"
                    onChange={(e) => update(sel, { choices: e.target.value.split("\n") })}
                    onBlur={() => update(sel, { choices: f.choices.map((c) => c.trim()).filter(Boolean) })} />
                </div>
              )}
              {f.type === "number" && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1.5"><Label>Mín</Label><Input type="number" value={f.min ?? ""} onChange={(e) => update(sel, { min: e.target.value === "" ? null : Number(e.target.value) })} data-testid="field-min-input" /></div>
                  <div className="space-y-1.5"><Label>Máx</Label><Input type="number" value={f.max ?? ""} onChange={(e) => update(sel, { max: e.target.value === "" ? null : Number(e.target.value) })} data-testid="field-max-input" /></div>
                  <div className="space-y-1.5"><Label>Unidad</Label><Input value={f.unit} onChange={(e) => update(sel, { unit: e.target.value })} placeholder="mmHg" data-testid="field-unit-input" /></div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Ayuda</Label>
                <Input value={f.help} onChange={(e) => update(sel, { help: e.target.value })} placeholder="Texto de ayuda opcional" data-testid="field-help-input" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={f.required} onCheckedChange={(v: boolean) => update(sel, { required: v })} data-testid="field-required-checkbox" /> Obligatorio
              </label>
            </div>
          )}
        </section>

        <section className="lg:col-span-5">
          <div className="sticky top-20 rounded-3xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-6" data-testid="builder-preview">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Vista previa</p>
            <h2 className="mt-2 text-2xl font-semibold">{name || "Formulario sin nombre"}</h2>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
            <div className="mt-6 space-y-5">
              {fields.map((x, i) => (
                <div key={i} className={cn("space-y-2 rounded-2xl p-3 transition-colors duration-150", sel === i && "bg-sky-50/60 ring-1 ring-sky-200")} onClick={() => setSel(i)}>
                  <Label className="text-sm">{x.label}{x.required && <span className="text-rose-500"> *</span>}</Label>
                  <FieldInput f={x} value={preview[x.name] ?? null} onChange={(v) => setPreview({ ...preview, [x.name]: v })} />
                  {x.help && <p className="text-xs text-slate-400">{x.help}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
