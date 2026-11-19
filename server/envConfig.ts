import crypto from "node:crypto";

export type AppEnvironment = "development" | "testing" | "staging" | "production";

export interface RuntimeSecurityConfig {
  appEnv: AppEnvironment;
  isProduction: boolean;
  isTesting: boolean;
  allowedOrigins: string[];
  hasExplicitAuditSecret: boolean;
  auditHmacSecret: string;
  auditHmacKeyId: string;
  auditHmacPreviousSecrets: Record<string, string>;
  hasExplicitVaultSecret: boolean;
  vaultEncryptionSecret: string;
  vaultKeyId: string;
  vaultPreviousSecrets: Record<string, string>;
  appCheckEnforced: boolean;
  wormAuditStreamEnabled: boolean;
}

const EPHEMERAL_DEV_AUDIT_SECRET = crypto.randomBytes(32).toString("hex");
const EPHEMERAL_DEV_VAULT_SECRET = crypto.randomBytes(32).toString("hex");

function parseSecretKeyring(raw: string | undefined, defaultPrefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || !raw.trim()) return out;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  parts.forEach((entry, idx) => {
    const colonIdx = entry.indexOf(":");
    if (colonIdx > 0) {
      const kid = entry.slice(0, colonIdx).trim();
      const sec = entry.slice(colonIdx + 1).trim();
      if (kid && sec.length >= 16) {
        out[kid] = sec;
      }
    } else if (entry.length >= 16) {
      out[`${defaultPrefix}-prev-${idx + 1}`] = entry;
    }
  });
  return out;
}

export function resolveAppEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const raw = (env.APP_ENV || env.NODE_ENV || "development").trim().toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  if (raw === "staging" || raw === "stage") return "staging";
  if (raw === "test" || raw === "testing") return "testing";
  return "development";
}

export function validateEnvironmentConfig(env: NodeJS.ProcessEnv = process.env): RuntimeSecurityConfig {
  const appEnv = resolveAppEnvironment(env);
  const isProduction = appEnv === "production";
  const isTesting = appEnv === "testing";

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const explicitAuditSecret = (env.AUDIT_HMAC_SECRET ?? "").trim();
  const hasExplicitAuditSecret = explicitAuditSecret.length >= 32;
  const auditHmacKeyId = (env.AUDIT_HMAC_KEY_ID ?? "aud-k1").trim() || "aud-k1";
  const auditHmacPreviousSecrets = parseSecretKeyring(env.AUDIT_HMAC_PREVIOUS_SECRETS, "aud");

  const explicitVaultSecret = (env.VAULT_ENCRYPTION_SECRET ?? "").trim();
  const hasExplicitVaultSecret = explicitVaultSecret.length >= 32;
  const vaultKeyId = (env.VAULT_ENCRYPTION_KEY_ID ?? "vault-k1").trim() || "vault-k1";
  const vaultPreviousSecrets = parseSecretKeyring(env.VAULT_PREVIOUS_SECRETS, "vault");

  if (isProduction) {
    if (!allowedOrigins.length) {
      throw new Error("PRODUCTION_CONFIG_ERROR: ALLOWED_ORIGINS debe configurarse explícitamente en producción.");
    }
    if (allowedOrigins.some((o) => o === "*" || o.includes("localhost") || o.includes("127.0.0.1"))) {
      throw new Error("PRODUCTION_CONFIG_ERROR: ALLOWED_ORIGINS no puede incluir comodines (*) ni localhost en producción.");
    }
    if (!hasExplicitAuditSecret) {
      throw new Error("PRODUCTION_CONFIG_ERROR: AUDIT_HMAC_SECRET (mín. 32 caracteres) es obligatorio en producción.");
    }
    if (!hasExplicitVaultSecret) {
      throw new Error(
        "PRODUCTION_CONFIG_ERROR: VAULT_ENCRYPTION_SECRET (mín. 32 caracteres, separado de AUDIT_HMAC_SECRET) es obligatorio en producción."
      );
    }
    if (explicitVaultSecret === explicitAuditSecret) {
      throw new Error(
        "PRODUCTION_CONFIG_ERROR: VAULT_ENCRYPTION_SECRET debe ser criptográficamente distinto de AUDIT_HMAC_SECRET."
      );
    }
  }

  return {
    appEnv,
    isProduction,
    isTesting,
    allowedOrigins: isProduction
      ? allowedOrigins
      : Array.from(
          new Set([
            ...allowedOrigins,
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://0.0.0.0:3000",
          ])
        ),
    hasExplicitAuditSecret,
    auditHmacSecret: hasExplicitAuditSecret ? explicitAuditSecret : EPHEMERAL_DEV_AUDIT_SECRET,
    auditHmacKeyId,
    auditHmacPreviousSecrets,
    hasExplicitVaultSecret,
    vaultEncryptionSecret: hasExplicitVaultSecret ? explicitVaultSecret : EPHEMERAL_DEV_VAULT_SECRET,
    vaultKeyId,
    vaultPreviousSecrets,
    appCheckEnforced: (env.FIREBASE_APP_CHECK_ENFORCED ?? "").trim().toLowerCase() === "true",
    wormAuditStreamEnabled: (env.WORM_AUDIT_STREAM_ENABLED ?? "true").trim().toLowerCase() !== "false",
  };
}
