# PNT-02: Plan de Respuesta a Incidentes de Seguridad y Brechas RGPD — Avicena

**Código:** SOP-OPE-002 · **Versión:** 1.0 · **Marco:** RGPD Arts. 33–34, ENS, GCP

---

## 1. Clasificación de incidentes
- **P1 (Crítico):** Acceso no autorizado confirmado a `identityVault` o datos clínicos, compromiso de `VAULT_ENCRYPTION_SECRET` / `AUDIT_HMAC_SECRET`, alteración de cadena HMAC o pérdida de disponibilidad prolongada.
- **P2 (Alto):** Cuenta clínica comprometida, intentos repetidos de acceso denegado (`ACCESS_DENIED`), bloqueo por detección de PII hacia IA (`PII_DETECTED`) indicando error operativo grave.
- **P3 (Medio/Bajo):** Errores puntuales sin exposición de datos, caducidad de sesión o incidencias de disponibilidad menores.

## 2. Fases de actuación
1. **Detección y contención inmediata (0–2 h):**
   - Revocar sesiones y deshabilitar la cuenta afectada en Firebase Auth (`revokeRefreshTokens` / `disabled: true`).
   - Si existe sospecha de fuga de secretos, rotar inmediatamente `VAULT_ENCRYPTION_SECRET` o `AUDIT_HMAC_SECRET` en Secret Manager moviendo el secreto comprometido a `*_PREVIOUS_SECRETS` (solo lectura histórica hasta re-cifrado).
   - Si el estudio estaba activo y existe riesgo para la integridad, cambiar su estado a `cerrado` o `bloqueado`.
2. **Investigación forense (2–24 h):**
   - Exportar los logs JSON estructurados desde Cloud Logging / bucket WORM (`jsonPayload.worm_audit=true`) y verificar la cadena HMAC en `AuditTab` (`POST /api/audit/verify`).
   - Identificar qué `subjectPseudoId` o colecciones estuvieron potencialmente expuestas.
3. **Notificación RGPD (≤ 72 h para P1/P2 con riesgo):**
   - Notificar al **Delegado de Protección de Datos (DPO)** y al Responsable del Tratamiento en las primeras 4 horas desde la detección.
   - Si no puede descartarse riesgo para los derechos y libertades de los pacientes, el Responsable notificará a la autoridad de control (p. ej. AEPD) dentro de las **72 horas** (Art. 33 RGPD) y a los interesados si existe alto riesgo (Art. 34 RGPD).
4. **Cierre y CAPA:** Registrar el incidente y las medidas preventivas en el registro de desviaciones/incidentes del estudio.
