# PNT-03: Copias de Seguridad, Recuperación ante Desastres y Simulacro Trimestral — Avicena

**Código:** SOP-OPE-003 · **Versión:** 1.0 · **Referencia técnica:** `docs/BACKUP_RECOVERY_AND_ENVIRONMENTS.md`, `scripts/backup-verify.ts`, `scripts/gcp-infra-setup.sh`

---

## 1. Objetivos RPO / RTO
- **RPO máximo:** ≤ 1 hora (≤ 1 minuto con Firestore PITR habilitado).
- **RTO máximo:** ≤ 4 horas mediante restauración en proyecto Cloud Run + Firestore.

## 2. Arquitectura de respaldo
1. **Firestore PITR** habilitado continuamente en producción (ventana de recuperación granular de 7 días).
2. **Exportación diaria automatizada** hacia bucket GCS separado en región UE (`avicena-firestore-backups-prod`) con retención controlada y cifrado CMEK.
3. **Custodia separada de claves:** Las copias de Firestore NO contienen `VAULT_ENCRYPTION_SECRET` ni `AUDIT_HMAC_SECRET`; ambos permanecen exclusivamente en Google Cloud Secret Manager.

## 3. Protocolo trimestral de prueba de restauración
1. Seleccionar la exportación diaria más reciente de `avicena-firestore-backups-prod`.
2. Importar el respaldo en el proyecto aislado **`avicena-staging`** (nunca en producción ni desarrollo).
3. Ejecutar verificación criptográfica:
   ```bash
   npx tsx scripts/backup-verify.ts
   ```
   y validar en `staging` que `POST /api/audit/verify` devuelve `valid: true` y que las bóvedas históricas descifran correctamente con `VAULT_ENCRYPTION_SECRET` / `VAULT_PREVIOUS_SECRETS`.
4. Documentar fecha, responsable, suma SHA-256 de la copia, tiempo real de recuperación obtenido y firma de QA.
