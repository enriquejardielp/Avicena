# Informe Preliminar de Validación del Sistema Informatizado (CSV) — Avicena

**Documento:** CSV-VALREP-001 · **Versión:** 1.0 (Pre-ejecución IQ/OQ/PQ en Staging)  
**Sistema:** Avicena EDC/eCRF · **ID Applet:** `e13ab1b8-5137-4abd-b989-6b22ee763840`

---

## 1. Declaración de Uso Previsto (Intended Use)

Avicena está diseñada como plataforma electrónica de captura de datos clínicos (eCRF/EDC), gestión pseudonimizada de participantes, seguimiento de consentimientos informados, monitorización clínica (queries SDV y desviaciones/CAPA), gestión de ciclo de vida del protocolo y cálculo bioestadístico determinista para estudios biomédicos observacionales y ensayos clínicos académicos o institucionales.

**Limitación explícita de alcance:** La firma electrónica implementada en Avicena constituye una **aprobación electrónica interna con reautenticación reciente y sellado HMAC-SHA256** alineada con la trazabilidad de 21 CFR Part 11 e ICH E6(R3); **no** sustituye a una Firma Electrónica Cualificada (QES) conforme al Reglamento eIDAS para contratos legales externos o consentimientos informados electrónicos cualificados si la autoridad nacional exigiera QES.

---

## 2. Resumen de Verificación Ejecutada hasta la Fecha

| Actividad | Resultado | Evidencia |
|---|---|---|
| Compilación TypeScript/Vite (`compile_applet`) y ESLint (`lint_applet`) | Ejecutado y verificado al cierre de la fase técnica | Reporte de build en entorno de validación |
| Validación sintáctica y despliegue de `firestore.rules` | Aprobado (`npx eslint firestore.rules` exit 0 + `DeployRules`) | `/firestore.rules` desplegado en proyecto sandbox |
| Suite automatizada de seguridad, RBAC, PII, firma electrónica, XLSX y 21 pruebas estadísticas | 13 bloques ejecutados con datos sintéticos (`tests/security-remediation.test.ts`) | Salida `node --test` |
| Simulacro criptográfico de respaldo y restauración | Verificado (`scripts/backup-verify.ts`) | Hash SHA-256, rotación de claves y cadena HMAC íntegra |

---

## 3. Desviaciones y Elementos Pendientes para Liberación a Producción

1. **Provisionamiento de infraestructura GCP/Firebase externa (`INF-01`..`INF-08`)**: Ejecución de `scripts/gcp-infra-setup.sh` en proyectos aislados (`dev`, `staging`, `prod`, `vault`), habilitación de Secret Manager, Cloud Logging WORM Sink con Bucket Lock, Firestore PITR, App Check (reCAPTCHA Enterprise) e Identity Platform TOTP.
2. **Ejecución formal de IQ/OQ/PQ en entorno `staging`**: Completar todos los casos de `docs/validation/IQ_OQ_PQ_PROTOCOLS.md` (incluyendo pruebas de reglas con Firebase Emulator y comparación estadística cruzada PQ-04 contra R/SAS).
3. **Documentación jurídica y ética del estudio concreto**: Aprobación de EIPD/DPIA por el DPD/DPO, dictamen favorable del CEIm y firma de DPA si se decide activar el módulo opcional de IA.

---

## 4. Aprobación y Liberación (Pendiente de Firma Humana)

> **Estado actual de liberación:** **NO LIBERADO A PRODUCCIÓN CON DATOS REALES** (pendiente de ejecución de IQ/OQ/PQ en `staging` y firma de los responsables abajo indicados).

| Rol | Nombre y Apellidos | Dictamen (Aprobado / Rechazado) | Fecha | Firma |
|---|---|---|---|---|
| **Investigador Principal / Promotor** | ___________________________ | ___________________ | ____-__-__ | ______________ |
| **Responsable de Calidad (QA / CSV)** | ___________________________ | ___________________ | ____-__-__ | ______________ |
| **Delegado de Protección de Datos (DPO)** | ___________________________ | ___________________ | ____-__-__ | ______________ |
| **Responsable Técnico / CISO** | ___________________________ | ___________________ | ____-__-__ | ______________ |
