# Avicena Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict PII Isolation**: `/users/{userId}` contains private email & identity data; only `request.auth.uid == userId` may read or write it.
2. **Verified Email Gate**: All mutations require `request.auth != null && request.auth.token.email_verified == true`.
3. **Project Creator as Admin**: On `/projects/{projectId}` creation, `ownerId` must equal `request.auth.uid`. Only project admins (creator or assigned `admin` member) may update project metadata or manage `/projects/{projectId}/members/{memberId}`.
4. **No Orphan Members**: Creating `/projects/{projectId}/members/{memberId}` requires `exists(/databases/$(database)/documents/projects/$(projectId))` and `incoming().projectId == projectId`.
5. **Immutable Audit Fields & Server Timestamps**: `ownerId`, `projectId`, `createdAt` cannot change on update; `createdAt == request.time` on create and `updatedAt == request.time` on update.

## 2. Dirty Dozen Adversarial Payloads (Must Fail with PERMISSION_DENIED)
1. Unauthenticated read/write to `/users/u1` or `/projects/p1`.
2. Unverified email write (`email_verified: false`) to `/users/u1`.
3. Cross-user PII read: user `u2` reading `/users/u1`.
4. Shadow field injection (`isAdmin: true`) on `/users/u1`.
5. Identity spoofing on project creation (`ownerId: "victim-uid"`).
6. Oversized project ID (`id.size() > 128`) or invalid characters (`"p1/../hack"`).
7. Non-admin member updating `/projects/p1` name/description.
8. Non-owner deleting `/projects/p1`.
9. Modifying immutable `ownerId` or `createdAt` during `/projects/p1` update.
10. Capturador self-promoting to `admin` in `/projects/p1/members/u2`.
11. Deleting the project creator's membership record.
12. Blanket collection list query on `/users` or `/projects` by non-owner.
