# Especificación de Requisitos de Usuario (URS) — Avicena EDC/eCRF

**Documento:** CSV-URS-001 · **Versión:** 1.0 · **Marco:** GAMP 5 (2ª Ed.) / ICH E6(R3) / RGPD  
**Uso previsto (Intended Use):** Avicena es una plataforma web de captura electrónica de datos clínicos (EDC/eCRF), gestión de pseudonimización y consentimientos, monitorización clínica (SDV, queries, desviaciones CAPA) y análisis bioestadístico determinista para estudios observacionales y ensayos clínicos académicos o institucionales, bajo gobierno del Investigador Principal / Promotor.

---

## Requisitos de Usuario (URS)

| ID | Categoría | Requisito de Usuario | Criticidad |
|---|---|---|---|
| **URS-01** | Identidad y Autenticación | El sistema solo permitirá acceso a usuarios autenticados con correo electrónico verificado, comprobando revocación/deshabilitación de sesión y cerrando sesiones tras 15 minutos de inactividad. | Crítica |
| **URS-02** | Autenticación Multifactor | Los estudios podrán exigir autenticación multifactor (MFA TOTP) obligatoria en API y base de datos para todas las operaciones del estudio. | Crítica |
| **URS-03** | Control de Accesos (RBAC) | El sistema segregará permisos en 7 roles clínicos y técnicos (`admin`, `coordinador`, `investigador`, `monitor_clinico`, `estadistico`, `admin_tecnico`, `capturador`), impidiendo que `admin_tecnico` acceda a datos clínicos y que roles no autorizados accedan entre estudios (IDOR). | Crítica |
| **URS-04** | Pseudonimización y Bóveda | Ningún identificador civil directo (DNI, NHC, nombre completo) se usará como ID de investigación; las identidades se cifrarán con AES-256-GCM en bóveda separada con prevención de duplicados por índice ciego y reidentificación exclusivamente auditada. | Crítica |
| **URS-05** | Consentimiento Informado | El sistema registrará consentimientos por sujeto pseudonimizado (`vigente`, `retirado`, `pendiente`, `requiere_reconsentimiento`) y bloqueará la captura CRF cuando el consentimiento no esté vigente (si la política está activa). | Crítica |
| **URS-06** | eCRF, Validación y Versionado | Los formularios CRF validarán tipos, obligatoriedad y rangos; toda modificación posterior exigirá motivo y creará una instantánea versionada inmutable con usuario y marca temporal. | Crítica |
| **URS-07** | Importación Tabular y Auto-CRF | La carga de archivos CSV/Excel (.xlsx/.xls) inferirá el esquema de variables, advertirá columnas identificativas y generará automáticamente un CRF vinculado para continuar la captura. | Alta |
| **URS-08** | Monitorización, Queries y CAPA | El Monitor Clínico (`monitor_clinico`) y Coordinador/IP podrán revisar registros en solo lectura, abrir y cerrar queries por variable, y registrar/gestionar desviaciones de protocolo con plan CAPA. | Crítica |
| **URS-09** | Ciclo de Vida y Enmiendas | El estudio gestionará fases (`borrador`, `reclutamiento`, `seguimiento`, `cerrado`, `bloqueado`, `archivado`) y enmiendas de protocolo; las fases cerradas/bloqueadas impedirán captura o edición en API y Firestore. | Crítica |
| **URS-10** | Aprobación Electrónica Reautenticada | Las acciones regulatorias (SDV, bloqueo/reapertura CRF y bloqueo/reapertura del estudio) requerirán reautenticación reciente (≤ 300 s), motivo documentado y sellado criptográfico HMAC-SHA256. | Crítica |
| **URS-11** | Audit Trail Inmutable | Toda operación relevante generará una entrada inmutable encadenada por HMAC-SHA256 y emitirá trazas estructuradas WORM; las mutaciones clínicas fallarán en cerrado si falla la auditoría. | Crítica |
| **URS-12** | Bioestadística Determinista | El motor bioestadístico del servidor ejecutará las 21 pruebas estadísticas de forma determinista y sin fuga de datos a LLM externos, permitiendo guardar y exportar resultados. | Alta |
| **URS-13** | Exportación Controlada | Las exportaciones CSV serán justificadas, autorizadas por rol, pseudonimizadas por defecto, protegidas frente a inyección de fórmulas CSV y acompañadas de hash SHA-256. | Alta |
| **URS-14** | Privacidad en IA Opcional | La integración con Gemini permanecerá desactivada por defecto, requerirá confirmación explícita de DPA y bloqueará cualquier entrada o metadato que contenga PII. | Crítica |
| **URS-15** | Continuidad y Segregación | Los secretos de bóveda y auditoría estarán separados y soportarán rotación; el sistema soportará validación de copias de seguridad, PITR y entornos separados. | Crítica |
