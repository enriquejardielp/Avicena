# PNT-05: Política de Conservación, Bloqueo y Eliminación de Datos — Avicena

**Código:** SOP-OPE-005 · **Versión:** 1.0 · **Marco:** RGPD Art. 5.1.e, Reglamento (UE) 536/2014, Ley 14/2007 de Investigación Biomédica

---

## 1. Plazos de conservación de referencia
- **Ensayos clínicos con medicamentos (UE 536/2014):** Mínimo **25 años** tras la finalización del ensayo para el archivo maestro clínico, registros CRF y pista de auditoría WORM.
- **Estudios observacionales / proyectos académicos:** Según dictamen del CEIm y política del centro (habitualmente entre 5 y 15 años tras publicación o cierre).
- **Tabla de correspondencia de pseudonimización (`identityVault`):** Conservar únicamente mientras exista necesidad clínica/regulatoria o de seguimiento de seguridad; transcurrido el plazo o tras anonimización irreversible aprobada, destruir las claves/registros de bóveda bajo acta firmada.

## 2. Reglas de inmutabilidad vs. supresión
1. Durante un estudio activo o archivado, `auditLogs`, `crfVersions`, `queries`, `deviations` y `electronicSignatures` tienen prohibido el borrado individual en `firestore.rules` (`allow delete: if false`).
2. La eliminación íntegra de un estudio (`deleteProject`) está reservada exclusivamente al **Propietario / IP (`admin`)** y solo debe ejecutarse:
   - En estudios de prueba con datos sintéticos, o
   - Al vencer el plazo legal de retención tras exportar y verificar el archivo definitivo del estudio (con acta de destrucción firmada por IP y DPO).
3. Ante una solicitud válida de supresión de un participante (Art. 17 RGPD), el DPO evaluará si procede bloquear nuevas capturas (`retirado`) y purgar la identidad en bóveda conservando los datos estadísticos anónimos si aplica la excepción científica del Art. 17.3.d RGPD.
