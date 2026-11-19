import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type { FormExtractResponse, FormField } from "../src/lib/types.ts";
import { redactSensitiveText } from "./logger.ts";
import { isLikelyIdentifierVariable, redactPii, scanForPii, scanFormMetadataForPii } from "./piiGuard.ts";

const PRIMARY_MODEL = "gemini-4-hydrogen";
const FALLBACK_MODEL = "gemini-3.1-flash-lite";
let preferFallbackUntil = 0;

export class PiiBlockedError extends Error {
  labels: string[];
  constructor(labels: string[], message?: string) {
    super(
      message ||
        `Envío bloqueado por protección de datos (RGPD): se detectaron posibles identificadores personales (${labels.join(", ")}). Elimina cualquier dato identificativo antes de usar la IA externa.`
    );
    this.name = "PiiBlockedError";
    this.labels = labels;
  }
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error("GEMINI_API_KEY_MISSING");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("503") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("high demand") ||
    msg.includes("429") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("MODEL_TIMEOUT")
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MODEL_TIMEOUT:${label}`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function normText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchChoice(raw: unknown, choices: string[]): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const exact = choices.find((c) => c === s);
  if (exact) return exact;
  const ci = choices.find((c) => c.toLowerCase() === s.toLowerCase());
  if (ci) return ci;
  const norm = normText(s);
  const fuzzy = choices.find((c) => normText(c) === norm);
  if (fuzzy) return fuzzy;
  const contains = choices.find((c) => normText(c).includes(norm) || norm.includes(normText(c)));
  return contains ?? null;
}

function isFieldValueEmpty(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "string" && val.trim() === "") return true;
  if (Array.isArray(val) && val.length === 0) return true;
  return false;
}

function buildFieldSchema(fields: FormField[]): Schema {
  const properties: Record<string, Schema> = {};
  for (const f of fields) {
    const descParts = [f.label];
    if (f.unit) descParts.push(`unidad: ${f.unit}`);
    if (f.help) descParts.push(f.help);
    if (f.min !== null || f.max !== null) {
      descParts.push(`rango: ${f.min ?? "-∞"} a ${f.max ?? "+∞"}`);
    }

    if (f.type === "number") {
      properties[f.name] = {
        type: Type.NUMBER,
        nullable: true,
        description: descParts.join(" · "),
      };
    } else if (f.type === "yesno") {
      properties[f.name] = {
        type: Type.INTEGER,
        nullable: true,
        description: `${descParts.join(" · ")} (1 = Sí / presente / positivo, 0 = No / ausente / negativo)`,
      };
    } else if (f.type === "checkbox") {
      properties[f.name] = {
        type: Type.ARRAY,
        nullable: true,
        items: {
          type: Type.STRING,
          ...(f.choices.length ? { enum: f.choices } : {}),
        },
        description: `${descParts.join(" · ")}. Opciones permitidas: ${f.choices.join(", ")}`,
      };
    } else if ((f.type === "select" || f.type === "radio") && f.choices.length > 0) {
      properties[f.name] = {
        type: Type.STRING,
        nullable: true,
        enum: f.choices,
        description: `${descParts.join(" · ")}. Elige exactamente una de: ${f.choices.join(", ")}`,
      };
    } else if (f.type === "date") {
      properties[f.name] = {
        type: Type.STRING,
        nullable: true,
        description: `${descParts.join(" · ")}. Formato estricto YYYY-MM-DD`,
      };
    } else {
      properties[f.name] = {
        type: Type.STRING,
        nullable: true,
        description: descParts.join(" · "),
      };
    }
  }

  return {
    type: Type.OBJECT,
    properties,
  };
}

export async function extractFormFieldsFromText(
  formName: string,
  fields: FormField[],
  freeText: string,
  currentValues: Record<string, unknown>,
  options?: { deidentifiedConfirmed?: boolean }
): Promise<FormExtractResponse> {
  if (!options?.deidentifiedConfirmed) {
    throw new PiiBlockedError(
      ["Confirmación requerida"],
      "Debes confirmar explícitamente que el texto ha sido revisado y no contiene datos identificativos antes de enviarlo a la IA externa."
    );
  }

  const scan = scanForPii(freeText);
  if (scan.hasPii) {
    throw new PiiBlockedError(scan.labels);
  }

  // Filter out any fields that appear to capture direct personal identifiers
  const safeFields = fields.filter((f) => !isLikelyIdentifierVariable(f.name, f.label));
  const skippedIdentifierKeys = fields
    .filter((f) => isLikelyIdentifierVariable(f.name, f.label))
    .map((f) => f.name);

  if (!safeFields.length) {
    throw new PiiBlockedError(
      ["Campos identificativos"],
      "Todos los campos del formulario corresponden a identificadores directos y no pueden procesarse con IA externa."
    );
  }

  const formMetaScan = scanFormMetadataForPii(formName, safeFields);
  if (formMetaScan.hasPii) {
    throw new PiiBlockedError(formMetaScan.labels);
  }

  // Secondary defense-in-depth redaction
  const { redactedText } = redactPii(freeText.slice(0, 15000));

  const ai = getAiClient();
  const schema = buildFieldSchema(safeFields);

  const fieldSpecLines = safeFields.map((f) => {
    const extra: string[] = [];
    if (f.unit) extra.push(`unidad=${f.unit}`);
    if (f.min !== null || f.max !== null) extra.push(`rango=[${f.min ?? ""}, ${f.max ?? ""}]`);
    if (f.choices?.length) extra.push(`opciones=${JSON.stringify(f.choices)}`);
    if (f.type === "yesno") extra.push("valores=1(Sí)/0(No)");
    if (f.type === "date") extra.push("formato=YYYY-MM-DD");
    return `- "${f.name}" (${f.type}): «${f.label}»${extra.length ? ` [${extra.join(", ")}]` : ""}`;
  });

  const prompt = `Eres un asistente clínico especializado en codificación de cuadernos de recogida de datos (CRF) pseudonimizados.
Formulario: «${formName}»

Variables clínicas solicitadas en el formulario:
${fieldSpecLines.join("\n")}

INSTRUCCIONES ESTRICTAS:
1. Extrae ÚNICAMENTE los datos clínicos presentes de forma explícita o inequívoca en el texto proporcionado.
2. Si una variable no aparece en el texto o es ambigua, devuelve null para esa clave. NUNCA inventes ni supongas datos clínicos.
3. NUNCA devuelvas nombres propios, DNI, NHC, teléfonos, correos ni direcciones postales.
4. Para variables \`yesno\`, devuelve 1 si se afirma su presencia/antecedente/positivo y 0 si se niega explícitamente.
5. Para variables \`select\` o \`radio\`, elige EXACTAMENTE una cadena de la lista de opciones permitidas.
6. Para variables \`checkbox\`, devuelve un array con las opciones exactas aplicables.
7. Para \`number\`, devuelve solo el valor numérico ajustado a la unidad solicitada cuando corresponda.
8. Para \`date\`, normaliza a YYYY-MM-DD.

Texto clínico pseudonimizado a analizar:
"""
${redactedText}
"""`;

  const useFallbackFirst = Date.now() < preferFallbackUntil;
  const order = useFallbackFirst ? [FALLBACK_MODEL] : [PRIMARY_MODEL, FALLBACK_MODEL];

  let rawJsonText = "";
  let lastErr: unknown = null;

  for (let i = 0; i < order.length; i++) {
    const model = order[i];
    try {
      const exec = ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.1,
        },
      });
      const resp =
        model === PRIMARY_MODEL && i < order.length - 1 ? await withTimeout(exec, 15000, model) : await exec;
      rawJsonText = resp.text ?? "";
      break;
    } catch (err) {
      lastErr = err;
      if (model === PRIMARY_MODEL && isTransientError(err) && i < order.length - 1) {
        preferFallbackUntil = Date.now() + 120_000;
        continue;
      }
      throw new Error(redactSensitiveText(err instanceof Error ? err.message : String(err)));
    }
  }

  if (!rawJsonText && lastErr) {
    throw new Error(redactSensitiveText(lastErr instanceof Error ? lastErr.message : String(lastErr)));
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawJsonText || "{}") as Record<string, unknown>;
  } catch {
    throw new Error("La IA devolvió una respuesta no estructurada. Inténtalo de nuevo.");
  }

  const appliedValues: Record<string, unknown> = {};
  const preservedExistingKeys: string[] = [];
  const missingKeys: string[] = [];
  const warnings: string[] = [];

  if (skippedIdentifierKeys.length > 0) {
    warnings.push(
      `Se excluyeron ${skippedIdentifierKeys.length} campo(s) identificativo(s) del envío a IA externa por seguridad.`
    );
  }

  for (const field of safeFields) {
    const rawVal = parsed[field.name];
    let normalized: unknown = null;

    if (rawVal !== null && rawVal !== undefined && rawVal !== "") {
      if (field.type === "number") {
        const num = typeof rawVal === "number" ? rawVal : Number(String(rawVal).replace(",", "."));
        if (Number.isFinite(num)) {
          if ((field.min !== null && num < field.min) || (field.max !== null && num > field.max)) {
            warnings.push(
              `«${field.label}» detectado (${num}) está fuera del rango clínico (${field.min ?? "−∞"}–${field.max ?? "+∞"}).`
            );
          } else {
            normalized = Math.round(num * 10000) / 10000;
          }
        }
      } else if (field.type === "yesno") {
        const low = normText(String(rawVal));
        if (rawVal === 1 || rawVal === true || low === "1" || low === "si" || low === "true") {
          normalized = 1;
        } else if (rawVal === 0 || rawVal === false || low === "0" || low === "no" || low === "false") {
          normalized = 0;
        }
      } else if (field.type === "select" || field.type === "radio") {
        normalized = matchChoice(rawVal, field.choices);
      } else if (field.type === "checkbox") {
        const arr = Array.isArray(rawVal) ? rawVal : String(rawVal).split(",");
        const matched = arr
          .map((item) => matchChoice(item, field.choices))
          .filter((item): item is string => Boolean(item));
        const dedup = Array.from(new Set(matched));
        normalized = dedup.length > 0 ? dedup : null;
      } else if (field.type === "date") {
        const s = String(rawVal).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          normalized = s;
        } else {
          const dt = new Date(s);
          if (!Number.isNaN(dt.getTime())) {
            normalized = dt.toISOString().slice(0, 10);
          }
        }
      } else {
        const s = String(rawVal).trim();
        if (s) {
          const valScan = scanForPii(s);
          if (valScan.hasPii) {
            warnings.push(`Se descartó un valor en «${field.label}» por contener posibles identificadores.`);
          } else {
            normalized = s;
          }
        }
      }
    }

    if (normalized === null) {
      missingKeys.push(field.name);
      continue;
    }

    if (!isFieldValueEmpty(currentValues[field.name])) {
      preservedExistingKeys.push(field.name);
      continue;
    }

    appliedValues[field.name] = normalized;
  }

  for (const key of skippedIdentifierKeys) {
    missingKeys.push(key);
  }

  return {
    appliedValues,
    detectedCount: Object.keys(appliedValues).length,
    preservedExistingKeys,
    missingKeys,
    notes: warnings.join(" "),
  };
}
