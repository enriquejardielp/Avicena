# Runbook de Endurecimiento Operativo e Infraestructura — Avicena

Este documento recoge los **7 controles de infraestructura en Google Cloud Platform (GCP) y Firebase** que complementan la arquitectura de seguridad implementada en el código fuente de Avicena (`server/*`, `firestore.rules`, `src/lib/firestoreDb.ts`). Ninguno de estos controles puede provisionarse ni verificarse únicamente desde código de aplicación sin acceso administrativo al proyecto Cloud destino.

---

## 1. Separación física de la Bóveda de Identidad (Identity Vault) y Datos Clínicos

**Estado en código**: Separación lógica estricta en `/projects/{projectId}/identityVault/{subjectPseudoId}` cifrada con `VAULT_ENCRYPTION_SECRET` (clave separada de `AUDIT_HMAC_SECRET`) + `/projects/{projectId}/blindIndexes/{blindHash}`.

**Provisionamiento físico en GCP (Producción clínica)**:
1. Crear un proyecto GCP dedicado para identidades civiles: `avicena-vault-prod` (con una única instancia Firestore o Cloud SQL PostgreSQL aislada en `europe-west1` / `europe-southwest1`).
2. Configurar IAM con **separación de deberes**: los administradores o desarrolladores de `avicena-clinical-prod` **no** deben tener el rol `roles/datastore.owner` ni acceso de lectura sobre `avicena-vault-prod`.
3. Desplegar un microservicio interno (Cloud Run sin acceso público, accesible solo por IAM Invoker desde la cuenta de servicio autorizada) que exponga `/seal`, `/unseal` y `/blind-index` usando una VPC Service Controls (VPC-SC) perimeter compartida solo cuando corresponda.
4. Enrutar las llamadas de bóveda desde `server/apiRouter.ts` al endpoint privado mTLS/IAM-signed del proyecto `avicena-vault-prod` y eliminar la colección `identityVault` del proyecto clínico.

---

## 2. Almacenamiento externo e inmutable WORM para Audit Trail

**Estado en código**: `server/auditChain.ts` emite eventos estructurados con `worm_audit: true` mediante `logSecurityEvent("info", "worm_audit_event", ...)` y `server/apiRouter.ts` registra eventos de exportación con `worm_audit: true`, además de la cadena HMAC-SHA256 transaccional en Firestore (`meta/shard_auditLogIds_<n>`).

**Configuración en GCP (Cloud Logging Sink -> Cloud Storage con Bucket Lock)**:
```bash
# 1. Crear bucket en región UE con acceso uniforme
gcloud storage buckets create gs://avicena-audit-worm-prod \
  --project=avicena-clinical-prod \
  --location=EUROPE-SOUTHWEST1 \
  --uniform-bucket-level-access

# 2. Fijar política de retención (p. ej. 15 años = 473040000s, según normativa de ensayos clínicos) y BLOQUEARLA (irreversible)
gcloud storage buckets update gs://avicena-audit-worm-prod \
  --retention-period=473040000s
gcloud storage buckets lock-retention-policy gs://avicena-audit-worm-prod

# 3. Crear el sink de Cloud Logging filtrando eventos WORM de Avicena
gcloud logging sinks create avicena-worm-audit-sink \
  storage.googleapis.com/avicena-audit-worm-prod \
  --project=avicena-clinical-prod \
  --log-filter='jsonPayload.worm_audit=true'

# 4. Conceder permiso objectCreator al writerIdentity devuelto por el comando anterior
gcloud storage buckets add-iam-policy-binding gs://avicena-audit-worm-prod \
  --member="serviceAccount:<WRITER_IDENTITY_DEL_SINK>" \
  --role="roles/storage.objectCreator"
```

---

## 3. Activación y obligatoriedad efectiva de Doble Factor (MFA TOTP)

**Estado en código**:
- `server/studyAccess.ts` valida `governance.requireMfa && !user.mfa_second_factor` y rechaza con `403 MFA_REQUIRED_BY_STUDY`.
- `firestore.rules` valida `hasMfaClaim()` (`request.auth.token.firebase.sign_in_second_factor != null`) mediante `satisfiesStudyMfa(projectId)` en lecturas y escrituras clínicas, bóveda, consentimiento y administración cuando `governance/settings.requireMfa == true`.

**Activación requerida en Firebase Console / Identity Platform**:
1. En **Firebase Console -> Authentication -> Settings -> Multi-factor authentication**, actualizar a **Firebase Authentication with Identity Platform** (requerido para TOTP/SMS).
2. Activar **TOTP (Time-based One-Time Password)** como factor obligatorio u opcional permitido en el tenant/proyecto.
3. En la interfaz de usuario, guiar a los investigadores principales, coordinadores y administradores a vincular una app autenticadora (`multiFactor(user).enroll(...)`) antes de activar el interruptor *«Exigir MFA»* en la pestaña **Gobernanza** del estudio.

---

## 4. Point-in-Time Recovery (PITR) y Copias de Seguridad Externas Cifradas

**Estado en código**: El script `scripts/backup-verify.ts` (`avicena-backup-v2`) valida integridad SHA-256 + HMAC-SHA256, descifrado de bóveda con claves separadas y verificación de cadena de auditoría en simulacros de restauración.

**Configuración real en Firestore**:
```bash
# 1. Habilitar PITR (recuperación de hasta 7 días granulares) en la base Firestore
gcloud firestore databases update \
  --project=avicena-clinical-prod \
  --database="(default)" \
  --enable-pitr

# 2. Crear bucket de backups cifrado con Cloud KMS (CMEK) en región UE distinta
gcloud storage buckets create gs://avicena-backups-prod \
  --project=avicena-clinical-prod \
  --location=EUROPE-WEST1 \
  --uniform-bucket-level-access

# 3. Exportación programada diaria mediante Cloud Scheduler + Cloud Run / Workflow
gcloud firestore export gs://avicena-backups-prod/daily/$(date +%F) \
  --project=avicena-clinical-prod \
  --database="(default)"
```
Ejecutar trimestralmente una restauración sobre un proyecto `staging` aislado y verificar el resultado con:
```bash
npx tsx scripts/backup-verify.ts
```

---

## 5. Gestión y Rotación de Secretos en Google Cloud Secret Manager

**Estado en código**: `server/envConfig.ts` separa obligatoriamente `AUDIT_HMAC_SECRET` y `VAULT_ENCRYPTION_SECRET` en producción y soporta anillos de claves por versión (`AUDIT_HMAC_KEY_ID` + `AUDIT_HMAC_PREVIOUS_SECRETS`, `VAULT_ENCRYPTION_KEY_ID` + `VAULT_PREVIOUS_SECRETS`).

**Provisionamiento inicial en Secret Manager**:
```bash
# Generar secretos independientes de 256 bits (64 hex chars)
openssl rand -hex 32 | gcloud secrets create AUDIT_HMAC_SECRET --data-file=- --project=avicena-clinical-prod
openssl rand -hex 32 | gcloud secrets create VAULT_ENCRYPTION_SECRET --data-file=- --project=avicena-clinical-prod
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic" --project=avicena-clinical-prod
```

**Procedimiento de rotación sin pérdida de datos históricos**:
1. Mover el secreto actual al listado de claves previas con su `keyId` (ejemplo):
   - `VAULT_ENCRYPTION_KEY_ID=vault-k2`
   - `VAULT_ENCRYPTION_SECRET=<nuevo-secreto-k2>`
   - `VAULT_PREVIOUS_SECRETS=vault-k1:<secreto-anterior-k1>`
   - `AUDIT_HMAC_KEY_ID=aud-k2`
   - `AUDIT_HMAC_SECRET=<nuevo-secreto-aud-k2>`
   - `AUDIT_HMAC_PREVIOUS_SECRETS=aud-k1:<secreto-anterior-aud-k1>`
2. Los nuevos registros de auditoría y entradas de bóveda llevarán `keyId: "aud-k2"` / `version: "aes-256-gcm-v2", keyId: "vault-k2"`, mientras que `verifyAuditChain()` y `unsealIdentityPayload()` seguirán verificando y descifrando los registros históricos `v1`/`k1`.
3. Opcionalmente, re-cifrar entradas antiguas de `identityVault` mediante tarea administrativa controlada antes de retirar `vault-k1` de `VAULT_PREVIOUS_SECRETS`.

---

## 6. Firebase App Check (Protección frente a clientes no autorizados)

**Configuración en Firebase Console & Cloud Run**:
1. Registrar la app web de Avicena en **Firebase Console -> App Check** con proveedor **reCAPTCHA Enterprise**.
2. Activar **Enforce** para **Cloud Firestore** y **Firebase Authentication**.
3. En el backend Express, inicializar la verificación del encabezado `X-Firebase-AppCheck` mediante `firebase-admin/app-check` cuando `FIREBASE_APP_CHECK_ENFORCED=true`.

---

## 7. Separación estricta de entornos (`development`, `staging`, `production`)

Nunca compartir proyectos Firebase ni secretos entre entornos:
- **`avicena-dev`**: `APP_ENV=development`, datos exclusivamente sintéticos.
- **`avicena-staging`**: `APP_ENV=staging`, proyecto Firebase independiente, prueba de migraciones, reglas Firestore y simulacros de restauración PITR.
- **`avicena-clinical-prod`**: `APP_ENV=production`, `ALLOWED_ORIGINS` explícito HTTPS (sin comodines ni `localhost`), secretos separados en Secret Manager, VPC/CORS estrictos, PITR activo y WORM sink operativo.
