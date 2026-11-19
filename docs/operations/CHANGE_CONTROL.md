# PNT-04: Control de Cambios y Gestión de Versiones (Change Control) — Avicena

**Código:** SOP-OPE-004 · **Versión:** 1.0 · **Marco:** GAMP 5 / ICH E6(R3)

---

## 1. Clasificación de cambios
- **Cambio de software / infraestructura:** Modificaciones en `server/*`, `src/*`, `firestore.rules`, variables de entorno o dependencias npm.
- **Cambio de protocolo / CRF:** Enmiendas de protocolo o edición de esquemas de formulario (`forms`) en un estudio activo.

## 2. Flujo obligatorio para cambios de software y reglas
1. Registrar solicitud de cambio (RFC) indicando alcance, análisis de impacto en seguridad/RGPD/ALCOA+ y criterios de regresión.
2. Implementar y probar primero en `avicena-dev` con datos sintéticos.
3. Ejecutar obligatoriamente antes de promover a `staging`:
   - `npm run build` y `npm run lint`
   - `npx eslint firestore.rules`
   - `npx tsx --test tests/security-remediation.test.ts`
   - `npx tsx scripts/backup-verify.ts`
4. Desplegar en `avicena-staging` y ejecutar los casos OQ/PQ afectados de `docs/validation/IQ_OQ_PQ_PROTOCOLS.md`.
5. Solo tras aprobación conjunta de **Responsable Técnico** y **QA**, promover etiqueta inmutable a `avicena-prod`.

## 3. Cambios en CRF / Enmiendas durante un estudio activo
1. Registrar la nueva enmienda en `Equipo y gobernanza -> Enmiendas de protocolo` (`addStudyAmendment`) indicando versión y fecha de aprobación CEIm.
2. Actualizar los campos CRF (`updateForm`) incrementando automáticamente `formVersion`; los registros previos conservan su `form_version` original y no se alteran retroactivamente.
3. Si la enmienda afecta a la hoja de información al paciente, marcar los consentimientos afectados como `requiere_reconsentimiento`.
