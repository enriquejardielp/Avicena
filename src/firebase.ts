import { initializeApp } from "firebase/app";
import { browserSessionPersistence, getAuth, GoogleAuthProvider, setPersistence, type User } from "firebase/auth";
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Enforce per-browser-session persistence for clinical workstations (clears on tab/browser close)
export const authPersistenceReady = setPersistence(auth, browserSessionPersistence).catch(() => {
  // Fallback safely if browser storage policy restricts sessionStorage
});

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
  emailVerified: boolean;
}

function sanitizeErrorMessage(raw: string): string {
  return raw
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL_REDACTADO]")
    .replace(/\b\d{8}[-\s]?[TRWAGMYFPDXBNJZSQVHLCKE]\b/gi, "[ID_REDACTADO]")
    .slice(0, 300);
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: sanitizeErrorMessage(rawMessage),
    operationType,
    path,
    emailVerified: Boolean(auth.currentUser?.emailVerified),
  };
  console.error("Firestore operation failed:", errInfo.operationType, errInfo.path ?? "(sin ruta)");
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Firestore client offline: verify network or Firebase configuration.");
    }
  }
}
void testConnection();

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
        email: user.email.toLowerCase().slice(0, 200),
        displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        email: user.email.toLowerCase().slice(0, 200),
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
