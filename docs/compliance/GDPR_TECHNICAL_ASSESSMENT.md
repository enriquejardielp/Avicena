# Evaluación Técnica de Cumplimiento RGPD / GDPR — Avicena

**Marco normativo:** Reglamento (UE) 2016/679 (RGPD), Ley Orgánica 3/2018 (LOPDGDD, Disposición adicional decimoséptima sobre investigación biomédica), y directrices del CEPD sobre datos de salud e investigación científica.

---

## 1. Delimitación estricta de responsabilidades

Avicena proporciona la **plataforma técnica EDC/eCRF** (medidas técnicas de seguridad, pseudonimización, minimización, trazabilidad y gobernanza). El **cumplimiento jurídico-administrativo** corresponde al **Responsable del Tratamiento** (hospital, universidad, instituto de investigación sanitaria o promotor del estudio).

---

## 2. Mapeo de requisitos RGPD: controles técnicos vs. deberes organizativos

| Artículo RGPD | Requisito | Controles técnicos verificados en Avicena | Deberes obligatorios del Responsable / Promotor |
|---|---|---|---|
| **Art. 5.1.b y 5.1.c** (Limitación de finalidad y minimización) | Recoger solo datos necesarios y separados por estudio. | Separación por `projectId`, exportación pseudonimizada por defecto (elimina columnas identificativas en `POST /api/exports/dataset`), y segregación total de `admin_tecnico` sin acceso clínico. | Definir en el protocolo las variables estrictamente necesarias y evitar campos libres innecesarios. |
| **Art. 6.1 y 9.2.j** (Licitud y categoría especial de salud) | Base jurídica y consentimiento o interés público/investigación. | Módulo de registro de consentimientos informados (`consentRecords`, `consentStates`) con bloqueo automático de captura CRF si el consentimiento está `retirado`, `pendiente` o `requiere_reconsentimiento` (cuando `require_active_consent` está activo). | Recabar dictamen favorable del **CEIm**, firmar hojas de información al paciente y documentar la base jurídica en el Registro de Actividades de Tratamiento (RAT). |
| **Art. 15–22** (Derechos de los interesados) | Acceso, rectificación, supresión/limitación y portabilidad. | Búsqueda por `subjectPseudoId` en bóveda (`reidentifySubject` auditado con motivo), historial de rectificaciones versionado (`crfVersions`), retirada de consentimiento (`updateConsentStatus`) que bloquea capturas futuras, y eliminación controlada del estudio (`deleteProject`). | Establecer procedimiento de atención de derechos (plazo 1 mes) evaluando la excepción del Art. 17.3.d cuando la supresión imposibilite los objetivos de investigación. |
| **Art. 25** (Privacidad desde el diseño y por defecto) | Pseudonimización, cifrado y mínimos privilegios por defecto. | Pseudonimización obligatoria (`SUBJ-...`), bóveda `identityVault` cifrada con **AES-256-GCM** y clave separada `VAULT_ENCRYPTION_SECRET`, índices ciegos HMAC para evitar duplicados sin exponer identidad, e IA externa **desactivada por defecto** (`DEFAULT_STUDY_GOVERNANCE`). | Mantener `require_mfa: true` y `require_active_consent: true` en todos los estudios con datos reales. |
| **Art. 28 y Cap. V** (Encargados del tratamiento y transferencias internacionales) | Contratos DPA y garantías con proveedores cloud/IA. | Uso de Gemini completamente opcional (opt-in por estudio exigiendo `ai_dpa_confirmed: true`), bloqueo previo de PII mediante `piiGuard.ts` (texto libre + metadatos + niveles) y prohibición de enviar filas crudas de pacientes al Asistente IA. | Firmar **DPA / Encargo de tratamiento** con Google Cloud (Workspace / Cloud / Vertex AI o Gemini API empresarial) asegurando residencia en UE (`europe-west1`/`eur3`) o Cláusulas Contractuales Tipo (SCC) y análisis TIA si aplica. No activar la IA si no existe DPA válido. |
| **Art. 32** (Seguridad del tratamiento) | Confidencialidad, integridad, disponibilidad y resiliencia. | Auth verificada + revocación, RBAC de 7 roles en backend y `firestore.rules`, timeout de inactividad 15 min, rate limiting, CORS estricto, cadena HMAC-SHA256 + soporte WORM/PITR y pruebas de respaldo (`backup-verify.ts`). | Activar Secret Manager, PITR, WORM Bucket Lock, App Check y MFA Identity Platform en el proyecto productivo mediante `scripts/gcp-infra-setup.sh`. |
| **Art. 33–34** (Notificación de brechas) | Detección, registro y notificación en ≤ 72 horas. | Logs estructurados de accesos denegados (`ACCESS_DENIED`), detección PII (`PII_DETECTED`), reautenticaciones fallidas (`REAUTH_REQUIRED`) y trazabilidad de reidentificaciones (`IDENTITY_UNSEALED`). | Ejecutar el plan de respuesta a incidentes (`docs/operations/INCIDENT_RESPONSE_PLAN.md`) y notificar a la autoridad de control (AEPD u homóloga) en ≤ 72 h si existe riesgo para los derechos y libertades. |
| **Art. 35** (EIPD / DPIA) | Evaluación de Impacto relativa a Protección de Datos. | La arquitectura aporta la evidencia técnica base (flujos de datos, cifrado, pseudonimización, minimización y análisis de riesgos en `docs/validation/RISK_ASSESSMENT.md`). | El **Delegado de Protección de Datos (DPD/DPO)** del promotor debe revisar, completar con el contexto institucional y aprobar formalmente la EIPD antes del inicio del reclutamiento. |

---

## 3. Flujo de datos y prevención de transferencias no autorizadas a IA

1. **Almacenamiento clínico y de identidad:** Permanece en Firestore (configurado en región UE `eur3`/`europe-west1` en producción) bajo separación lógica `identityVault` vs `crfRecords`/`datasets`.
2. **Motor bioestadístico (21 pruebas):** Se ejecuta íntegramente en el servidor Express propio (`server/statsEngine.ts`) sin llamadas a terceros ni LLM.
3. **Asistente IA y Extracción CRF (Opcional):** Bloqueados por defecto. Solo operan si el Administrador activa simultáneamente `ai_enabled`, `ai_dpa_confirmed` y el permiso específico (`ai_allow_clinical_text` / `ai_allow_dataset_context`), y tras superar el bloqueador estricto de PII (`server/piiGuard.ts`).
