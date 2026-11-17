import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type User } from "firebase/auth";
import {
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";
import type { Role } from "./lib/types.ts";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
void testConnection();

function safeMemberDocId(idOrEmail: string): string {
  return idOrEmail.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

export async function syncUserProfileToFirestore(user: User): Promise<void> {
  if (!user.emailVerified || !user.email) return;
  const path = `users/${user.uid}`;
  const ref = doc(db, "users", user.uid);
  const displayName = (user.displayName || user.email.split("@")[0] || "Investigador").slice(0, 120);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email: user.email.slice(0, 200),
        displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        email: user.email.slice(0, 200),
        displayName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      // Non-fatal mirror sync
    }
  }
}

export async function syncProjectToFirestore(
  projectId: string,
  name: string,
  description: string,
  ownerUser: User
): Promise<void> {
  if (!ownerUser.emailVerified || !ownerUser.email) return;
  const projPath = `projects/${projectId}`;
  const memberPath = `projects/${projectId}/members/${ownerUser.uid}`;
  try {
    await setDoc(doc(db, "projects", projectId), {
      name: name.slice(0, 160),
      description: description.slice(0, 1000),
      ownerId: ownerUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, "projects", projectId, "members", ownerUser.uid), {
      projectId,
      userId: ownerUser.uid,
      email: ownerUser.email.slice(0, 200),
      name: (ownerUser.displayName || ownerUser.email.split("@")[0]).slice(0, 120),
      role: "admin" satisfies Role,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.CREATE, `${projPath} | ${memberPath}`);
    } catch {
      // Non-fatal mirror sync
    }
  }
}

export async function syncProjectMemberToFirestore(
  projectId: string,
  member: { user_id: string | null; email: string; name: string; role: Role }
): Promise<void> {
  const current = auth.currentUser;
  if (!current?.emailVerified) return;
  const memberId = member.user_id || `inv_${safeMemberDocId(member.email.toLowerCase())}`;
  const path = `projects/${projectId}/members/${memberId}`;
  try {
    const ref = doc(db, "projects", projectId, "members", memberId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        projectId,
        userId: member.user_id ?? null,
        email: member.email.slice(0, 200),
        name: member.name.slice(0, 120),
        role: member.role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        userId: member.user_id ?? null,
        name: member.name.slice(0, 120),
        role: member.role,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      // Non-fatal mirror sync
    }
  }
}

export async function removeProjectMemberFromFirestore(projectId: string, idOrEmail: string): Promise<void> {
  const current = auth.currentUser;
  if (!current?.emailVerified) return;
  const memberId = idOrEmail.includes("@") ? `inv_${safeMemberDocId(idOrEmail.toLowerCase())}` : idOrEmail;
  const path = `projects/${projectId}/members/${memberId}`;
  try {
    await deleteDoc(doc(db, "projects", projectId, "members", memberId));
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.DELETE, path);
    } catch {
      // Non-fatal mirror sync
    }
  }
}
