# Avicena Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict PII Isolation**: `/users/{userId}` and `/userProjects/{userId}/items/{projectId}` are strictly restricted to `request.auth.uid == userId`.
2. **Verified Email Gate**: All Firestore mutations require `request.auth != null && request.auth.token.email_verified == true`.
3. **Project Creator & Role RBAC**: On `/projects/{projectId}` creation, `ownerId` must equal `request.auth.uid`. Only project admins may manage `/projects/{projectId}/members/{memberId}` or `/projectInvites/{inviteId}` (except an invited verified user claiming their own invite with the exact assigned role).
4. **Capturador Isolation**: Users with role `capturador` may read forms and create/read/edit ONLY their own `/projects/{projectId}/crfRecords/{recordId}`, and are blocked from reading/listing global `datasets`, `datasetChunks`, `savedAnalyses`, or `chatMessages`.
5. **Zero-Get List Queries**: Every `allow list` rule evaluates `resource.data` against `request.auth.uid` or `request.auth.token.email` without `get()` or `exists()` lookups.
6. **Immutable Audit Fields & Server Timestamps**: `ownerId`, `projectId`, `projectOwnerId`, `createdBy`, `createdAt` cannot be modified on update; `createdAt == request.time` on create and `updatedAt == request.time` on update.

## 2. Dirty Dozen Adversarial Payloads (Must Fail with PERMISSION_DENIED)
1. Unauthenticated read/write to `/users/u1` or `/projects/p1`.
2. Unverified email write (`email_verified: false`) to `/projects/p1/forms/f1`.
3. Cross-user PII read: user `u2` reading `/users/u1` or `/userProjects/u1/items/p1`.
4. Shadow field injection (`isAdmin: true`) on `/users/u1` or `/projects/p1/savedAnalyses/a1`.
5. Identity spoofing on project creation (`ownerId: "victim-uid"`).
6. Oversized or malformed ID (`"bad..id"`) on `/projects/bad..id/datasets/d1`.
7. Capturador attempting to read or list `/projects/p1/datasets` or `/projects/p1/savedAnalyses`.
8. Capturador attempting to edit another user's `/projects/p1/crfRecords/r1`.
9. Invited user claiming `/projects/p1/members/u2` with `role: "admin"` when invite was for `"capturador"`.
10. Non-admin member modifying `/projects/p1` metadata or removing the owner's membership doc.
11. Unbounded `analystUids` / `teamUids` array (`size > 20`) on `/projects/p1/datasets/d1`.
12. Blanket collection list query on `/projects`, `/projectInvites`, or `/users` without matching ownership filter.
