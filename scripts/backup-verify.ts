import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateEnvironmentConfig } from "../server/envConfig.ts";
import { signAuditEntry, verifyAuditChain } from "../server/auditChain.ts";
import { sealIdentityPayload, unsealIdentityPayload } from "../server/pseudonymizer.ts";

interface BackupManifest {
  version: "avicena-backup-v2";
  createdAtUtc: string;
  environment: string;
  recordsCount: number;
  auditKeyId: string;
  vaultKeyId: string;
  sha256: string;
  hmacSha256: string;
  payload: string;
}

export function runBackupVerificationDrill(inputJsonPath?: string): {
  ok: boolean;
  manifestSha256: string;
  restoredCount: number;
  auditValid: boolean;
  separatedSecrets: boolean;
} {
  const env = validateEnvironmentConfig();
  const auditSecret = env.auditHmacSecret;
  const vaultSecret = env.vaultEncryptionSecret;
  const projectId = "proj_backup_drill";

  let records: Array<{ id: string; subjectPseudoId: string; sysBp: number; hba1c: number }>;
  if (inputJsonPath && fs.existsSync(inputJsonPath)) {
    const raw = JSON.parse(fs.readFileSync(inputJsonPath, "utf8")) as typeof records;
    records = Array.isArray(raw) ? raw : [];
  } else {
    // Strictly synthetic drill data (no real PHI)
    records = [
      { id: "rec_drill_01", subjectPseudoId: "SUBJ-DRILL01", sysBp: 124, hba1c: 5.4 },
      { id: "rec_drill_02", subjectPseudoId: "SUBJ-DRILL02", sysBp: 142, hba1c: 6.8 },
    ];
  }

  const sealedVaultSample = sealIdentityPayload(
    projectId,
    {
      fullName: "Sujeto Sintético Verificación",
      nationalId: "SYNTH-000001",
      nhc: "SYNTH-NHC-01",
    },
    vaultSecret,
    env.vaultKeyId
  );

  const chain0 = signAuditEntry(
    {
      projectId,
      actorUid: "uid_backup_drill",
      actorName: "Backup Verifier",
      actorRole: "admin_tecnico",
      action: "EXPORT_DATA",
      resourceType: "backup",
      resourceId: "drill_snapshot",
      outcome: "SUCCESS",
      reason: "Simulacro automático de verificación de copia de seguridad",
      prevHash: "GENESIS",
    },
    auditSecret,
    env.auditHmacKeyId
  );

  const bundlePayload = JSON.stringify({
    projectId,
    records,
    sealedVaultSample,
    auditChain: [chain0],
  });

  const sha256 = crypto.createHash("sha256").update(bundlePayload, "utf8").digest("hex");
  const hmacSha256 = crypto.createHmac("sha256", auditSecret).update(sha256, "utf8").digest("hex");

  const manifest: BackupManifest = {
    version: "avicena-backup-v2",
    createdAtUtc: new Date().toISOString(),
    environment: env.appEnv,
    recordsCount: records.length,
    auditKeyId: env.auditHmacKeyId,
    vaultKeyId: env.vaultKeyId,
    sha256,
    hmacSha256,
    payload: bundlePayload,
  };

  // Isolated dry-run restore verification in OS temporary directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "avicena-backup-drill-"));
  try {
    const backupFile = path.join(tmpDir, "snapshot.avicena.json");
    fs.writeFileSync(backupFile, JSON.stringify(manifest, null, 2), "utf8");

    const loaded = JSON.parse(fs.readFileSync(backupFile, "utf8")) as BackupManifest;
    const recomputedSha = crypto.createHash("sha256").update(loaded.payload, "utf8").digest("hex");
    if (recomputedSha !== loaded.sha256) {
      throw new Error("BACKUP_INTEGRITY_ERROR: SHA-256 checksum mismatch.");
    }
    const recomputedHmac = crypto.createHmac("sha256", auditSecret).update(recomputedSha, "utf8").digest("hex");
    if (
      recomputedHmac.length !== loaded.hmacSha256.length ||
      !crypto.timingSafeEqual(Buffer.from(recomputedHmac, "utf8"), Buffer.from(loaded.hmacSha256, "utf8"))
    ) {
      throw new Error("BACKUP_SIGNATURE_ERROR: HMAC signature mismatch.");
    }

    const restored = JSON.parse(loaded.payload) as {
      projectId: string;
      records: typeof records;
      sealedVaultSample: typeof sealedVaultSample;
      auditChain: [typeof chain0];
    };
    const unsealed = unsealIdentityPayload(restored.projectId, restored.sealedVaultSample, vaultSecret);
    if (unsealed.nationalId !== "SYNTH-000001") {
      throw new Error("BACKUP_VAULT_ERROR: Restored vault payload decryption mismatch.");
    }
    const auditCheck = verifyAuditChain(restored.auditChain, auditSecret);
    if (!auditCheck.valid) {
      throw new Error(`BACKUP_AUDIT_ERROR: ${auditCheck.reason}`);
    }

    return {
      ok: true,
      manifestSha256: recomputedSha,
      restoredCount: restored.records.length,
      auditValid: auditCheck.valid,
      separatedSecrets: vaultSecret !== auditSecret,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const inputPath = process.argv[2];
  const result = runBackupVerificationDrill(inputPath);
  console.log(JSON.stringify({ status: "OK", ...result }, null, 2));
}
