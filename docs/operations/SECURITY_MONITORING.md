# PNT-07: Monitorización Continua de Seguridad y Alertas — Avicena

**Código:** SOP-OPE-007 · **Versión:** 1.0 · **Aplica a:** `admin_tecnico`, CISO, Cloud Ops

---

## 1. Eventos de seguridad emitidos por Avicena (`worm_audit: true`)
El backend `server/auditChain.ts` y `server/apiRouter.ts` registran eventos JSON estructurados sin exponer PII (`redactSensitiveText`):
- `ACCESS_DENIED`: intentos rechazados por RBAC, IDOR (`NOT_STUDY_MEMBER`), falta de MFA (`MFA_REQUIRED_BY_STUDY`) o falta de App Check.
- `REAUTH_REQUIRED`: intentos de aprobación electrónica con `auth_time > 300s`.
- `PII_DETECTED`: bloqueos automáticos de PII antes de invocar modelos de IA.
- `ELECTRONIC_APPROVAL`, `IDENTITY_UNSEALED`, `EXPORT_DATA`, `AUDIT_VERIFY`: eventos críticos de negocio y trazabilidad.

## 2. Reglas de alerta recomendadas en Cloud Monitoring
1. **Alerta Alta (`P1/P2`):** `>= 5` eventos `IDENTITY_UNSEALED` o `EXPORT_DATA` por un mismo `actorUid` en 15 minutos, o `>= 10` eventos `ACCESS_DENIED` en 5 minutos.
2. **Alerta de Bloqueo PII:** cualquier evento `PII_DETECTED` reiterado por un mismo centro/usuario (indica necesidad de re-formación).
3. **Verificación semanal de cadena HMAC:** el `admin_tecnico` o responsable de calidad ejecutará la verificación de cadena en `AuditTab` (`Verificar cadena HMAC`) y revisará la entrega continua de objetos en el bucket WORM.
