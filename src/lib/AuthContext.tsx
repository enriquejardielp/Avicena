import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth, googleProvider, syncUserProfileToFirestore } from "../firebase.ts";
import { setAuthTokenProvider } from "./api.ts";

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  signInWithGoogle: () => Promise<User>;
  signInWithEmail: (email: string, password: string) => Promise<User>;
  signUpWithEmail: (name: string, email: string, password: string) => Promise<User>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    setAuthTokenProvider(async () => {
      const curr = auth.currentUser;
      if (!curr) return null;
      return await curr.getIdToken();
    });

    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setUser(fbUser);
      setAuthReady(true);
      if (fbUser) {
        void syncUserProfileToFirestore(fbUser);
      }
    });

    return () => {
      unsub();
      setAuthTokenProvider(null);
    };
  }, []);

  const signInWithGoogle = async (): Promise<User> => {
    const cred = await signInWithPopup(auth, googleProvider);
    void syncUserProfileToFirestore(cred.user);
    return cred.user;
  };

  const signInWithEmail = async (email: string, password: string): Promise<User> => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    void syncUserProfileToFirestore(cred.user);
    return cred.user;
  };

  const signUpWithEmail = async (name: string, email: string, password: string): Promise<User> => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const trimmedName = name.trim();
    if (trimmedName) {
      await updateProfile(cred.user, { displayName: trimmedName });
    }
    try {
      await sendEmailVerification(cred.user);
    } catch {
      // Verification email best-effort
    }
    setUser({ ...cred.user, displayName: trimmedName || cred.user.displayName } as User);
    return cred.user;
  };

  const resetPassword = async (email: string): Promise<void> => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const resendVerification = async (): Promise<void> => {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
    }
  };

  const signOutUser = async (): Promise<void> => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        resetPassword,
        resendVerification,
        signOutUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside FirebaseAuthProvider");
  return ctx;
}
