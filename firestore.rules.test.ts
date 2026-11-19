// Security Rules TDD Specification (12 adversarial cases verified against firestore.rules)
export const DIRTY_DOZEN_CASES = [
  { id: 1, path: "/users/u1", op: "get", auth: null, expected: "PERMISSION_DENIED" },
  { id: 2, path: "/projects/p1/forms/f1", op: "create", auth: { uid: "u1", email_verified: false }, expected: "PERMISSION_DENIED" },
  { id: 3, path: "/userProjects/u1/items/p1", op: "get", auth: { uid: "u2", email_verified: true }, expected: "PERMISSION_DENIED" },
  { id: 4, path: "/projects/p1/savedAnalyses/a1", op: "create", payload: { isAdmin: true }, expected: "PERMISSION_DENIED" },
  { id: 5, path: "/projects/p1", op: "create", payload: { ownerId: "other" }, expected: "PERMISSION_DENIED" },
  { id: 6, path: "/projects/bad..id/datasets/d1", op: "create", expected: "PERMISSION_DENIED" },
  { id: 7, path: "/projects/p1/datasets/d1", op: "get", auth: { uid: "capturador" }, expected: "PERMISSION_DENIED" },
  { id: 8, path: "/projects/p1/crfRecords/r1", op: "update", auth: { uid: "capturador2" }, expected: "PERMISSION_DENIED" },
  { id: 9, path: "/projects/p1/members/u2", op: "create", auth: { uid: "u2" }, payload: { role: "admin" }, expected: "PERMISSION_DENIED" },
  { id: 10, path: "/projects/p1/members/owner", op: "delete", auth: { uid: "otherAdmin" }, expected: "PERMISSION_DENIED" },
  { id: 11, path: "/projects/p1/datasets/d1", op: "create", payload: { analystUidsSize: 25 }, expected: "PERMISSION_DENIED" },
  { id: 12, path: "/projectInvites", op: "list", auth: { uid: "outsider", email_verified: true }, expected: "PERMISSION_DENIED" },
] as const;
