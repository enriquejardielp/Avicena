# Copia de seguridad, recuperación ante desastres y separación de entornos — Avicena

## 1. Objetivos de recuperación (RPO / RTO)

| Métrica | Objetivo recomendado en producción | Mecanismo |
|---|---|---|
| **RPO** (Punto de recuperación máximo) | ≤ 1 hora (≤ 1 minuto con PITR activo) | Firestore Point-in-Time Recovery (PITR) + exportación diaria programada a bucket GCS cifrado |
| **RTO** (Tiempo máximo de recuperación) | ≤ 4 horas | Restauración declarativa desde exportación verificada + despliegue inmutable Cloud Run |

## 2. Procedimiento de exportación y verificación externa (Google Cloud / Firestore)

1. Habilitar **PITR** en la base de datos Firestore del proyecto de producción:
   ```bash
   gcloud firestore databases update \
     --database="(default)" \
     --enable-pitr
   ```
2. Ejecutar exportación programada diaria hacia un bucket GCS dedicado con **Object Lock / Retention Policy (WORM)** y cifrado CMEK:
   ```bash
   gcloud firestore export gs://<BUCKET_BACKUPS_CLINICOS_PROD>/firestore/$(date -u +%Y%m%dT%H%M%SZ) \
     --database="(default)"
   ```
3. Verificar criptográficamente el manifiesto de respaldo y ejecutar simulacro aislado de restauración antes de validar la copia:
   ```bash
   npx tsx scripts/backup-verify.ts
   ```
4. **Custodia independiente y segregación de secretos criptográficos**:
   - `VAULT_ENCRYPTION_SECRET` (+ `VAULT_ENCRYPTION_KEY_ID` y `VAULT_PREVIOUS_SECRETS` para rotación sin pérdida de lectura): cifra exclusivamente la bóveda de identidad (`identityVault`) con AES-256-GCM y genera los índices ciegos (`blindIndexes`).
   - `AUDIT_HMAC_SECRET` (+ `AUDIT_HMAC_KEY_ID` y `AUDIT_HMAC_PREVIOUS_SECRETS` para verificación histórica): sella exclusivamente la cadena de auditoría (`auditLogs`) y las atestaciones de aprobación electrónica (`electronicSignatures`).
   - Ambos secretos deben almacenarse en **Google Cloud Secret Manager** (y provisionarse mediante `scripts/gcp-infra-setup.sh`), nunca en Firestore ni junto a los ficheros exportados.
   - Sin el valor exacto de `VAULT_ENCRYPTION_SECRET` (o su versión correspondiente en `VAULT_PREVIOUS_SECRETS`), `identityVault` permanece ilegible aunque un tercero acceda al almacenamiento de copias.

## 3. Protocolo trimestral de simulacro de restauración

1. Provisionar un proyecto/entorno aislado de **staging** (`APP_ENV=staging`) con credenciales propias.
2. Ejecutar `gcloud firestore import` sobre la base de pruebas de staging (nunca sobre producción ni desarrollo local).
3. Validar con `npx tsx scripts/backup-verify.ts` y `POST /api/audit/verify` que la cadena HMAC de auditoría y los registros pseudonimizados son íntegros.
4. Registrar fecha, responsable, suma SHA-256 del lote y resultado del simulacro en el acta de cumplimiento del estudio.

## 4. Separación estricta de entornos (`APP_ENV`)

Avicena valida el entorno mediante `server/envConfig.ts` en el arranque:

- **`development`**: desarrollo local (`localhost:3000`). Permite secreto efímero en memoria solo para pruebas locales no persistentes.
- **`testing`**: ejecución de suite automatizada (`tests/security-remediation.test.ts`) con datos estrictamente sintéticos.
- **`staging`**: validación previa a producción con proyecto Firebase separado y `ALLOWED_ORIGINS` explícito.
- **`production`**:
  - **Fallo seguro obligatorio** si falta `ALLOWED_ORIGINS`, si contiene `*` o `localhost`/`127.0.0.1`, o si `AUDIT_HMAC_SECRET` tiene menos de 32 caracteres.
  - Prohibido compartir proyectos Firebase, buckets de respaldo, claves de API o usuarios reales entre `development`/`testing` y `production`.
