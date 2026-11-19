# Informe Técnico de Seguridad, Privacidad y Gobernanza Clínica — Avicena

**Subtítulo:** Arquitectura EDC/eCRF, criptografía, control de accesos RBAC, integridad ALCOA+ y privacidad frente a IA  
**Fecha:** 2026-11-19  
**Sistema:** Avicena EDC/eCRF & Bioestadística  
**Audiencia:** CISOs, Delegados de Protección de Datos (DPO), QA/CSV, Auditores GCP y Comités Éticos (CEIm)

---

## 01. Arquitectura general y defensa en profundidad

Avicena separa el plano de presentación React/Vite, el servidor autoritativo Express (`/api/*`), las reglas declarativas de Firestore y una bóveda lógica cifrada para datos identificativos.

### Modelo de capas y superficie de ejecución

Todas las operaciones sensibles —emisión y descifrado de pseudónimos, firma HMAC de auditoría, aprobaciones electrónicas reautenticadas, importación/exportación tabular, cálculo bioestadístico y mediación con IA externa— pasan por endpoints autoritativos en Express (`server/apiRouter.ts`) tras verificar la identidad y los permisos del solicitante.

Las colecciones clínicas almacenadas en Firestore están protegidas adicionalmente por reglas declarativas estrictas (`firestore.rules`) que validan pertenencia al estudio, rol, estado del ciclo de vida del estudio, presencia de segundo factor TOTP cuando el estudio lo exige y esquemas de validación por documento.

- **Frontend:** React 19 + TypeScript + Vite SPA
- **Backend autoritativo:** Node.js + Express (`server/apiRouter.ts`)
- **Base de datos y Auth:** Firebase Auth + Cloud Firestore
- **Cálculo bioestadístico:** 21 pruebas deterministas en servidor propio (`server/statsEngine.ts`)

### Endurecimiento de API y configuración fail-closed

En arranque productivo (`APP_ENV=production`), `server/envConfig.ts` impide iniciar la aplicación si faltan secretos dedicados, si se detectan secretos débiles o idénticos entre auditoría y bóveda, o si CORS incluye comodines (`*`) u orígenes locales.

- CORS estricto por lista blanca (`CORS_ALLOWED_ORIGINS`) y rechazo explícito de orígenes no autorizados.
- Cabeceras HTTP defensivas: `Cache-Control: no-store`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y CSP restrictiva.
- Limitación de tasa (rate limiting) diferenciada para endpoints de autenticación, pseudonimización, exportación e IA.
- Redacción automática de PII y secretos en logs de servidor mediante `redactSensitiveText` (`server/piiGuard.ts`).

---

## 02. Criptografía, bóveda de identidad y rotación de claves

Los datos identificativos de los participantes nunca se utilizan como clave primaria clínica: se cifran en una bóveda lógica dedicada con rotación de claves sin pérdida de descifrado histórico.

### Pseudonimización y separación lógica

Al registrar un participante (`POST /api/pseudonymize/issue`), Avicena genera un identificador de estudio aleatorio (`subjectPseudoId`) y calcula índices ciegos deterministas (`blindIndexes`) mediante HMAC-SHA256 normalizado sobre documento/identificador nacional e historia clínica para detectar duplicados sin almacenar texto claro ni exponer el identificador real.

Los datos identificativos (nombre completo, documento de identidad, teléfono, correo, fecha de nacimiento o número de historia) se encapsulan en `/projects/{projectId}/identityVault/{subjectPseudoId}` cifrados con AES-256-GCM. Las variables clínicas (`crfRecords` y `datasets`) solo referencian el pseudónimo.

- **Cifrado de bóveda:** AES-256-GCM autenticado (formatos `aes-256-gcm-v1` y `v2` con `keyId`)
- **Prevención de duplicados:** HMAC-SHA256 (`blindIndexes`) con normalización previa
- **Segregación de secretos:** `VAULT_ENCRYPTION_SECRET` separado de `AUDIT_HMAC_SECRET`
- **Rotación sin ruptura:** `VAULT_KEY_ID` + `VAULT_PREVIOUS_SECRETS` / `AUDIT_HMAC_PREVIOUS_SECRETS`

### Reidentificación controlada y auditada

El acceso en claro a una entrada de la bóveda (`POST /api/pseudonymize/unseal`) está restringido exclusivamente a roles autorizados (investigador principal / coordinador clínico), exige motivo justificado obligatorio y genera un evento estricto en la cadena de auditoría antes de devolver los datos.

> **Nota arquitectónica:** en el entorno sandbox actual, la bóveda y las colecciones clínicas comparten instancia lógica de Firestore; para separación física en proyectos GCP distintos (`avicena-vault-prod` vs `avicena-prod`) se proporciona el aprovisionamiento automatizado en `scripts/gcp-infra-setup.sh`.

---

## 03. Autenticación, doble factor (MFA) y RBAC de 7 roles

Cada petición a `/api/*` y cada lectura/escritura en Firestore valida identidad revocable, verificación de correo, política MFA del estudio y matriz de permisos mínimos por rol.

### Ciclo de sesión y segundo factor (TOTP)

El backend verifica los tokens JWT de Firebase mediante `verifyIdToken(token, true)` con comprobación activa de tokens revocados (`auth/id-token-revoked`) y bloquea cuentas sin correo verificado (`email_verified === true`).

En cliente (`src/lib/AuthContext.tsx`), la sesión se cierra automáticamente tras 15 minutos de inactividad. Cuando un estudio activa `requireMfa: true` en `governance/settings`, tanto el backend (`server/studyAccess.ts` -> HTTP `403 MFA_REQUIRED_BY_STUDY`) como `firestore.rules` (`satisfiesStudyMfa` -> `hasMfaClaim`) rechazan cualquier acceso sin segundo factor TOTP verificado.

### Matriz de roles y mitigación IDOR

El sistema aplica 7 roles clínicos y operativos diferenciados. Los permisos se validan tanto en la API Express como en `firestore.rules`, eliminando enumeración masiva (`allow list: if false` en colecciones sensibles) y aislando por completo al soporte técnico de la información clínica.

- **admin (Investigador Principal):** gobierno del estudio, ciclo de vida, enmiendas, gestión de equipo, CRF, firma electrónica y reidentificación auditada.
- **coordinador:** gestión operativa del estudio, alta/edición CRF, consentimientos, resolución de queries y reidentificación justificada.
- **investigador:** diseño y captura CRF, análisis estadístico, respuesta a queries y visualización clínica seudonimizada.
- **capturador:** entrada de datos CRF y respuesta a queries asignadas; sin exportación de bases ni acceso a bóveda de identidad.
- **monitor_clinico:** lectura clínica, revisión SDV, apertura/cierre de queries de monitorización, registro de desviaciones CAPA y auditoría; sin edición directa de valores CRF.
- **estadistico:** análisis bioestadístico y exportación controlada de datasets seudonimizados; sin acceso a `identityVault`.
- **admin_tecnico:** acceso exclusivo a diagnóstico operativo/auditoría técnica; bloqueado explícitamente en backend, Firestore Rules e interfaz frente a datos clínicos, CRF, bóveda de identidad e IA.

---

## 04. Integridad clínica ALCOA+, monitorización y firma electrónica

Avicena implementa versionado inmutable de CRF, bloqueo de registros, flujo SDV de queries, desviaciones CAPA, control de ciclo de vida del estudio y aprobación electrónica con reautenticación reciente.

### Trazabilidad de registros y flujo clínico

Cada cambio sobre un registro CRF exige motivo de modificación y conserva una instantánea previa en `crfVersions`. Los registros en estado `verificado` o `bloqueado` impiden ediciones directas hasta su reapertura formal.

El ciclo de vida del estudio (`borrador`, `reclutamiento`, `seguimiento`, `cerrado`, `bloqueado`, `archivado`) y el historial cronológico de enmiendas de protocolo bloquean cualquier nueva captura tanto en UI (`FormFillPage.tsx`) como en `firestore.rules` (`isStudyOpenForCapture`, `isStudyUnlockedForCrfReview`).

- **Monitorización SDV (queries):** apertura y cierre reservados a monitorización/IP; respuesta y corrección trazadas por hilo en `MonitoringTab.tsx` y `FormFillPage.tsx`.
- **Desviaciones y CAPA:** registro inmutable de desviaciones de protocolo con severidad, impacto y plan de acción correctiva/preventiva.
- **Particionado de índices Firestore:** `meta/shard_<tipo>_<n>` con límite de 2.000 IDs por shard, evitando alcanzar el límite de 1 MiB por documento en estudios longitudinales.

### Aprobación electrónica reautenticada (alcance regulatorio explícito)

Las acciones críticas (verificación SDV, bloqueo/reapertura CRF y bloqueo/archivo/reapertura del estudio) invocan `POST /api/signatures/sign` exigiendo el permiso `signature.sign` y una reautenticación fresca con `auth_time <= 300` segundos (HTTP `403 REAUTH_REQUIRED` si la sesión supera los 5 minutos).

El servidor emite un manifiesto firmado con HMAC-SHA256 (`signatureLevel: "reauthenticated_hmac_attestation"`). **Transparencia regulatoria:** este mecanismo constituye una aprobación electrónica interna alineada con 21 CFR Part 11 e ICH E6(R3), y **no** equivale jurídicamente a una Firma Electrónica Cualificada (QES) eIDAS ni sustituye certificados digitales cualificados cuando la legislación local los exija.

---

## 05. Auditoría encadenada, privacidad ante IA y exportaciones

Cada mutación crítica se sella en una cadena HMAC-SHA256 fail-closed con emisión lista para almacenamiento WORM, mientras que la bioestadística opera en local sin IA externa.

### Cadena criptográfica de auditoría (HMAC-SHA256)

Cada entrada en `auditLogs` enlaza el hash del evento previo (`prevHash`) con el hash HMAC-SHA256 actual firmado con `AUDIT_HMAC_SECRET` (con soporte de verificación multi-versión ante rotación). Las operaciones clínicas y de gobernanza ejecutan `appendAuditLog(..., { strict: true })`, abortando en cerrado si falla la escritura o la firma de auditoría.

Adicionalmente, el servidor emite logs JSON estructurados con marcador `worm_audit: true` diseñados para su ingesta directa por Cloud Logging Sink hacia un bucket GCS bloqueado con Retention Policy (Bucket Lock).

### Bioestadística local, PII Guard e IA desactivada por defecto

Las 21 pruebas bioestadísticas se ejecutan de forma 100% determinista en el servidor de Avicena (`server/statsEngine.ts`) sin llamadas a modelos generativos.

La integración opcional con Gemini está desactivada por defecto, requiere consentimiento expreso de gobernanza y confirmación de DPA firmado, nunca recibe filas crudas de pacientes en el copiloto bioestadístico y atraviesa `server/piiGuard.ts` antes de cualquier llamada externa.

- **PII Guard conservador:** bloquea DNI/NIE (incluyendo formatos con puntos o espacios), pasaportes, NHC/CIP/SIP, correos, teléfonos, fechas de nacimiento, direcciones postales, nombres con y sin etiqueta, fragmentación evasiva, metadatos de formulario y niveles/categorías de datasets.
- **Exportación segura CSV (`POST /api/exports/dataset`):** excluye columnas identificativas por defecto, neutraliza inyección de fórmulas (`=`, `+`, `-`, `@`, `\t`, `\r`), calcula checksum SHA-256 y exige justificación auditada.

---

## 06. Estado verificado vs. requisitos externos de producción

Avicena distingue con rigor entre los controles ya verificados en código y pruebas automatizadas y los requisitos externos de Google Cloud, validación IQ/OQ/PQ y cumplimiento legal.

### Evidencia verificada en el repositorio actual

Las reglas Firestore (`firestore.rules`) superan el linter oficial con 0 errores y están desplegadas en la base del proyecto. La suite independiente `tests/security-remediation.test.ts` ejecuta 13 bloques de verificación junto con el simulacro de copia y restauración `scripts/backup-verify.ts`.

### Prerrequisitos externos obligatorios antes de datos clínicos reales

- **Infraestructura GCP dedicada (`scripts/gcp-infra-setup.sh`):** proyectos aislados `dev` / `staging` / `prod` / `vault`, Google Cloud Secret Manager, Cloud Logging Sink a GCS con Bucket Lock WORM, Firestore PITR, copias cifradas externas y App Check con reCAPTCHA Enterprise en modo *Enforce*.
- **Autenticación gestionada:** habilitación efectiva de Identity Platform con TOTP en el tenant productivo de Firebase Console.
- **Validación y gobernanza humana:** ejecución formal de los protocolos IQ/OQ/PQ (`docs/validation/IQ_OQ_PQ_PROTOCOLS.md`) en `staging`, validación cruzada estadística frente a R/SAS, firma de EIPD/DPIA por el DPO, dictamen favorable del CEIm/IRB y firma del DPA si se activa Gemini.

---

## 07. Matriz consolidada de controles verificados vs. requisitos externos

| Dominio | Control | Estado | Implementación verificada | Requisito externo / aclaración |
|---|---|---|---|---|
| Autenticación y sesión | Tokens revocables, email verificado, timeout 15 min y TOTP MFA | **VERIFICADO** | `verifyIdToken(..., true)`, `AuthContext.tsx`, `server/studyAccess.ts` y `firestore.rules` (`satisfiesStudyMfa`) | Activar Identity Platform TOTP en Firebase Console del tenant productivo |
| Control de acceso (RBAC) | 7 roles, anti-IDOR, `allow list: false` y aislamiento de `admin_tecnico` | **VERIFICADO** | `server/studyAccess.ts`, `firestore.rules` y separación en `ProjectPage.tsx` | Ejecutar pruebas unitarias en vivo con emulador Firestore durante IQ/OQ en staging |
| Pseudonimización | Bóveda AES-256-GCM v1/v2, índices ciegos HMAC y rotación de secretos | **VERIFICADO** | `server/pseudonymizer.ts`, `server/envConfig.ts` y `POST /api/pseudonymize/*` | Separación física en proyecto GCP `avicena-vault-prod` vía `scripts/gcp-infra-setup.sh` |
| Integridad ALCOA+ | `crfVersions`, bloqueo CRF/estudio, queries SDV, CAPA y shards 2.000 IDs | **VERIFICADO** | `MonitoringTab.tsx`, `FormFillPage.tsx`, `MembersTab.tsx`, `firestoreDb.ts` y `firestore.rules` | Procedimentación operativa mediante los 9 PNTs/SOPs de `docs/operations/` |
| Aprobación electrónica | Firma HMAC con reautenticación reciente (`auth_time <= 300s`) | **VERIFICADO** | `POST /api/signatures/sign`, `ElectronicApprovalModal.tsx` y `server/auditChain.ts` | Aprobación interna tipo 21 CFR Part 11; no sustituye QES eIDAS cualificada |
| Auditoría inmutable | Cadena HMAC-SHA256 fail-closed (`strict: true`) y logs `worm_audit: true` | **VERIFICADO** | `server/auditChain.ts` y `meta/shard_auditLogIds_*` | Conectar Cloud Logging Sink -> GCS Bucket Lock WORM en GCP producción |
| Privacidad ante IA | IA apagada por defecto, opt-in + DPA, 21 tests locales y PII Guard ampliado | **VERIFICADO** | `server/piiGuard.ts`, `server/statsEngine.ts` y `/api/ai/chat` | Firma de DPA y revisión humana ante texto libre no estructurado |
| Infraestructura y RGPD | Secret Manager, PITR, App Check Enforce, EIPD/DPIA y dictamen CEIm | **PARCIAL / INFRA EXTERNA** | Parametrizado en `scripts/gcp-infra-setup.sh`, `docs/validation/*` y `docs/compliance/*` | Requiere provisión en la organización GCP del promotor y firma formal DPO/CEIm/QA |
