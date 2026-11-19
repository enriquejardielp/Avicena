# PNT-08: Requisitos de Formación y Cualificación de Usuarios — Avicena

**Código:** SOP-OPE-008 · **Versión:** 1.0 · **Marco:** ICH E6(R3) Sec. 2.2 / GAMP 5

---

## 1. Formación obligatoria previa al acceso en producción
Ningún miembro del equipo recibirá rol activo en un estudio con datos reales sin acreditar formación documentada (registrada en el *Training Log* del *Trial Master File*):

| Perfil | Módulos formativos obligatorios |
|---|---|
| **Todos los usuarios clínicos y técnicos** | Principios ALCOA+, uso de cuentas nominativas, activación obligatoria de **MFA TOTP**, bloqueo de estación y cierre de sesión, prohibición estricta de introducir identificadores directos en campos clínicos libres. |
| **Capturadores / Investigadores** | Uso de bóveda de pseudonimización (`SUBJ-...`), registro y verificación de consentimiento informado vigente, creación/edición versionada de CRF con motivo obligatorio, y respuesta a queries de monitorización. |
| **Monitores Clínicos (CRA)** | Revisión de datos fuente (SDV), apertura/cierre de queries, registro de desviaciones de protocolo y CAPA, aprobación electrónica reautenticada y revisión de pista de auditoría. |
| **Coordinadores / IP (`admin`)** | Gestión de roles (RBAC), configuración de gobernanza (`require_mfa`, `require_active_consent`, bloqueo IA salvo DPA), gestión de ciclo de vida del estudio (*Database Lock*), enmiendas de protocolo y reidentificación excepcional auditada. |
| **Estadísticos** | Ejecución determinista de pruebas bioestadísticas, guardado de análisis, exportación pseudonimizada controlada y manejo seguro de CSV. |
| **Administradores Técnicos (`admin_tecnico`)** | Supervisión de auditoría HMAC sin acceso clínico, verificación de backups, respuesta ante incidentes y rotación de secretos. |
