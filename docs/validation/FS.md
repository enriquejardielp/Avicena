# Especificación Funcional (FS) — Avicena EDC/eCRF

**Documento:** CSV-FS-001 · **Versión:** 1.0 · **Referencia:** `docs/validation/URS.md`

---

## Especificaciones Funcionales Implementadas

| ID FS | URS Origen | Descripción Funcional y Componentes Técnicos |
|---|---|---|
| **FS-01** | URS-01 | `server/firebaseAuth.ts` (`verifyIdToken(..., true)` con comprobación de revocación y `email_verified`), `src/lib/AuthContext.tsx` (cierre automático tras 15 min de inactividad y sondeo `/api/me`). |
| **FS-02** | URS-02 | `src/components/layout/AppShell.tsx` (enrolamiento TOTP `startTotpEnrollment`/`finalizeTotpEnrollment`), `server/studyAccess.ts` (`403 MFA_REQUIRED_BY_STUDY`) y `firestore.rules` (`satisfiesStudyMfa(projectId)`). |
| **FS-03** | URS-03 | Matriz de permisos `ROLE_PERMISSIONS` en `server/studyAccess.ts`, aislamiento por `memberIds` y rol en `firestore.rules`, ocultación y bloqueo funcional en `src/pages/ProjectPage.tsx`. |
| **FS-04** | URS-04 | `server/pseudonymizer.ts` (`sealIdentityPayload` AES-256-GCM v1/v2, `unsealIdentityPayload`, `computeParticipantBlindIndex`, `assertNonIdentifiableResearchId`), endpoints `/api/pseudonymize/seal` y `/unseal`, y `VaultConsentTab.tsx`. |
| **FS-05** | URS-05 | `recordConsent`, `updateConsentStatus` y `assertConsentEligibleForCapture` en `src/lib/firestoreDb.ts`, sincronizado con colección `consentStates/{subjectPseudoId}` y validado en `firestore.rules`. |
| **FS-06** | URS-06 | `cleanRecordInput`, `createFormRecord`, `updateFormRecord`, `transitionFormRecordStatus`, `reopenFormRecord` en `src/lib/firestoreDb.ts`; visor `CrfVersionEntry` y bloqueo en `FormFillPage.tsx`; inmutabilidad de `crfVersions` en `firestore.rules`. |
| **FS-07** | URS-07 | `POST /api/parse-tabular` en `server/apiRouter.ts` (parsing CSV con PapaParse y Excel con `xlsx`), detección de columnas identificativas (`isLikelyIdentifierVariable`, `scanForPii`) y `uploadDataset` / `createFormFromDataset` en `firestoreDb.ts`. |
| **FS-08** | URS-08 | `MonitoringTab.tsx`, botón Query en `FormFillPage.tsx`, `createClinicalQuery`, `respondClinicalQuery`, `transitionClinicalQuery`, `createProtocolDeviation`, `updateProtocolDeviation` en `firestoreDb.ts` y reglas `queries`/`deviations` en `firestore.rules`. |
| **FS-09** | URS-09 | `MembersTab.tsx`, `ProjectPage.tsx` badge, `getStudyLifecycle`, `updateStudyStatus`, `addStudyAmendment`, `assertStudyOpenForCapture`, `assertStudyUnlockedForCrfReview` y `isStudyOpenForCapture` / `isStudyUnlockedForCrfReview` en `firestore.rules`. |
| **FS-10** | URS-10 | `POST /api/signatures/sign` en `server/apiRouter.ts` (`auth_time <= 300s`), `signElectronicAttestation` / `verifyElectronicAttestation` en `server/auditChain.ts`, `reauthenticateSession` en `AuthContext.tsx` y `ElectronicApprovalModal.tsx`. |
| **FS-11** | URS-11 | `POST /api/audit/sign` y `/api/audit/verify` en `server/apiRouter.ts`, `signAuditEntry` / `verifyAuditChain` / `logSecurityEvent(..., { worm_audit: true })` en `server/auditChain.ts`, shards `meta/shard_auditLogIds_*` y `appendAuditLog(..., { strict: true })`. |
| **FS-12** | URS-12 | `POST /api/analyze` y `server/statsEngine.ts` con implementación determinista en TypeScript de las 21 pruebas bioestadísticas, gráficos Recharts y guardado en `savedAnalyses`. |
| **FS-13** | URS-13 | `POST /api/exports/dataset` en `server/apiRouter.ts` con límite de filas para `investigador`/`estadistico`, eliminación de PII salvo permiso explícito con motivo, `sanitizeCsvCell()` y cabecera/payload SHA-256. |
| **FS-14** | URS-14 | `DEFAULT_STUDY_GOVERNANCE` (IA apagada por defecto), `server/piiGuard.ts` (`scanForPii`, `scanFormMetadataForPii`, `scanDatasetMetadataForPii`, `redactPii`) aplicado antes de `geminiFormExtractor.ts` y `geminiCopilot.ts`. |
| **FS-15** | URS-15 | `server/envConfig.ts` (segregación `VAULT_ENCRYPTION_SECRET` vs `AUDIT_HMAC_SECRET`, keyring histórico, fail-closed prod), `scripts/backup-verify.ts` y `scripts/gcp-infra-setup.sh`. |
