const BEARER_RE = /Bearer\s+[A-Za-z0-9\-_.]+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const DNI_RE = /\b\d{8}[-\s]?[TRWAGMYFPDXBNJZSQVHLCKE]\b/gi;
const NIE_RE = /\b[XYZ]\d{7}[-\s]?[TRWAGMYFPDXBNJZSQVHLCKE]\b/gi;
const PHONE_RE = /(?:\+34[\s.-]?)?\b[6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g;

export function redactSensitiveText(input: string): string {
  const apiKey = process.env.GEMINI_API_KEY;
  let out = input
    .replace(BEARER_RE, "Bearer [TOKEN_REDACTADO]")
    .replace(EMAIL_RE, "[EMAIL_REDACTADO]")
    .replace(DNI_RE, "[DNI_REDACTADO]")
    .replace(NIE_RE, "[NIE_REDACTADO]")
    .replace(PHONE_RE, "[TEL_REDACTADO]");
  if (apiKey && apiKey.length > 8 && apiKey !== "MY_GEMINI_API_KEY") {
    out = out.split(apiKey).join("[API_KEY_REDACTADA]");
  }
  return out;
}

export function logSecurityEvent(
  level: "info" | "warn" | "error",
  event: string,
  meta?: Record<string, string | number | boolean | null | undefined>
): void {
  const safeMeta: Record<string, string | number | boolean | null> = {};
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v === undefined) continue;
      safeMeta[k] = typeof v === "string" ? redactSensitiveText(v).slice(0, 240) : v;
    }
  }
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...safeMeta,
  });
  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.info(entry);
  }
}
