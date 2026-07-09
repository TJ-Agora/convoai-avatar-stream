/**
 * Session + auth-mode helpers.
 *
 * Two pieces live here:
 *   1. `authMode()` — single source of truth for which auth path the
 *      app is on. Reads AUTH_MODE and applies the
 *      ALLOW_BYPASS_IN_PRODUCTION safety net.
 *   2. Session JWT helpers — sign, verify, set, clear, and read the
 *      session cookie. Uses HS256 with SESSION_JWT_SECRET via `jose`.
 *
 * The session cookie is HttpOnly + SameSite=Lax + Secure (when HTTPS),
 * so the JWT is never readable from client JS. The frontend learns
 * who the user is via `/api/session/me`, not by parsing the cookie.
 */

import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

// ---- Auth mode ------------------------------------------------------

export type AuthMode = "sso" | "bypass";

/**
 * Returns the effective auth mode for this process.
 *
 * Rules:
 *   - AUTH_MODE=sso → "sso"
 *   - AUTH_MODE unset + NODE_ENV !== production → "bypass" (dev default:
 *     synthetic user, no credentials needed)
 *   - AUTH_MODE=bypass + NODE_ENV !== production → "bypass"
 *   - AUTH_MODE=bypass + NODE_ENV === production + ALLOW_BYPASS_IN_PRODUCTION=true → "bypass"
 *   - AUTH_MODE=bypass + NODE_ENV === production + no override → "sso" (safety net)
 *   - anything else → "sso" (safe default — production always fails closed)
 */
export function authMode(): AuthMode {
  const raw = (process.env.AUTH_MODE || "").toLowerCase();
  if (raw === "" && process.env.NODE_ENV !== "production") return "bypass";
  if (raw === "bypass") {
    if (process.env.NODE_ENV !== "production") return "bypass";
    if (process.env.ALLOW_BYPASS_IN_PRODUCTION === "true") return "bypass";
    // Production deploys default to SSO even if AUTH_MODE=bypass is set,
    // so a stray env var can never accidentally disable auth on prod.
    return "sso";
  }
  return "sso";
}

// ---- Session JWT ----------------------------------------------------

export const SESSION_COOKIE = "agora_session";
export const OAUTH_STATE_COOKIE = "agora_oauth_state";

/** Session payload — keep this small; it goes in every request. */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

function secretKey(): Uint8Array {
  const raw = process.env.SESSION_JWT_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      "SESSION_JWT_SECRET is not set or is shorter than 32 chars. Generate one with `openssl rand -hex 48`.",
    );
  }
  return new TextEncoder().encode(raw);
}

export async function signSession(user: SessionUser): Promise<string> {
  return await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setSubject(user.id)
    .sign(secretKey());
}

export async function verifySession(jwt: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(jwt, secretKey(), {
      algorithms: ["HS256"],
    });
    const id = typeof payload.id === "string" ? payload.id : null;
    const email = typeof payload.email === "string" ? payload.email : "";
    const name = typeof payload.name === "string" ? payload.name : "";
    if (!id) return null;
    return { id, email, name };
  } catch {
    return null;
  }
}

/**
 * Read the session cookie and verify it. Returns the synthetic demo
 * user in bypass mode so route handlers can be written uniformly.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (authMode() === "bypass") {
    return {
      id: "bypass-user",
      email: "demo@local",
      name: "Demo User",
    };
  }
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return await verifySession(token);
}

export async function setSessionCookie(jwt: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

// ---- OAuth state cookie (CSRF) -------------------------------------

const OAUTH_STATE_TTL_SECONDS = 60 * 10; // 10 min — plenty for a login.

/**
 * Generate a fresh CSRF state, persist it in a short-lived cookie,
 * and return the value so it can be forwarded to the authorize URL.
 * The callback handler reads the cookie back via
 * `consumeOAuthStateCookie()` and compares to the `state` query param.
 */
export async function issueOAuthStateCookie(): Promise<string> {
  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  return state;
}

/** Read + clear the state cookie atomically. Returns null if missing. */
export async function consumeOAuthStateCookie(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(OAUTH_STATE_COOKIE)?.value ?? null;
  if (value !== null) jar.delete(OAUTH_STATE_COOKIE);
  return value;
}
