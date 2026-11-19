# PNT-09: Procedimiento de Cierre, Bloqueo de Base y Archivo de Estudio — Avicena

**Código:** SOP-OPE-009 · **Versión:** 1.0 · **Marco:** ICH E6(R3) / EMA Data Integrity

---

## 1. Precondiciones previas al *Database Lock*
1. Todas las capturas CRF están en estado `completado`, `enviado` o `verificado` (sin borradores pendientes de inclusión).
2. El 100 % de las **queries de monitorización** en `MonitoringTab` están en estado `cerrada` o `cancelada`.
3. Todas las **desviaciones de protocolo** críticas/mayores cuentan con evaluación de impacto y plan CAPA documentado.
4. La pista de auditoría supera `Verificar cadena HMAC` (`valid: true`) sin errores de encadenamiento.

## 2. Secuencia de cierre y bloqueo
1. **Cierre de captura (`cerrado`):** El IP o Coordinador cambia la fase del estudio en `Equipo y gobernanza` a `cerrado` documentando el fin del periodo de recogida.
2. **Revisión final y SDV:** El Monitor Clínico completa la verificación SDV y bloqueo de registros CRF pendientes mediante aprobación electrónica reautenticada (`ElectronicApprovalModal`).
3. **Bloqueo definitivo (`bloqueado` — Database Lock):** El IP o Coordinador ejecuta la transición a `bloqueado` mediante **aprobación electrónica reautenticada** (`ElectronicApprovalModal` -> `POST /api/signatures/sign`). A partir de ese instante, tanto la API como `firestore.rules` congelan toda escritura sobre CRF y datasets.
4. **Análisis estadístico final y exportación:** El Estadístico ejecuta los análisis primarios/secundarios en `Bioestadística`, guarda las salidas oficiales en `Análisis guardados` y exporta el paquete de datos con su suma SHA-256.
5. **Archivo (`archivado`):** Tras la entrega del informe final del estudio, el IP transiciona el estudio a `archivado` con aprobación electrónica y archiva las copias verificadas + trazas WORM según `PNT-05 (DATA_RETENTION_POLICY.md)`.
