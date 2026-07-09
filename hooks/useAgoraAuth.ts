"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Client-side Agora SSO identity — no quota, no database.
 *
 * Polls GET /api/auth/me. Use this for login-gated demos that do not
 * need per-user time limits. For time budgets, use useAgoraSession()
 * (see docs/DEMO-QUOTA.md).
 */

export type AgoraAuthMe =
  | { authenticated: false; authMode: "sso" | "bypass" }
  | {
      authenticated: true;
      authMode: "sso" | "bypass";
      user: { id: string; email: string; name: string };
    };

export function useAgoraAuth() {
  const [me, setMe] = useState<AgoraAuthMe | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshMe = useCallback(async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const json = (await res.json()) as AgoraAuthMe;
    setMe(json);
    return json;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("authError");
    if (err) {
      setAuthError(err);
      params.delete("authError");
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`,
      );
    }
    void refreshMe().catch((err) =>
      console.error("[useAgoraAuth] me failed", err),
    );
  }, [refreshMe]);

  return {
    me,
    loading: me === null,
    authError,
    refreshMe,
    signInUrl: "/api/auth/agora/start",
    signOutUrl: "/api/auth/agora/logout",
  };
}
