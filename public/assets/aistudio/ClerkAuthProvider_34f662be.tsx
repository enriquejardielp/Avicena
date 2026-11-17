import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClerkProvider } from "@clerk/react";

const appearance = {
  variables: {
    colorPrimary: "#0284C7",
    colorPrimaryForeground: "#FFFFFF",
    colorForeground: "#0F172A",
    colorBackground: "#FFFFFF",
    colorBorder: "#E2E8F0",
    fontFamily: "'Plus Jakarta Sans Variable', system-ui, sans-serif",
    borderRadius: "0.85rem",
  },
};

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "";

interface ClerkConfig { enabled: boolean; publishable_key: string; proxy_url: string }

export default function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState<ClerkConfig | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async (attempt = 0) => {
      try {
        const cfg = (await (await fetch(`${BACKEND_URL}/api/clerk/config`)).json()) as ClerkConfig;
        if (cfg.enabled) {
          if (!cancelled) setConfig(cfg);
          return;
        }
      } catch {
        /* retry */
      }
      if (cancelled) return;
      if (attempt >= 20) {
        setUnavailable(true);
        return;
      }
      setTimeout(() => load(attempt + 1), 1500);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (unavailable)
    return <p style={{ padding: 24 }}>El inicio de sesión no está disponible ahora. Recarga la página para intentarlo de nuevo.</p>;
  if (!config)
    return (
      <div className="flex min-h-screen items-center justify-center" data-testid="auth-loading">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2 rounded-full bg-sky-600 animate-pulse-dot" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    );
  return (
    <ClerkProvider
      publishableKey={config.publishable_key}
      proxyUrl={config.proxy_url || undefined}
      appearance={appearance}
      routerPush={(to: string) => navigate(to)}
      routerReplace={(to: string) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/"
    >
      {children}
    </ClerkProvider>
  );
}
