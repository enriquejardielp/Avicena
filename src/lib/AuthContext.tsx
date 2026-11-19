import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getMultiFactorResolver,
  multiFactor,
  OAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  SAMLAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  TotpMultiFactorGenerator,
  updateProfile,
  type MultiFactorError,
  type MultiFactorInfo,
  type MultiFactorResolver,
  type TotpSecret,
  type User,
} from "firebase/auth";
import { toast } from "sonner";
import { auth, authPersistenceReady, googleProvider, syncUserProfileToFirestore } from "../firebase.ts";
import { ApiError, apiGet, setAuthTokenProvider } from "./api.ts";

const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
const INACTIVITY_WARN_MS = 13 * 60 * 1000;
const SESSION_POLL_MS = 5 * 60 * 1000;
const ACTIVITY_STORAGE_KEY = "avicena_last_activity_ts";

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 12) return "La contraseña debe tener al menos 12 caracteres.";
  if (!/[A-Z]/.test(password)) return "La contraseña debe incluir al menos una letra mayúscula.";
  if (!/[a-z]/.test(password)) return "La contraseña debe incluir al menos una letra minúscula.";
  if (!/\d/.test(password)) return "La contraseña debe incluir al menos un número.";
  if (!/[^A-Za-z0-9]/.test(password)) return "La contraseña debe incluir al menos un símbolo especial (ej. !@#$%).";
  return null;
}

export interface TotpEnrollmentStart {
  secret: TotpSecret;
  secretKey: string;
  qrCodeUri: string;
}

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  mfaEnrolledFactors: MultiFactorInfo[];
  hasActiveMfaSession: boolean;
  pendingMfaResolver: MultiFactorResolver | null;
  ssoProviderId: string | null;
  ssoProviderLabel: string;
  signInWithGoogle: () => Promise<User>;
  signInWithInstitutionalSso: () => Promise<User>;
  signInWithEmail: (email: string, password: string) => Promise<User>;
  signUpWithEmail: (name: string, email: string, password: string) => Promise<User>;
  resolveMfaSignIn: (verificationCode: string) => Promise<User>;
  cancelMfaChallenge: () => void;
  startTotpEnrollment: () => Promise<TotpEnrollmentStart>;
  finalizeTotpEnrollment: (secret: TotpSecret, verificationCode: string, displayName?: string) => Promise<void>;
  unenrollMfaFactor: (factorUid: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  reloadUserStatus: () => Promise<boolean>;
  reauthenticateSession: (password?: string) => Promise<void>;
  authProviderKind: "password" | "google" | "sso" | "unknown";
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [mfaEnrolledFactors, setMfaEnrolledFactors] = useState<MultiFactorInfo[]>([]);
  const [hasActiveMfaSession, setHasActiveMfaSession] = useState(false);
  const [pendingMfaResolver, setPendingMfaResolver] = useState<MultiFactorResolver | null>(null);

  const lastActivityRef = useRef<number>(Date.now());
  const warnedRef = useRef<boolean>(false);

  const ssoProviderId = (import.meta.env.VITE_INSTITUTIONAL_SSO_PROVIDER_ID as string | undefined)?.trim() || null;
  const ssoProviderLabel =
    (import.meta.env.VITE_INSTITUTIONAL_SSO_LABEL as string | undefined)?.trim() || "Acceso institucional (SSO)";

  const refreshMfaState = async (fbUser: User | null) => {
    if (!fbUser) {
      setMfaEnrolledFactors([]);
      setHasActiveMfaSession(false);
      return;
    }
    try {
      const mf = multiFactor(fbUser);
      setMfaEnrolledFactors([...(mf.enrolledFactors ?? [])]);
      const tokenRes = await fbUser.getIdTokenResult();
      setHasActiveMfaSession(Boolean(tokenRes.signInSecondFactor));
    } catch {
      setMfaEnrolledFactors([]);
      setHasActiveMfaSession(false);
    }
  };

  useEffect(() => {
    setAuthTokenProvider(async () => {
      const curr = auth.currentUser;
      if (!curr) return null;
      return await curr.getIdToken();
    });

    let unsub = () => {};
    void authPersistenceReady.finally(() => {
      unsub = onAuthStateChanged(auth, (fbUser) => {
        setUser(fbUser);
        setAuthReady(true);
        void refreshMfaState(fbUser);
        if (fbUser && fbUser.emailVerified) {
          void syncUserProfileToFirestore(fbUser);
        }
      });
    });

    return () => {
      unsub();
      setAuthTokenProvider(null);
    };
  }, []);

  // 15-minute clinical workstation inactivity timeout + cross-tab sync
  useEffect(() => {
    if (!user) return;

    const touch = () => {
      const now = Date.now();
      lastActivityRef.current = now;
      warnedRef.current = false;
      try {
        localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now));
      } catch {
        // ignore storage errors
      }
    };

    touch();

    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVITY_STORAGE_KEY && e.newValue) {
        const ts = Number(e.newValue);
        if (Number.isFinite(ts) && ts > lastActivityRef.current) {
          lastActivityRef.current = ts;
          warnedRef.current = false;
        }
      }
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart"] as const;
    for (const ev of events) {
      window.addEventListener(ev, touch, { passive: true });
    }
    window.addEventListener("storage", onStorage);

    const timer = window.setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle >= INACTIVITY_LIMIT_MS) {
        window.clearInterval(timer);
        toast.warning("Sesión cerrada automáticamente tras 15 minutos de inactividad por seguridad clínica.");
        void signOut(auth);
      } else if (idle >= INACTIVITY_WARN_MS && !warnedRef.current) {
        warnedRef.current = true;
        toast.info("Tu sesión se cerrará en 2 minutos por inactividad.");
      }
    }, 15_000);

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, touch);
      }
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
  }, [user]);

  // Periodic backend revocation & account-disable verification
  useEffect(() => {
    if (!user || !user.emailVerified) return;

    let cancelled = false;
    const verifySession = async () => {
      try {
        await apiGet("/me");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          toast.error("Tu sesión ha sido revocada o deshabilitada. Inicia sesión de nuevo.");
          await signOut(auth);
        }
      }
    };

    void verifySession();
    const poll = window.setInterval(() => void verifySession(), SESSION_POLL_MS);
    const onFocus = () => void verifySession();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [user]);

  const handlePossibleMfaError = (err: unknown): never => {
    const code = (err as { code?: string })?.code ?? "";
    if (code === "auth/multi-factor-auth-required") {
      const resolver = getMultiFactorResolver(auth, err as MultiFactorError);
      setPendingMfaResolver(resolver);
      throw new Error("MFA_CHALLENGE_REQUIRED");
    }
    throw err;
  };

  const signInWithGoogle = async (): Promise<User> => {
    await authPersistenceReady;
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user.emailVerified) {
        void syncUserProfileToFirestore(cred.user);
      }
      await refreshMfaState(cred.user);
      return cred.user;
    } catch (err) {
      return handlePossibleMfaError(err);
    }
  };

  const signInWithInstitutionalSso = async (): Promise<User> => {
    if (!ssoProviderId) {
      throw new Error("No hay proveedor SSO institucional configurado en este entorno.");
    }
    await authPersistenceReady;
    const provider = ssoProviderId.startsWith("saml.")
      ? new SAMLAuthProvider(ssoProviderId)
      : new OAuthProvider(ssoProviderId);
    try {
      const cred = await signInWithPopup(auth, provider);
      if (cred.user.emailVerified) {
        void syncUserProfileToFirestore(cred.user);
      }
      await refreshMfaState(cred.user);
      return cred.user;
    } catch (err) {
      return handlePossibleMfaError(err);
    }
  };

  const signInWithEmail = async (email: string, password: string): Promise<User> => {
    await authPersistenceReady;
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      if (cred.user.emailVerified) {
        void syncUserProfileToFirestore(cred.user);
      }
      await refreshMfaState(cred.user);
      return cred.user;
    } catch (err) {
      return handlePossibleMfaError(err);
    }
  };

  const signUpWithEmail = async (name: string, email: string, password: string): Promise<User> => {
    const strengthErr = validatePasswordStrength(password);
    if (strengthErr) {
      throw new Error(strengthErr);
    }
    await authPersistenceReady;
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
    setUser(auth.currentUser ?? cred.user);
    return cred.user;
  };

  const resolveMfaSignIn = async (verificationCode: string): Promise<User> => {
    if (!pendingMfaResolver) {
      throw new Error("No hay desafío MFA activo.");
    }
    const totpHint = pendingMfaResolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (!totpHint) {
      throw new Error("El método MFA de esta cuenta no es TOTP compatible con este formulario.");
    }
    const assertion = TotpMultiFactorGenerator.assertionForSignIn(totpHint.uid, verificationCode.trim());
    const cred = await pendingMfaResolver.resolveSignIn(assertion);
    setPendingMfaResolver(null);
    if (cred.user.emailVerified) {
      void syncUserProfileToFirestore(cred.user);
    }
    await refreshMfaState(cred.user);
    return cred.user;
  };

  const cancelMfaChallenge = () => {
    setPendingMfaResolver(null);
  };

  const startTotpEnrollment = async (): Promise<TotpEnrollmentStart> => {
    const curr = auth.currentUser;
    if (!curr) throw new Error("Debes iniciar sesión primero.");
    if (!curr.emailVerified) throw new Error("Verifica tu correo electrónico antes de activar MFA.");
    const session = await multiFactor(curr).getSession();
    const secret = await TotpMultiFactorGenerator.generateSecret(session);
    const accountName = curr.email || curr.uid;
    const qrCodeUri = secret.generateQrCodeUrl(accountName, "Avicena EDC");
    return {
      secret,
      secretKey: secret.secretKey,
      qrCodeUri,
    };
  };

  const finalizeTotpEnrollment = async (
    secret: TotpSecret,
    verificationCode: string,
    displayName = "Autenticador TOTP"
  ): Promise<void> => {
    const curr = auth.currentUser;
    if (!curr) throw new Error("Sesión no activa.");
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, verificationCode.trim());
    await multiFactor(curr).enroll(assertion, displayName);
    await curr.getIdToken(true);
    await refreshMfaState(curr);
  };

  const unenrollMfaFactor = async (factorUid: string): Promise<void> => {
    const curr = auth.currentUser;
    if (!curr) throw new Error("Sesión no activa.");
    await multiFactor(curr).unenroll(factorUid);
    await refreshMfaState(curr);
  };

  const resetPassword = async (email: string): Promise<void> => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const resendVerification = async (): Promise<void> => {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
    }
  };

  const reloadUserStatus = async (): Promise<boolean> => {
    const curr = auth.currentUser;
    if (!curr) return false;
    await curr.reload();
    await curr.getIdToken(true);
    const refreshed = auth.currentUser;
    setUser(refreshed ? ({ ...refreshed } as User) : null);
    if (refreshed?.emailVerified) {
      await syncUserProfileToFirestore(refreshed);
      await refreshMfaState(refreshed);
      return true;
    }
    return false;
  };

  const authProviderKind: "password" | "google" | "sso" | "unknown" = (() => {
    const ids = user?.providerData?.map((p) => p.providerId) ?? [];
    if (ids.includes("password")) return "password";
    if (ids.includes("google.com")) return "google";
    if (ssoProviderId && ids.includes(ssoProviderId)) return "sso";
    return "unknown";
  })();

  const reauthenticateSession = async (password?: string): Promise<void> => {
    const curr = auth.currentUser;
    if (!curr) throw new Error("Debes iniciar sesión primero.");
    const providerIds = curr.providerData.map((p) => p.providerId);
    if (providerIds.includes("password")) {
      if (!curr.email || !password) {
        throw new Error("Introduce tu contraseña actual para confirmar la aprobación electrónica.");
      }
      const cred = EmailAuthProvider.credential(curr.email, password);
      await reauthenticateWithCredential(curr, cred);
    } else if (providerIds.includes("google.com")) {
      await reauthenticateWithPopup(curr, googleProvider);
    } else if (ssoProviderId) {
      const provider = ssoProviderId.startsWith("saml.")
        ? new SAMLAuthProvider(ssoProviderId)
        : new OAuthProvider(ssoProviderId);
      await reauthenticateWithPopup(curr, provider);
    } else {
      throw new Error("No se detectó un proveedor compatible para reautenticación.");
    }
    await curr.getIdToken(true);
    await refreshMfaState(curr);
  };

  const signOutUser = async (): Promise<void> => {
    setPendingMfaResolver(null);
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        mfaEnrolledFactors,
        hasActiveMfaSession,
        pendingMfaResolver,
        ssoProviderId,
        ssoProviderLabel,
        signInWithGoogle,
        signInWithInstitutionalSso,
        signInWithEmail,
        signUpWithEmail,
        resolveMfaSignIn,
        cancelMfaChallenge,
        startTotpEnrollment,
        finalizeTotpEnrollment,
        unenrollMfaFactor,
        resetPassword,
        resendVerification,
        reloadUserStatus,
        reauthenticateSession,
        authProviderKind,
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
