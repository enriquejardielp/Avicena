import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const GOOGLE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let cachedProjectId: string | null = null;
function getFirebaseProjectId(): string {
  if (cachedProjectId) return cachedProjectId;
  if (process.env.FIREBASE_PROJECT_ID) {
    cachedProjectId = process.env.FIREBASE_PROJECT_ID;
    return cachedProjectId;
  }
  const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(cfgPath)) {
    const raw = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as { projectId?: string };
    if (raw.projectId) {
      cachedProjectId = raw.projectId;
      return cachedProjectId;
    }
  }
  throw new Error("FIREBASE_PROJECT_ID_NOT_CONFIGURED");
}

let cachedCerts: Record<string, string> = {};
let certsExpireAt = 0;

async function fetchPublicCerts(force = false): Promise<Record<string, string>> {
  if (!force && Date.now() < certsExpireAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Google Firebase public keys (${res.status})`);
  }
  const certs = (await res.json()) as Record<string, string>;
  const cc = res.headers.get("cache-control") ?? "";
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = certs;
  certsExpireAt = Date.now() + Math.max(60, maxAgeSec) * 1000;
  return cachedCerts;
}

function base64UrlDecode(segment: string): Buffer {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, "base64");
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  name: string;
  email_verified: boolean;
  picture: string | null;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser> {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("TOKEN_MALFORMED");
  }
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(base64UrlDecode(headerB64).toString("utf-8")) as {
    alg?: string;
    kid?: string;
  };
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("TOKEN_INVALID_HEADER");
  }

  let certs = await fetchPublicCerts(false);
  let cert = certs[header.kid];
  if (!cert) {
    certs = await fetchPublicCerts(true);
    cert = certs[header.kid];
  }
  if (!cert) {
    throw new Error("TOKEN_UNKNOWN_KID");
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const valid = verifier.verify(cert, base64UrlDecode(sigB64));
  if (!valid) {
    throw new Error("TOKEN_INVALID_SIGNATURE");
  }

  const payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf-8")) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };

  const projectId = getFirebaseProjectId();
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error("TOKEN_BAD_AUDIENCE");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("TOKEN_BAD_ISSUER");
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("TOKEN_MISSING_SUB");
  if (!payload.exp || payload.exp <= nowSec - 30) throw new Error("TOKEN_EXPIRED");
  if (!payload.email) throw new Error("TOKEN_MISSING_EMAIL");

  return {
    uid: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name?.trim() || payload.email.split("@")[0],
    email_verified: Boolean(payload.email_verified),
    picture: payload.picture ?? null,
  };
}
