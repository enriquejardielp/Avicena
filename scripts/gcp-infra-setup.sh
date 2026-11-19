#!/usr/bin/env bash
# ==============================================================================
# Avicena EDC/eCRF — Provisionamiento reproducible de infraestructura GCP/Firebase
# ==============================================================================
# IMPORTANTE:
# - Este script parametriza el despliegue real fuera del sandbox de desarrollo.
# - Requiere permisos de Owner / Security Admin / Organization Policy Admin.
# - El bloqueo definitivo de retención WORM (`--lock-retention-policy`) es
#   IRREVERSIBLE: no lo actives en pruebas ni sin aprobación formal de QA/IT.
# ==============================================================================
set -euo pipefail

ORG_ID="${ORG_ID:?Define ORG_ID (ID de organización GCP)}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:?Define BILLING_ACCOUNT}"
REGION="${REGION:-europe-west1}"                 # Región UE recomendada para RGPD
FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-eur3}" # Multirregión europea Firestore

PROJECT_DEV="${PROJECT_DEV:-avicena-dev}"
PROJECT_STAGING="${PROJECT_STAGING:-avicena-staging}"
PROJECT_PROD="${PROJECT_PROD:-avicena-prod}"
PROJECT_VAULT="${PROJECT_VAULT:-avicena-vault-prod}" # Proyecto separado opcional para bóveda/KMS

WORM_AUDIT_BUCKET="${WORM_AUDIT_BUCKET:-avicena-worm-audit-prod}"
BACKUP_BUCKET="${BACKUP_BUCKET:-avicena-firestore-backups-prod}"
AUDIT_RETENTION_SECONDS="${AUDIT_RETENTION_SECONDS:-788400000}"   # 25 años (ensayos clínicos UE 536/2014)
BACKUP_RETENTION_SECONDS="${BACKUP_RETENTION_SECONDS:-31536000}"   # 1 año para copias operativas
ENABLE_IRREVERSIBLE_BUCKET_LOCK="${ENABLE_IRREVERSIBLE_BUCKET_LOCK:-false}"

echo "==> 1. Creación / verificación de proyectos aislados (dev, staging, prod, vault)"
for proj in "$PROJECT_DEV" "$PROJECT_STAGING" "$PROJECT_PROD" "$PROJECT_VAULT"; do
  if ! gcloud projects describe "$proj" >/dev/null 2>&1; then
    gcloud projects create "$proj" --organization="$ORG_ID"
    gcloud billing projects link "$proj" --billing-account="$BILLING_ACCOUNT"
  fi
  gcloud services enable \
    firestore.googleapis.com \
    secretmanager.googleapis.com \
    run.googleapis.com \
    logging.googleapis.com \
    storage.googleapis.com \
    cloudkms.googleapis.com \
    firebaseappcheck.googleapis.com \
    identitytoolkit.googleapis.com \
    --project="$proj"
done

echo "==> 2. Secret Manager en producción y staging (secretos separados + soporte rotación)"
for proj in "$PROJECT_STAGING" "$PROJECT_PROD"; do
  for secret_name in \
    AUDIT_HMAC_SECRET \
    AUDIT_HMAC_PREVIOUS_SECRETS \
    VAULT_ENCRYPTION_SECRET \
    VAULT_PREVIOUS_SECRETS \
    GEMINI_API_KEY; do
    if ! gcloud secrets describe "$secret_name" --project="$proj" >/dev/null 2>&1; then
      gcloud secrets create "$secret_name" \
        --replication-policy="user-managed" \
        --locations="$REGION" \
        --project="$proj"
    fi
  done
done

echo "Genera y carga los valores reales (ejemplo seguro, no reutilizar entre entornos):"
echo "  openssl rand -hex 32 | gcloud secrets versions add AUDIT_HMAC_SECRET --data-file=- --project=$PROJECT_PROD"
echo "  openssl rand -hex 32 | gcloud secrets versions add VAULT_ENCRYPTION_SECRET --data-file=- --project=$PROJECT_PROD"

echo "==> 3. Cloud KMS + Bucket GCS WORM para auditoría externa inmutable (Cloud Logging Sink)"
if ! gcloud kms keyrings describe "avicena-keyring" --location="$REGION" --project="$PROJECT_PROD" >/dev/null 2>&1; then
  gcloud kms keyrings create "avicena-keyring" --location="$REGION" --project="$PROJECT_PROD"
fi
if ! gcloud kms keys describe "avicena-cmek" --keyring="avicena-keyring" --location="$REGION" --project="$PROJECT_PROD" >/dev/null 2>&1; then
  gcloud kms keys create "avicena-cmek" \
    --keyring="avicena-keyring" \
    --location="$REGION" \
    --purpose="encryption" \
    --rotation-period="90d" \
    --project="$PROJECT_PROD"
fi

if ! gcloud storage buckets describe "gs://$WORM_AUDIT_BUCKET" --project="$PROJECT_PROD" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$WORM_AUDIT_BUCKET" \
    --project="$PROJECT_PROD" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --retention-period="${AUDIT_RETENTION_SECONDS}s"
fi

if [ "$ENABLE_IRREVERSIBLE_BUCKET_LOCK" = "true" ]; then
  echo "ADVERTENCIA: bloqueando de forma IRREVERSIBLE la política de retención WORM en gs://$WORM_AUDIT_BUCKET"
  gcloud storage buckets update "gs://$WORM_AUDIT_BUCKET" --lock-retention-policy --project="$PROJECT_PROD"
fi

SINK_NAME="avicena-worm-audit-sink"
if ! gcloud logging sinks describe "$SINK_NAME" --project="$PROJECT_PROD" >/dev/null 2>&1; then
  gcloud logging sinks create "$SINK_NAME" \
    "storage.googleapis.com/$WORM_AUDIT_BUCKET" \
    --log-filter='jsonPayload.worm_audit=true' \
    --project="$PROJECT_PROD"
fi

SINK_WRITER="$(gcloud logging sinks describe "$SINK_NAME" --project="$PROJECT_PROD" --format='value(writerIdentity)')"
gcloud storage buckets add-iam-policy-binding "gs://$WORM_AUDIT_BUCKET" \
  --member="$SINK_WRITER" \
  --role="roles/storage.objectCreator" \
  --project="$PROJECT_PROD"

echo "==> 4. Firestore PITR (Point-in-Time Recovery) + Bucket de copias externas + Backup Schedule"
gcloud firestore databases update \
  --database="(default)" \
  --enable-pitr \
  --project="$PROJECT_PROD"

if ! gcloud storage buckets describe "gs://$BACKUP_BUCKET" --project="$PROJECT_PROD" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BACKUP_BUCKET" \
    --project="$PROJECT_PROD" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --retention-period="${BACKUP_RETENTION_SECONDS}s"
fi

gcloud alpha firestore backups schedules create \
  --database="(default)" \
  --recurrence="daily" \
  --retention="14d" \
  --project="$PROJECT_PROD" || true

echo "==> 5. Firebase App Check + MFA obligatorio a nivel de Identity Platform (requiere habilitación manual en Firebase Console)"
echo "Pasos finales manuales obligatorios tras ejecutar este script:"
echo "  1) En Firebase Console ($PROJECT_PROD): App Check -> Registrar Web App con reCAPTCHA Enterprise y activar Enforce para Cloud Firestore y Auth."
echo "  2) En Firebase Console ($PROJECT_PROD): Authentication -> Sign-in method / Multi-factor authentication -> Activar TOTP Authenticator App."
echo "  3) Desplegar Cloud Run con APP_ENV=production, ALLOWED_ORIGINS=<URL_PROD>, REQUIRE_APP_CHECK=true y secretos montados desde Secret Manager."
echo "  4) Ejecutar prueba de restauración en $PROJECT_STAGING y validar con: npx tsx scripts/backup-verify.ts"
