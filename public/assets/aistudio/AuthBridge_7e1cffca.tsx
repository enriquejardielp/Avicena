import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, setTokenGetter } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import type { Me } from "@/lib/types";

/** Installs the Clerk token getter for api.ts and wipes cached data when the account changes. */
export function AuthBridge({ children }: { children: React.ReactNode }) {
  const { getToken, userId, isLoaded } = useAuth();
  if (isLoaded) setTokenGetter(() => getToken());
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) return;
    if (prev.current !== undefined && prev.current !== userId) queryClient.clear();
    prev.current = userId;
  }, [userId, isLoaded]);
  if (!isLoaded) return null;
  return <>{children}</>;
}

export function useMe() {
  const { isSignedIn } = useAuth();
  return useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/me"), enabled: !!isSignedIn, staleTime: 60_000 });
}
