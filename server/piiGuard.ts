import type { Cell, Dataset, FormField, Variable } from "../src/lib/types.ts";

export type PiiCategory =
  | "dni_nie"
  | "pasaporte"
  | "nhc_historia"
  | "email"
  | "telefono"
  | "iban_nss"
  | "fecha_nacimiento"
  | "direccion_postal"
  | "nombre_propio";

export interface PiiFinding {
  category: PiiCategory;
  label: string;
  severity: "high" | "medium";
  start: number;
  end: number;
}

export interface PiiScanResult {
  hasPii: boolean;
  highRiskCount: number;
  mediumRiskCount: number;
  categories: PiiCategory[];
  labels: string[];
  findings: PiiFinding[];
}

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

function isValidSpanishDni(raw: string): boolean {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^\d{8}[A-Z]$/.test(clean)) return false;
  const num = Number(clean.slice(0, 8));
  return DNI_LETTERS[num % 23] === clean[8];
}

function isValidSpanishNie(raw: string): boolean {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[XYZ]\d{7}[A-Z]$/.test(clean)) return false;
  const prefix = clean[0] === "X" ? "0" : clean[0] === "Y" ? "1" : "2";
  const num = Number(prefix + clean.slice(1, 8));
  return DNI_LETTERS[num % 23] === clean[8];
}

const CATEGORY_LABEL: Record<PiiCategory, string> = {
  dni_nie: "DNI / NIE / NIF",
  pasaporte: "Pasaporte / Documento oficial",
  nhc_historia: "NHC / Historia clínica / Tarjeta sanitaria",
  email: "Correo electrónico",
  telefono: "Teléfono",
  iban_nss: "IBAN / Seguridad Social",
  fecha_nacimiento: "Fecha de nacimiento explícita",
  direccion_postal: "Dirección postal",
  nombre_propio: "Posible nombre y apellidos",
};

// Common clinical/institutional terms that can appear capitalized without being patient names
const NON_NAME_CLINICAL_TERMS = new Set([
  "paciente",
  "varon",
  "varón",
  "mujer",
  "hombre",
  "edad",
  "sexo",
  "antecedentes",
  "personales",
  "familiares",
  "tratamiento",
  "habitual",
  "alergias",
  "medicamentosas",
  "diagnostico",
  "diagnóstico",
  "principal",
  "motivo",
  "consulta",
  "ingreso",
  "alta",
  "evolucion",
  "evolución",
  "clinica",
  "clínica",
  "exploracion",
  "exploración",
  "fisica",
  "física",
  "analitica",
  "analítica",
  "pruebas",
  "complementarias",
  "hipertension",
  "hipertensión",
  "arterial",
  "diabetes",
  "mellitus",
  "insuficiencia",
  "cardiaca",
  "cardíaca",
  "renal",
  "cronica",
  "crónica",
  "aguda",
  "agudo",
  "hospital",
  "universitario",
  "general",
  "servicio",
  "unidad",
  "centro",
  "salud",
  "cardiologia",
  "cardiología",
  "medicina",
  "interna",
  "urgencias",
  "atencion",
  "atención",
  "primaria",
  "frecuencia",
  "presion",
  "presión",
  "sistolica",
  "sistólica",
  "diastolica",
  "diastólica",
  "tension",
  "tensión",
  "creatinina",
  "hemoglobina",
  "glucosa",
  "colesterol",
  "saturacion",
  "saturación",
  "oxigeno",
  "oxígeno",
  "sin",
  "con",
  "niega",
  "refiere",
  "presenta",
  "fumador",
  "activo",
  "exfumador",
  "grupo",
  "control",
  "placebo",
  "ensayo",
  "estudio",
  "clinico",
  "clínico",
  "cohorte",
  "sintetica",
  "sintética",
  "sintetico",
  "sintético",
  "farmaco",
  "fármaco",
  "enfermedad",
  "sindrome",
  "síndrome",
  "infarto",
  "miocardio",
  "angina",
  "pecho",
  "fibrilacion",
  "fibrilación",
  "auricular",
  "tipo",
  "grado",
  "estadio",
  "clase",
  "funcional",
  "nueva",
  "york",
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "setiembre",
  "octubre",
  "noviembre",
  "diciembre",
  "datos",
  "clinicos",
  "clínicos",
  "basales",
  "seguimiento",
  "mortalidad",
  "supervivencia",
  "tabla",
  "modelo",
  "riesgo",
  "cardiovascular",
  "hospitalizacion",
  "hospitalización",
  "diabetes",
  "prueba",
]);

function pushMatch(
  findings: PiiFinding[],
  category: PiiCategory,
  severity: "high" | "medium",
  start: number,
  end: number
) {
  findings.push({
    category,
    label: CATEGORY_LABEL[category],
    severity,
    start,
    end,
  });
}

function collectRegex(
  text: string,
  regex: RegExp,
  category: PiiCategory,
  severity: "high" | "medium",
  findings: PiiFinding[],
  predicate?: (matchText: string) => boolean
) {
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!predicate || predicate(m[0])) {
      pushMatch(findings, category, severity, m.index, m.index + m[0].length);
    }
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
}

function areCapitalizedNameWords(words: string[]): boolean {
  const cleanWords = words
    .map((w) => w.trim())
    .filter((w) => w && !["de", "del", "la", "las", "los", "y"].includes(w.toLowerCase()));
  if (cleanWords.length < 2) return false;
  return !cleanWords.some((w) => NON_NAME_CLINICAL_TERMS.has(w.toLowerCase()));
}

export function scanForPii(text: string): PiiScanResult {
  const findings: PiiFinding[] = [];
  if (!text || !text.trim()) {
    return {
      hasPii: false,
      highRiskCount: 0,
      mediumRiskCount: 0,
      categories: [],
      labels: [],
      findings: [],
    };
  }

  // 1. Validated Spanish DNI/NIF & NIE, plus explicit DNI/NIF labels
  collectRegex(text, /\b\d{2}[\s.]?\d{3}[\s.]?\d{3}[-\s]?[TRWAGMYFPDXBNJZSQVHLCKE]\b/gi, "dni_nie", "high", findings, isValidSpanishDni);
  collectRegex(text, /\b[XYZ]\d{7}[-\s]?[TRWAGMYFPDXBNJZSQVHLCKE]\b/gi, "dni_nie", "high", findings, isValidSpanishNie);
  collectRegex(text, /\b(?:dni|nif|nie)\s*[:#-]?\s*[A-Z0-9-]{6,14}\b/gi, "dni_nie", "high", findings);

  // 2. Passport
  collectRegex(text, /\bpasaporte\s*[:#-]?\s*[A-Z0-9]{5,14}\b/gi, "pasaporte", "high", findings);

  // 3. NHC / HC / H.C. / Historia clínica / CIP / SIP / Tarjeta sanitaria
  collectRegex(
    text,
    /\b(?:n\.?\s*h\.?\s*c\.?|h\.?\s*c\.?|hc|historia\s+cl[ií]nica|n[uú]mero\s+de\s+historia|c\.?\s*i\.?\s*p\.?|s\.?\s*i\.?\s*p\.?|tarjeta\s+sanitaria|tis)\s*[:#º°-]?\s*[A-Z0-9][A-Z0-9/-]{3,20}\b/gi,
    "nhc_historia",
    "high",
    findings
  );

  // 4. Email
  collectRegex(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "email", "high", findings);

  // 5. Phones (Spanish mobile/landline including 2-digit area codes like 91 555 44 33 & E.164 international)
  collectRegex(
    text,
    /(?:\+34[\s.-]?)?\b(?:[67]\d{2}[\s.-]?\d{2,3}[\s.-]?\d{2,3}(?:[\s.-]?\d{2})?|[89]\d(?:[\s.-]?\d{2,3}){2,3})\b/g,
    "telefono",
    "high",
    findings,
    (s) => {
      const digits = s.replace(/\D/g, "");
      return digits.length >= 9 && digits.length <= 12;
    }
  );
  collectRegex(text, /\b(?:tel(?:[eé]fono)?|tfno|m[oó]vil|contacto)\s*[:#-]?\s*\+?\d[\d\s.-]{7,15}\d\b/gi, "telefono", "high", findings);

  // 6. IBAN / Seguridad Social (NASS)
  collectRegex(text, /\b[A-Z]{2}\d{2}(?:[\s-]?\d{4}){4,6}\b/g, "iban_nss", "high", findings);
  collectRegex(text, /\b(?:nss|nass|seguridad\s+social)\s*[:#-]?\s*\d{2}[\s/-]?\d{7,10}[\s/-]?\d{2}\b/gi, "iban_nss", "high", findings);

  // 7. Explicit Date of Birth (slash, dash, dot, or spelled-out Spanish month)
  collectRegex(
    text,
    /\b(?:fecha\s+de\s+nacimiento|f\.?\s*nacimiento|f\.?\s*n\.?|nacido(?:\/a)?\s+el|nacida\s+el)\s*[:#-]?\s*(?:\d{1,4}[./-]\d{1,2}[./-]\d{1,4}|\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+de\s+\d{4})\b/gi,
    "fecha_nacimiento",
    "high",
    findings
  );

  // 8. Postal address (with postal code OR street number/floor)
  collectRegex(
    text,
    /\b(?:domicilio|direcci[oó]n|calle|c\/|avda\.?|avenida|paseo|plaza|c\.?\s*p\.?)\s+[^\n,;]{3,60}\b(?:n[º°]?|cp|\d{5})\b/gi,
    "direccion_postal",
    "high",
    findings
  );
  collectRegex(
    text,
    /\b(?:domicilio|direcci[oó]n|calle|c\/|avda\.?|avenida|paseo|plaza)\s+[A-ZÁÉÍÓÚÜÑa-záéíóúüñ][^\n,;]{2,48}\s+\d{1,4}\b/gi,
    "direccion_postal",
    "high",
    findings
  );

  // 9a. Explicit Name headers or honorifics + multi-word capitalized names
  collectRegex(
    text,
    /\b(?:[Nn]ombre(?:\s+y\s+[Aa]pellidos)?|NOMBRE(?:\s+Y\s+APELLIDOS)?|[Aa]pellidos|APELLIDOS|[Pp]aciente|PACIENTE)\s*:\s*[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{1,24}(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{1,24}){1,3}\b/g,
    "nombre_propio",
    "high",
    findings,
    (m) => {
      const val = m.split(":").slice(1).join(":").trim();
      return areCapitalizedNameWords(val.split(/\s+/));
    }
  );
  collectRegex(
    text,
    /\b(?:D\.?|Dña\.?|Sr\.?|Sra\.?|Don|Doña)\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{1,24}(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{1,24}){1,2}\b/g,
    "nombre_propio",
    "high",
    findings,
    (m) => areCapitalizedNameWords(m.split(/\s+/).slice(1))
  );

  // 9b. Conservative unlabeled proper-name heuristics (clinical subject context & 3-word Title-Case full names)
  collectRegex(
    text,
    /\b(?:[Pp]aciente|[Aa]cude|[Rr]emitid[oa]\s+por|[Ff]irmado\s+por|[Aa]tendid[oa]\s+por)\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,24}(?:\s+(?:de(?:\s+la)?|del)\s+|\s+)[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,24}(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,24})?\b/g,
    "nombre_propio",
    "medium",
    findings,
    (m) => {
      const parts = m.split(/\s+/);
      const skip = parts[0].toLowerCase() === "remitido" || parts[0].toLowerCase() === "remitida" || parts[0].toLowerCase() === "firmado" || parts[0].toLowerCase() === "atendido" || parts[0].toLowerCase() === "atendida" ? 2 : 1;
      return areCapitalizedNameWords(parts.slice(skip));
    }
  );
  collectRegex(
    text,
    /\b[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,24}\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,24}\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,24}\b/g,
    "nombre_propio",
    "medium",
    findings,
    (m) => areCapitalizedNameWords(m.split(/\s+/))
  );

  const highRiskCount = findings.filter((f) => f.severity === "high").length;
  const mediumRiskCount = findings.filter((f) => f.severity === "medium").length;
  const categories = Array.from(new Set(findings.map((f) => f.category)));
  const labels = categories.map((c) => CATEGORY_LABEL[c]);

  return {
    hasPii: findings.length > 0,
    highRiskCount,
    mediumRiskCount,
    categories,
    labels,
    findings,
  };
}

export function redactPii(text: string): { redactedText: string; scan: PiiScanResult } {
  const scan = scanForPii(text);
  if (!scan.findings.length) {
    return { redactedText: text, scan };
  }
  const sorted = [...scan.findings].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: PiiFinding[] = [];
  for (const f of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev || f.start >= prev.end) {
      merged.push({ ...f });
    } else if (f.end > prev.end) {
      prev.end = f.end;
    }
  }

  let cursor = 0;
  let out = "";
  for (const f of merged) {
    out += text.slice(cursor, f.start);
    out += `[REDACTADO:${f.category.toUpperCase()}]`;
    cursor = f.end;
  }
  out += text.slice(cursor);
  return { redactedText: out, scan };
}

const IDENTIFIER_VAR_NAME_RE =
  /(^|_)(nombre|apellido|apellidos|fullname|dni|nif|nie|pasaporte|passport|nhc|historia|historia_clinica|sip|cip|tis|nss|nass|iban|telefono|tfno|movil|celular|phone|email|correo|mail|direccion|domicilio|calle|postal|nacimiento|birth|dob|ssn)($|_)/i;

export function isLikelyIdentifierVariable(name: string, label?: string): boolean {
  const n = (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (IDENTIFIER_VAR_NAME_RE.test(n)) return true;
  if (label) {
    const l = label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_");
    if (IDENTIFIER_VAR_NAME_RE.test(l)) return true;
  }
  return false;
}

export function scanDatasetMetadataForPii(dataset: Dataset): PiiScanResult {
  const snippets: string[] = [dataset.name];
  for (const v of dataset.variables as Variable[]) {
    if (isLikelyIdentifierVariable(v.name, v.label)) continue;
    snippets.push(v.name);
    if (v.label) snippets.push(v.label);
    if (Array.isArray(v.levels)) {
      for (const lv of v.levels.slice(0, 50)) {
        snippets.push(String(lv));
      }
    }
  }
  return scanForPii(snippets.join(" · "));
}

export function scanFormMetadataForPii(formName: string, fields: FormField[]): PiiScanResult {
  const snippets: string[] = [formName];
  for (const f of fields) {
    if (isLikelyIdentifierVariable(f.name, f.label)) continue;
    snippets.push(f.name, f.label);
    if (f.help) snippets.push(f.help);
    if (Array.isArray(f.choices)) {
      for (const ch of f.choices.slice(0, 50)) {
        snippets.push(String(ch));
      }
    }
  }
  return scanForPii(snippets.join(" · "));
}

export function sanitizeCsvCell(val: Cell): Cell {
  if (val === null || val === undefined) return "";
  if (typeof val !== "string") return val;
  if (/^[\t\r ]*[=+\-@]/.test(val) || val.startsWith("\t") || val.startsWith("\r")) {
    return `'${val}`;
  }
  return val;
}
