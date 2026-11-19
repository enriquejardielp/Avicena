import crypto from "node:crypto";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };

const GOOGLE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const IDENTITY_LOOKUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";

function getFirebaseProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  if (firebaseConfig?.projectId) {
    return firebaseConfig.projectId;
  }
  throw new Error("FIREBASE_PROJECT_ID_NOT_CONFIGURED");
}

function getFirebaseWebApiKey(): string {
  if (process.env.FIREBASE_WEB_API_KEY) {
    return process.env.FIREBASE_WEB_API_KEY;
  }
  if (firebaseConfig?.apiKey) {
    return firebaseConfig.apiKey;
  }
  throw new Error("FIREBASE_API_KEY_NOT_CONFIGURED");
}

let cachedCerts: Record<string, string> = {};
let certsExpireAt = 0;

async function fetchPublicCerts(force = false): Promise<Record<string, string>> {
  if (!force && Date.now() < certsExpireAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const res = await fetch(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`AUTH_CERTS_FETCH_FAILED:${res.status}`);
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

interface LookupUserRecord {
  localId?: string;
  email?: string;
  emailVerified?: boolean;
  disabled?: boolean;
  validSince?: string;
}

async function verifySessionNotRevoked(idToken: string, expectedUid: string, authTimeSec?: number): Promise<void> {
  const apiKey = getFirebaseWebApiKey();
  const res = await fetch(`${IDENTITY_LOOKUP_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    let errMsg = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      errMsg = body?.error?.message ?? "";
    } catch {
      errMsg = "";
    }
    if (errMsg.includes("USER_DISABLED")) throw new Error("USER_DISABLED");
    if (errMsg.includes("INVALID_ID_TOKEN") || errMsg.includes("TOKEN_EXPIRED") || errMsg.includes("USER_NOT_FOUND")) {
      throw new Error("TOKEN_REVOKED");
    }
    throw new Error(`AUTH_LOOKUP_FAILED:${res.status}`);
  }

  const data = (await res.json()) as { users?: LookupUserRecord[] };
  const record = data.users?.[0];
  if (!record || record.localId !== expectedUid) {
    throw new Error("TOKEN_REVOKED");
  }
  if (record.disabled === true) {
    throw new Error("USER_DISABLED");
  }
  if (record.emailVerified !== true) {
    throw new Error("EMAIL_NOT_VERIFIED");
  }
  if (record.validSince && authTimeSec !== undefined) {
    const validSinceSec = Number(record.validSince);
    if (Number.isFinite(validSinceSec) && authTimeSec < validSinceSec) {
      throw new Error("TOKEN_REVOKED");
    }
  }
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  name: string;
  email_verified: boolean;
  picture: string | null;
  auth_time: number;
  mfa_second_factor: string | null;
}

export async function verifyFirebaseIdToken(
  idToken: string,
  options?: { checkRevoked?: boolean }
): Promise<VerifiedFirebaseUser> {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("TOKEN_MALFORMED");
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf-8")) as { alg?: string; kid?: string };
  } catch {
    throw new Error("TOKEN_MALFORMED");
  }
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
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    firebase?: {
      sign_in_second_factor?: string;
    };
  };

  const projectId = getFirebaseProjectId();
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error("TOKEN_BAD_AUDIENCE");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("TOKEN_BAD_ISSUER");
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("TOKEN_MISSING_SUB");
  if (!payload.exp || payload.exp <= nowSec - 30) throw new Error("TOKEN_EXPIRED");
  if (payload.iat && payload.iat > nowSec + 300) throw new Error("TOKEN_FUTURE_IAT");
  if (!payload.email) throw new Error("TOKEN_MISSING_EMAIL");
  if (payload.email_verified !== true) throw new Error("EMAIL_NOT_VERIFIED");

  const authTime = typeof payload.auth_time === "number" ? payload.auth_time : payload.iat ?? nowSec;

  if (options?.checkRevoked !== false) {
    await verifySessionNotRevoked(idToken, payload.sub, authTime);
  }

  return {
    uid: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name?.trim() || payload.email.split("@")[0],
    email_verified: true,
    picture: payload.picture ?? null,
    auth_time: authTime,
    mfa_second_factor: payload.firebase?.sign_in_second_factor ?? null,
  };
}
