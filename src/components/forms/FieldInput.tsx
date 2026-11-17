import type { FormField } from "../../lib/types.ts";
import { cn } from "../../lib/utils.ts";

interface FieldInputProps {
  field: FormField;
  value: unknown;
  onChange: (val: unknown) => void;
  disabled?: boolean;
}

export function FieldInput({ field, value, onChange, disabled }: FieldInputProps) {
  const baseInputClass =
    "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800";

  const selectedChecks: string[] = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string" && value
      ? value.split(",").map((s) => s.trim())
      : [];

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium text-slate-800 dark:text-slate-200">
          {field.label}
          {field.required && <span className="ml-1 text-rose-600 dark:text-rose-400">*</span>}
        </label>
        {field.unit && <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{field.unit}</span>}
      </div>

      {field.type === "text" && (
        <input
          type="text"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={baseInputClass}
          data-testid={`field-${field.name}`}
        />
      )}

      {field.type === "textarea" && (
        <textarea
          rows={3}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={baseInputClass}
          data-testid={`field-${field.name}`}
        />
      )}

      {field.type === "number" && (
        <div className="relative">
          <input
            type="number"
            step="any"
            min={field.min ?? undefined}
            max={field.max ?? undefined}
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? "" : e.target.value)}
            disabled={disabled}
            className={cn(baseInputClass, "font-mono tabular-nums", field.unit && "pr-16")}
            data-testid={`field-${field.name}`}
          />
          {field.unit && (
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-400">
              {field.unit}
            </span>
          )}
        </div>
      )}

      {field.type === "date" && (
        <input
          type="date"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(baseInputClass, "font-mono")}
          data-testid={`field-${field.name}`}
        />
      )}

      {field.type === "select" && (
        <select
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={baseInputClass}
          data-testid={`field-${field.name}`}
        >
          <option value="">Selecciona una opción…</option>
          {field.choices.map((ch) => (
            <option key={ch} value={ch}>
              {ch}
            </option>
          ))}
        </select>
      )}

      {field.type === "radio" && (
        <div className="flex flex-wrap gap-2 pt-0.5" data-testid={`field-${field.name}`}>
          {field.choices.map((ch) => {
            const active = String(value ?? "") === ch;
            return (
              <button
                key={ch}
                type="button"
                disabled={disabled}
                onClick={() => onChange(ch)}
                className={cn(
                  "rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-sky-600 bg-sky-50 text-sky-800 dark:border-sky-400 dark:bg-sky-950/60 dark:text-sky-200"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                )}
              >
                {ch}
              </button>
            );
          })}
        </div>
      )}

      {field.type === "yesno" && (
        <div className="flex gap-2 pt-0.5" data-testid={`field-${field.name}`}>
          {[
            { label: "Sí (1)", val: 1 },
            { label: "No (0)", val: 0 },
          ].map((opt) => {
            const active = value === opt.val || String(value) === String(opt.val);
            return (
              <button
                key={opt.val}
                type="button"
                disabled={disabled}
                onClick={() => onChange(opt.val)}
                className={cn(
                  "rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-sky-600 bg-sky-50 text-sky-800 dark:border-sky-400 dark:bg-sky-950/60 dark:text-sky-200"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {field.type === "checkbox" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-0.5" data-testid={`field-${field.name}`}>
          {field.choices.map((ch) => {
            const checked = selectedChecks.includes(ch);
            return (
              <label
                key={ch}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2 text-sm transition-colors",
                  checked
                    ? "border-sky-500 bg-sky-50/70 text-sky-900 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-200"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => {
                    const next = checked ? selectedChecks.filter((s) => s !== ch) : [...selectedChecks, ch];
                    onChange(next);
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>{ch}</span>
              </label>
            );
          })}
        </div>
      )}

      {(field.help || (field.type === "number" && (field.min !== null || field.max !== null))) && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {field.help ||
            `Rango clínico válido: ${field.min !== null ? field.min : "−∞"} a ${field.max !== null ? field.max : "+∞"}${field.unit ? ` ${field.unit}` : ""}`}
        </p>
      )}
    </div>
  );
}
