import type { FormField } from "../../lib/types.ts";
import { cn } from "../../lib/utils.ts";

interface FieldInputProps {
  field: FormField;
  value: unknown;
  onChange: (val: unknown) => void;
  disabled?: boolean;
  aiFilled?: boolean;
}

export function FieldInput({ field, value, onChange, disabled, aiFilled }: FieldInputProps) {
  const baseInputClass = cn(
    "w-full rounded-xl border px-3.5 py-2.5 text-sm text-[#1D1D1F] placeholder:text-[#86868B] transition focus:border-[#0071E3] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0071E3]/10 disabled:opacity-60 dark:text-[#F5F5F7] dark:placeholder:text-[#6E6E73] dark:focus:border-[#0A84FF] dark:focus:bg-[#1C1C1E] dark:focus:ring-[#0A84FF]/15",
    aiFilled
      ? "border-[#0071E3]/60 bg-white ring-2 ring-[#0071E3]/10 dark:border-[#0A84FF]/60 dark:bg-[#1C1C1E]"
      : "border-transparent bg-[#F5F5F7] dark:border-white/[0.08] dark:bg-[#1C1C1E]"
  );

  const selectedChecks: string[] = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string" && value
      ? value.split(",").map((s) => s.trim())
      : [];

  return (
    <div
      className={cn(
        "space-y-1.5 rounded-2xl transition-colors",
        aiFilled && "bg-[#0071E3]/[0.04] p-3.5 dark:bg-[#0A84FF]/[0.08]"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
            {field.label}
            {field.required && <span className="ml-1 text-rose-600 dark:text-rose-400">*</span>}
          </label>
          {aiFilled && (
            <span className="text-[11px] font-medium text-[#0071E3] dark:text-[#0A84FF]">
              · Autocompletado · Revisar
            </span>
          )}
        </div>
        {field.unit && <span className="font-mono text-xs text-[#6E6E73] dark:text-[#98989D]">{field.unit}</span>}
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
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-xs text-[#86868B]">
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
                  "rounded-full border px-4 py-2 text-sm font-medium transition-all",
                  active
                    ? "border-[#0071E3] bg-[#0071E3]/[0.08] text-[#0071E3] dark:border-[#0A84FF] dark:bg-[#0A84FF]/[0.15] dark:text-[#0A84FF]"
                    : "border-black/[0.08] bg-[#F5F5F7] text-[#1D1D1F] hover:bg-black/[0.06] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#E5E5EA] dark:hover:bg-white/[0.08]"
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
                  "rounded-full border px-4 py-2 text-sm font-medium transition-all",
                  active
                    ? "border-[#0071E3] bg-[#0071E3]/[0.08] text-[#0071E3] dark:border-[#0A84FF] dark:bg-[#0A84FF]/[0.15] dark:text-[#0A84FF]"
                    : "border-black/[0.08] bg-[#F5F5F7] text-[#1D1D1F] hover:bg-black/[0.06] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-[#E5E5EA] dark:hover:bg-white/[0.08]"
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
                  "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm transition-all",
                  checked
                    ? "border-[#0071E3]/50 bg-[#0071E3]/[0.06] text-[#1D1D1F] dark:border-[#0A84FF]/60 dark:bg-[#0A84FF]/[0.12] dark:text-white"
                    : "border-transparent bg-[#F5F5F7] text-[#424245] hover:bg-black/[0.05] dark:border-white/[0.08] dark:bg-[#1C1C1E] dark:text-[#D1D1D6]"
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
                  className="h-4 w-4 rounded border-black/20 text-[#0071E3] focus:ring-[#0071E3] dark:border-white/20 dark:text-[#0A84FF]"
                />
                <span>{ch}</span>
              </label>
            );
          })}
        </div>
      )}

      {(field.help || (field.type === "number" && (field.min !== null || field.max !== null))) && (
        <p className="text-xs text-[#6E6E73] dark:text-[#98989D]">
          {field.help ||
            `Rango clínico válido: ${field.min !== null ? field.min : "−∞"} a ${field.max !== null ? field.max : "+∞"}${field.unit ? ` ${field.unit}` : ""}`}
        </p>
      )}
    </div>
  );
}
