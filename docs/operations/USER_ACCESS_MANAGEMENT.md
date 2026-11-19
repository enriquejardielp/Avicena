# PNT-01: Gestión de Accesos de Usuarios y Roles (RBAC) — Avicena

**Código:** SOP-OPE-001 · **Versión:** 1.0 · **Aplica a:** Investigadores Principales, Coordinadores, Administradores Técnicos

---

## 1. Principios de control de acceso
1. **Mínimo privilegio y separación de funciones:** Cada usuario recibirá el rol estrictamente necesario para sus tareas del protocolo (`capturador`, `investigador`, `monitor_clinico`, `estadistico`, `coordinador`, `admin`, `admin_tecnico`).
2. **Separación técnica/clínica:** El personal de TI / soporte técnico recibirá exclusivamente `admin_tecnico`, que carece de acceso a datos clínicos, CRF, bóveda de identidad e IA.
3. **Cuentas nominativas e intransferibles:** Prohibido compartir credenciales o contraseñas entre miembros del centro.

## 2. Procedimiento de alta y activación
1. El usuario crea su cuenta con correo institucional y **verifica su dirección de correo** (bloqueado hasta verificación).
2. El usuario configura su segundo factor **TOTP** desde el menú de seguridad de su perfil (`AppShell` -> Seguridad de cuenta).
3. El IP (`admin`) invita al usuario en `Equipo y gobernanza` asignando el rol aprobado en el *Delegation Log* del estudio.
4. La invitación caduca automáticamente a los 7 días si no es aceptada.

## 3. Revisión trimestral y baja inmediata
1. **Baja o cambio de centro:** El IP/Coordinador retirará al miembro de inmediato en `Equipo y gobernanza` (`removeProjectMember`) y, si corresponde, el administrador de identidad deshabilitará/revocará su cuenta en Firebase Auth (comprobado por el backend en cada petición mediante `verifyIdToken(..., true)`).
2. **Revisión periódica:** Cada trimestre el IP revisará la lista de miembros activos comparándola con el *Delegation Log* firmado. Toda alta, cambio de rol o retirada queda sellada en `auditLogs` (`MEMBER_INVITED`, `MEMBER_ROLE_CHANGED`, `MEMBER_REMOVED`).
