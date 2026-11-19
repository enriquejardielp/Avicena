# Matriz de Trazabilidad de Validación (RTM) — Avicena

**Documento:** CSV-RTM-001 · **Versión:** 1.0  
**Leyenda de estado:** `VERIFICADO` (probado en suite/código), `IMPLEMENTADO NO VERIFICADO` (requiere emulador/E2E navegador), `PARCIAL` (requiere paso de infraestructura GCP/Console).

| URS | FS | Riesgo | Implementación en Código / Reglas | Verificación / Protocolo Asociado | Estado actual |
|---|---|---|---|---|---|
| **URS-01** | FS-01 | R-05 | `server/firebaseAuth.ts`, `src/lib/AuthContext.tsx` | Test 1 (`tests/security-remediation.test.ts`) + `OQ-01` | **VERIFICADO (API)** / **IMPLEMENTADO NO VERIFICADO (UI 15m)** |
| **URS-02** | FS-02 | R-05 | `AppShell.tsx`, `server/studyAccess.ts`, `firestore.rules` | Test 7 (`tests/security-remediation.test.ts`) + `IQ-04` / `OQ-02` | **PARCIAL** (pendiente activar Identity Platform en Firebase Console) |
| **URS-03** | FS-03 | R-01 | `server/studyAccess.ts`, `firestore.rules`, `ProjectPage.tsx` | Test 2 (`tests/security-remediation.test.ts`) + `OQ-03` | **VERIFICADO (API)** / **IMPLEMENTADO NO VERIFICADO (Reglas en emulador)** |
| **URS-04** | FS-04 | R-01, R-07 | `server/pseudonymizer.ts`, `VaultConsentTab.tsx`, `firestore.rules` | Test 3 + `scripts/backup-verify.ts` + `OQ-04` | **PARCIAL** (lógica verificada; separación física en `avicena-vault-prod` pendiente) |
| **URS-05** | FS-05 | R-02 | `firestoreDb.ts`, `VaultConsentTab.tsx`, `firestore.rules` | `OQ-05` | **IMPLEMENTADO NO VERIFICADO** |
| **URS-06** | FS-06 | R-02 | `firestoreDb.ts`, `FormFillPage.tsx`, `firestore.rules` | `OQ-06` + `PQ-01` | **IMPLEMENTADO NO VERIFICADO** |
| **URS-07** | FS-07 | R-08 | `server/apiRouter.ts` (`/parse-tabular`), `DataTab.tsx`, `firestoreDb.ts` | Test 12 (`tests/security-remediation.test.ts`) + `PQ-02` | **VERIFICADO (Backend XLSX/CSV)** / **IMPLEMENTADO NO VERIFICADO (UI)** |
| **URS-08** | FS-08 | R-02 | `MonitoringTab.tsx`, `FormFillPage.tsx`, `firestoreDb.ts`, `firestore.rules` | `OQ-07` + `PQ-03` | **IMPLEMENTADO NO VERIFICADO** |
| **URS-09** | FS-09 | R-02 | `MembersTab.tsx`, `ProjectPage.tsx`, `FormFillPage.tsx`, `firestore.rules` | `OQ-08` | **IMPLEMENTADO NO VERIFICADO** |
| **URS-10** | FS-10 | R-05 | `/api/signatures/sign`, `server/auditChain.ts`, `ElectronicApprovalModal.tsx`, `AuthContext.tsx` | Test 11 (`tests/security-remediation.test.ts`) + `OQ-09` | **VERIFICADO (API/HMAC)** / **IMPLEMENTADO NO VERIFICADO (Modal E2E)** |
| **URS-11** | FS-11 | R-04, R-06 | `server/auditChain.ts`, `firestoreDb.ts` (`strict: true` + shards), `firestore.rules` | Test 4 + `IQ-03` + `OQ-10` | **PARCIAL** (cadena HMAC verificada; Sink WORM GCP pendiente) |
| **URS-12** | FS-12 | R-09 | `server/statsEngine.ts`, `AnalysisTab.tsx`, `SavedAnalysesTab.tsx` | Test 10 (21 pruebas) + `PQ-04` | **VERIFICADO (Motor 21 pruebas)** |
| **URS-13** | FS-13 | R-08 | `/api/exports/dataset`, `DataTab.tsx` | Test 6 (`tests/security-remediation.test.ts`) + `OQ-11` | **VERIFICADO (API/CSV)** |
| **URS-14** | FS-14 | R-03 | `server/piiGuard.ts`, `server/studyAccess.ts`, `CopilotTab.tsx`, `FormFillPage.tsx` | Tests 5 y 13 (`tests/security-remediation.test.ts`) + `OQ-12` | **VERIFICADO (Backend PII & Gobernanza)** |
| **URS-15** | FS-15 | R-07 | `server/envConfig.ts`, `scripts/backup-verify.ts`, `scripts/gcp-infra-setup.sh` | Tests 8 y 9 + `backup-verify.ts` + `IQ-01`..`IQ-05` | **PARCIAL** (código/drill verificados; infraestructura GCP destino pendiente) |
