# Protocolos de Cualificación IQ / OQ / PQ — Avicena EDC/eCRF

**Documento:** CSV-PROTO-001 · **Versión:** 1.0 · **Entorno de ejecución requerido:** Proyecto `avicena-staging` con datos estrictamente sintéticos.

---

## 1. Cualificación de la Instalación (IQ — Installation Qualification)

| Caso | Objetivo | Pasos de verificación | Criterio de aceptación |
|---|---|---|---|
| **IQ-01** | Verificar aislamiento de proyectos GCP y Secret Manager | Ejecutar `scripts/gcp-infra-setup.sh` en proyectos `dev`, `staging`, `prod` y `vault`; listar secretos en Secret Manager. | Proyectos separados creados; `AUDIT_HMAC_SECRET`, `VAULT_ENCRYPTION_SECRET` y `GEMINI_API_KEY` existen en Secret Manager sin reutilización entre entornos. |
| **IQ-02** | Verificar despliegue Cloud Run en `APP_ENV=production` y región UE | Desplegar contenedor Cloud Run con `ALLOWED_ORIGINS` HTTPS y comprobar respuesta de `/api/health` y fallo seguro sin secretos. | Servicio activo en `europe-west1`; cabeceras `X-Content-Type-Options: nosniff` y `Cache-Control: no-store`; fallo en arranque si faltan variables obligatorias. |
| **IQ-03** | Verificar despliegue de `firestore.rules`, PITR y Sink WORM | Ejecutar `npx eslint firestore.rules`, `firebase deploy --only firestore:rules`, verificar `--enable-pitr` y Sink `avicena-worm-audit-sink`. | Linter exit 0; evento de prueba con `worm_audit: true` aparece en bucket GCS WORM dentro de los 5 minutos siguientes. |
| **IQ-04** | Verificar App Check e Identity Platform MFA | Habilitar Identity Platform TOTP y App Check (reCAPTCHA Enterprise) en Firebase Console y activar *Enforce*. | Peticiones sin cabecera `X-Firebase-AppCheck` válida son rechazadas; usuario puede vincular TOTP desde `AppShell`. |
| **IQ-05** | Verificar ejecución limpia de pruebas automatizadas y build | Ejecutar `npm run build`, `npm run lint`, `npx tsx --test tests/security-remediation.test.ts` y `npx tsx scripts/backup-verify.ts`. | 0 errores de compilación/lint; 13/13 bloques de prueba y simulacro de backup aprobados. |

---

## 2. Cualificación Operacional (OQ — Operational Qualification)

| Caso | Requisito | Procedimiento de prueba con cuentas sintéticas | Resultado esperado |
|---|---|---|---|
| **OQ-01** | Auth y timeout | Iniciar sesión con cuenta no verificada; iniciar sesión con cuenta verificada y esperar 15 min de inactividad. | Cuenta no verificada bloqueada; sesión verificada se cierra automáticamente tras 15 min. |
| **OQ-02** | MFA obligatorio por estudio | Activar `require_mfa` en un estudio; intentar operar con usuario sin TOTP vs usuario con TOTP. | Backend responde `403 MFA_REQUIRED_BY_STUDY` y Firestore Rules rechazan la lectura/escritura sin claim MFA. |
| **OQ-03** | Segregación RBAC 7 roles | Iniciar sesión como `admin_tecnico`, `estadistico`, `monitor_clinico` y `capturador` en un mismo estudio sintético. | `admin_tecnico` solo ve Auditoría y Equipo (solo lectura); `estadistico` no ve CRFs ni bóveda; `capturador` solo ve sus propios CRF. |
| **OQ-04** | Bóveda y reidentificación | Registrar sujeto sintético en `VaultConsentTab`, intentar duplicar mismo DNI sintético, y reidentificar con rol `coordinador` y `investigador`. | Duplicado bloqueado por `blindIndexes`; `investigador` denegado; `coordinador` descifra con motivo y deja entrada en `AuditTab`. |
| **OQ-05** | Bloqueo por consentimiento | Activar `require_active_consent`, registrar consentimiento `retirado` e intentar crear CRF para ese sujeto. | Creación bloqueada en `createFormRecord` y `firestore.rules`. |
| **OQ-06** | Versionado y bloqueo CRF | Crear CRF (`v1`), editar con motivo (`v2`), consultar diff en `Versiones`; intentar editar sin motivo o en estado `verificado`. | `v2` muestra diff anterior/nuevo y motivo; edición directa en `verificado` bloqueada. |
| **OQ-07** | Queries y desviaciones | Como `monitor_clinico`, abrir query sobre variable; responder como `capturador`; cerrar como `monitor_clinico`; crear y cerrar desviación CAPA. | Flujo completo trazado en `MonitoringTab` y `AuditTab`; sin botón de borrado en UI ni reglas. |
| **OQ-08** | Ciclo de vida y enmiendas | Registrar enmienda `v2.0`; pasar estudio a `cerrado` y `bloqueado`; intentar capturar CRF nuevo o editar existente. | Captura bloqueada tanto en UI (`FormFillPage`) como en `firestore.rules`. |
| **OQ-09** | Firma electrónica reautenticada | Hacer clic en `Verificar (SDV)` en un CRF; introducir contraseña errónea; repetir con contraseña válida. | Contraseña errónea rechazada; reautenticación válida emite manifiesto `reauthenticated_hmac_attestation` visible en `MonitoringTab`. |
| **OQ-10** | Cadena de auditoría HMAC | Descargar logs en `AuditTab` y ejecutar verificación de integridad (`POST /api/audit/verify`). | Verificación devuelve `valid: true`; alteración simulada de un campo rompe la cadena en el índice manipulado. |
| **OQ-11** | Exportación controlada | Exportar dataset como `investigador` vs `admin` con y sin identificadores. | `investigador` recibe CSV pseudonimizado con hash SHA-256 y columnas PII eliminadas; celdas con `=` neutralizadas. |
| **OQ-12** | Bloqueo PII en IA | Activar IA tras DPA; intentar enviar nota con DNI/teléfono sintético o etiqueta con correo en CRF. | `POST /api/forms/extract` y `POST /api/ai/chat` bloquean con `422 PII_DETECTED` sin invocar a Gemini. |

---

## 3. Cualificación del Desempeño (PQ — Performance Qualification)

| Caso | Escenario clínico completo (End-to-End en `staging`) | Criterio de aceptación |
|---|---|---|
| **PQ-01** | Flujo multicéntrico completo de 10 sujetos sintéticos: alta en bóveda -> consentimiento vigente -> captura CRF -> edición con motivo -> SDV firmado -> bloqueo -> reapertura con firma. | 100% de transiciones auditadas, versiones completas en `crfVersions` y verificación de cadena HMAC exitosa. |
| **PQ-02** | Subida de cuaderno Excel (`.xlsx`) con 50 filas sintéticas y continuación de captura de 5 nuevos pacientes mediante el auto-CRF generado. | Dataset sincroniza `n_rows = 55`, preserva los 50 iniciales y añade los 5 CRF sin pérdida ni corrupción de tipos. |
| **PQ-03** | Ciclo completo de monitorización: apertura de 3 queries sobre CRF, resolución por centro, registro de 1 desviación mayor con cierre CAPA y transición del estudio a `Database Lock` con reautenticación. | 0 queries abiertas antes del *Database Lock*; estudio bloqueado impide cualquier escritura clínica posterior. |
| **PQ-04** | Validación cruzada de resultados bioestadísticos (t-Student, Chi², regresión logística, Kaplan-Meier, Cox) frente a software de referencia (R / SPSS) sobre dataset sintético de control. | Coincidencia de estadísticos, intervalos de confianza y p-valores dentro de tolerancia numérica (`< 1e-4`). |
