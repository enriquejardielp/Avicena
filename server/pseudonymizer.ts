import crypto from "node:crypto";
import { validateEnvironmentConfig } from "./envConfig.ts";
import { scanForPii } from "./piiGuard.ts";

export function generateSubjectPseudoId(): string {
  const bytes = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `SUBJ-${bytes}`;
}

export function assertNonIdentifiableResearchId(candidate: string): { valid: boolean; reason?: string } {
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length < 4 || trimmed.length > 64) {
    return { valid: false, reason: "El identificador de investigación debe tener entre 4 y 64 caracteres." };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return {
      valid: false,
      reason: "El identificador de investigación solo puede contener letras, números, guiones y guion bajo.",
    };
  }
  const pii = scanForPii(trimmed);
  if (pii.hasPii) {
    return {
      valid: false,
      reason: `El identificador no puede contener datos identificativos (${pii.categories.join(", ")}). Usa un código pseudonimizado.`,
    };
  }
  if (/^\d{6,10}$/.test(trimmed)) {
    return {
      valid: false,
      reason: "No utilices números numéricos largos tipo NHC/historia clínica como identificador de estudio.",
    };
  }
  return { valid: true };
}

export function normalizeIdentifierForBlindIndex(rawIdentifier: string): string {
  return rawIdentifier
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\s.-]+/g, "");
}

export function computeParticipantBlindIndex(
  projectId: string,
  rawNationalOrClinicalId: string,
  secretOverride?: string
): string {
  const secret = secretOverride || validateEnvironmentConfig().vaultEncryptionSecret;
  const normalized = normalizeIdentifierForBlindIndex(rawNationalOrClinicalId);
  if (!normalized || normalized.length < 4) {
    throw new Error("El identificador civil/clínico es demasiado corto para generar índice ciego.");
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`blind-idx:v1:${projectId}:${normalized}`)
    .digest("hex");
}

function deriveVaultKeyV1(projectId: string, secret: string): Buffer {
  return crypto
    .createHmac("sha256", secret)
    .update(`identity-vault-key:v1:${projectId}`)
    .digest();
}

function deriveVaultKeyV2(projectId: string, secret: string, keyId: string): Buffer {
  return crypto
    .createHmac("sha256", secret)
    .update(`identity-vault-key:v2:${keyId}:${projectId}`)
    .digest();
}

export interface SealedIdentityPayload {
  version: "aes-256-gcm-v1" | "aes-256-gcm-v2";
  keyId?: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface ClearParticipantIdentity {
  fullName: string;
  nationalId: string;
  nhc: string;
  birthDate?: string;
  phone?: string;
  email?: string;
}

export function sealIdentityPayload(
  projectId: string,
  identity: ClearParticipantIdentity,
  secretOverride?: string,
  keyIdOverride?: string
): SealedIdentityPayload {
  const cfg = validateEnvironmentConfig();
  const secret = secretOverride || cfg.vaultEncryptionSecret;
  const keyId = keyIdOverride || cfg.vaultKeyId;
  const version = "aes-256-gcm-v2";
  const key = deriveVaultKeyV2(projectId, secret, keyId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${projectId}:${version}:${keyId}`, "utf8"));
  const plaintext = Buffer.from(JSON.stringify(identity), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version,
    keyId,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

function decryptWithKey(
  key: Buffer,
  aad: string,
  sealed: SealedIdentityPayload
): ClearParticipantIdentity {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as ClearParticipantIdentity;
}

export function unsealIdentityPayload(
  projectId: string,
  sealed: SealedIdentityPayload,
  secretOverride?: string
): ClearParticipantIdentity {
  const cfg = validateEnvironmentConfig();

  if (sealed.version === "aes-256-gcm-v2") {
    const keyId = sealed.keyId || cfg.vaultKeyId;
    const aad = `${projectId}:aes-256-gcm-v2:${keyId}`;
    const candidateSecrets: string[] = [];
    if (secretOverride) {
      candidateSecrets.push(secretOverride);
    } else {
      if (keyId === cfg.vaultKeyId) candidateSecrets.push(cfg.vaultEncryptionSecret);
      if (cfg.vaultPreviousSecrets[keyId]) candidateSecrets.push(cfg.vaultPreviousSecrets[keyId]);
      candidateSecrets.push(cfg.vaultEncryptionSecret, ...Object.values(cfg.vaultPreviousSecrets));
    }

    for (const secret of Array.from(new Set(candidateSecrets.filter(Boolean)))) {
      try {
        return decryptWithKey(deriveVaultKeyV2(projectId, secret, keyId), aad, sealed);
      } catch {
        // try next keyring secret
      }
    }
    throw new Error("No se pudo descifrar la identidad sellada (clave o estudio no coincide).");
  }

  if (sealed.version === "aes-256-gcm-v1") {
    const candidateSecrets = secretOverride
      ? [secretOverride]
      : Array.from(
          new Set([
            cfg.vaultEncryptionSecret,
            ...Object.values(cfg.vaultPreviousSecrets),
            cfg.auditHmacSecret,
            ...Object.values(cfg.auditHmacPreviousSecrets),
          ])
        );
    for (const secret of candidateSecrets.filter(Boolean)) {
      try {
        return decryptWithKey(deriveVaultKeyV1(projectId, secret), projectId, sealed);
      } catch {
        // try next legacy key
      }
    }
    throw new Error("No se pudo descifrar la identidad heredada (aes-256-gcm-v1).");
  }

  throw new Error("Versión de cifrado de bóveda no soportada.");
}
