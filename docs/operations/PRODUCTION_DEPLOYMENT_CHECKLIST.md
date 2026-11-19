# PNT-06: Checklist de Despliegue a Producción — Avicena

**Código:** SOP-OPE-006 · **Versión:** 1.0 · **Carácter:** Bloqueante (*Go / No-Go Gate*)

Ningún despliegue de Avicena puede abrirse a datos reales de pacientes si alguno de los puntos siguientes está sin verificar:

| # | Verificación obligatoria antes de Go-Live | Responsable | Estado |
|---|---|---|---|
| 1 | Proyectos GCP separados (`avicena-dev`, `avicena-staging`, `avicena-prod`, `avicena-vault-prod`) creados con `scripts/gcp-infra-setup.sh`. | Cloud Admin | [ ] |
| 2 | `APP_ENV=production` y `ALLOWED_ORIGINS` configurado con dominio HTTPS corporativo exacto (sin `*` ni `localhost`). | Cloud Admin | [ ] |
| 3 | `VAULT_ENCRYPTION_SECRET` y `AUDIT_HMAC_SECRET` distintos (≥ 32 bytes aleatorios) montados desde **Secret Manager**. | CISO / Cloud Admin | [ ] |
| 4 | Reglas `firestore.rules` validadas con `npx eslint firestore.rules` y desplegadas en `avicena-prod`. | DevOps / QA | [ ] |
| 5 | **Identity Platform** con TOTP habilitado en Firebase Console y `require_mfa: true` activo en estudios clínicos. | Cloud Admin / IP | [ ] |
| 6 | **Firebase App Check** con reCAPTCHA Enterprise en modo *Enforce* (`REQUIRE_APP_CHECK=true` en Cloud Run). | Cloud Admin | [ ] |
| 7 | **Firestore PITR** (`--enable-pitr`) y exportación diaria a bucket GCS cifrado activos en región UE (`europe-west1`/`eur3`). | Cloud Admin | [ ] |
| 8 | **WORM Audit Sink** (`jsonPayload.worm_audit=true`) entregando logs en bucket GCS con retención bloqueada (`--lock-retention-policy`). | Cloud Admin / QA | [ ] |
| 9 | Suite `tests/security-remediation.test.ts` (13/13), `scripts/backup-verify.ts`, `npm run build` y protocolos `IQ/OQ/PQ` aprobados en `staging`. | QA / CSV | [ ] |
| 10 | **EIPD/DPIA** aprobada por el DPO, dictamen favorable del **CEIm** y **DPA** firmado si se habilita IA externa. | IP / DPO | [ ] |
