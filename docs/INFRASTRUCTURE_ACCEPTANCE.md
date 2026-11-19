# Aceptación de Infraestructura Google Cloud y Firebase — Avicena

Este documento define los **criterios técnicos de aceptación de infraestructura**, los controles **verificados en el código de aplicación** frente a los controles **pendientes de aprovisionamiento en la organización Google Cloud Platform (GCP) y Firebase Console** del promotor o institución sanitaria.

---

## 1. Script reproducible de aprovisionamiento

El repositorio incluye el script parametrizado `scripts/gcp-infra-setup.sh`, que automatiza la creación y configuración base de:
1. Proyectos aislados por entorno: `avicena-dev`, `avicena-staging`, `avicena-prod` y proyecto separado de bóveda/KMS `avicena-vault-prod`.
2. Secret Manager con segregación criptográfica (`AUDIT_HMAC_SECRET`, `AUDIT_HMAC_PREVIOUS_SECRETS`, `VAULT_ENCRYPTION_SECRET`, `VAULT_PREVIOUS_SECRETS`, `GEMINI_API_KEY`).
3. Cloud KMS (`avicena-keyring` / `avicena-cmek` con rotación cada 90 días) y bucket GCS WORM (`avicena-worm-audit-prod`) vinculado a un Cloud Logging Sink con filtro `jsonPayload.worm_audit=true`.
4. Firestore Point-in-Time Recovery (`--enable-pitr`), bucket externo de copias (`avicena-firestore-backups-prod`) y programación diaria de backups.

---

## 2. Matriz de criterios de aceptación de infraestructura

| ID | Control de infraestructura | Soporte en repositorio | Criterio de aceptación en Producción | Estado actual en sandbox |
|---|---|---|---|---|
| **INF-01** | **Aislamiento de proyectos `dev` / `staging` / `prod`** | `server/envConfig.ts` impone fail-closed en `APP_ENV=production` y `scripts/gcp-infra-setup.sh` crea proyectos separados. | 3 proyectos GCP independientes sin cuentas de servicio ni buckets compartidos. | **PENDIENTE** (en sandbox solo existe el proyecto dev actual). |
| **INF-02** | **Separación física de Bóveda de Identidad** | Bóveda lógica aislada (`identityVault` + `blindIndexes`), cifrado AES-256-GCM con clave propia `VAULT_ENCRYPTION_SECRET` y rotación por versión. | Proyecto `avicena-vault-prod` dedicado con IAM restringido (administradores clínicos sin acceso a KMS/bóveda) o servicio interno Cloud Run con VPC-SC. | **PARCIAL** (lógica en código lista; proyecto separado pendiente en GCP). |
| **INF-03** | **Secret Manager y segregación de claves** | `server/envConfig.ts` distingue `AUDIT_HMAC_SECRET` y `VAULT_ENCRYPTION_SECRET` e impide que sean idénticos en producción; soporta `*_PREVIOUS_SECRETS`. | Todos los secretos montados desde Google Cloud Secret Manager sin variables en texto plano en archivos o imágenes. | **PENDIENTE** en Cloud Run destino. |
| **INF-04** | **Auditoría externa WORM (Object Lock)** | `server/auditChain.ts` y `server/apiRouter.ts` emiten JSON estructurado con `worm_audit: true` en eventos críticos. | Sink de Cloud Logging activo entregando logs a bucket GCS con `--retention-period` acorde a normativa (15–25 años) y `--lock-retention-policy` bloqueado. | **PENDIENTE** de ejecución en GCP. |
| **INF-05** | **Firestore PITR y copias externas cifradas** | `scripts/backup-verify.ts` valida checksums SHA-256, descifrado con clave separada y verificación de cadena HMAC. | `--enable-pitr` activo, exportación diaria a GCS en región UE (`europe-west1` / `eur3`) y acta trimestral de restauración en `staging`. | **PARCIAL** (script de verificación validado; PITR externo pendiente). |
| **INF-06** | **Firebase App Check (reCAPTCHA Enterprise)** | `server/firebaseAuth.ts` verifica `X-Firebase-AppCheck` si `REQUIRE_APP_CHECK=true` (activo por defecto en `production`). | App Check registrado con reCAPTCHA Enterprise y *Enforce* activado en Firestore, Auth y API Express. | **PENDIENTE** en Firebase Console. |
| **INF-07** | **Identity Platform y MFA TOTP** | `AppShell.tsx` implementa enrolamiento TOTP; `server/studyAccess.ts` y `firestore.rules` validan claim `sign_in_second_factor`. | Identity Platform habilitado con TOTP activo y política de estudio `requireMfa=true` verificada. | **PARCIAL** (código y reglas listos; activación Identity Platform en proyecto prod pendiente). |
| **INF-08** | **Región de residencia UE y cifrado en tránsito** | HSTS, cabeceras seguras y CORS estricto por lista blanca `ALLOWED_ORIGINS` en `server.ts`. | Despliegue Cloud Run y Firestore en región UE (`europe-west1` / `eur3`), TLS 1.2+ y dominio corporativo HTTPS sin comodines. | **PENDIENTE** de despliegue productivo. |
