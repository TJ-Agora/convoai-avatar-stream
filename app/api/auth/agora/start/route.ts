import { NextResponse } from "next/server";

import { authMode, issueOAuthStateCookie, issueReturnPathCookie, sanitizeReturnPath } from "@/lib/auth";
import { buildAuthorizeUrl } from "@/lib/agora-sso";

/**
 * GET /api/auth/agora/start
 *
 * Kicks off the OAuth authorization-code flow. Issues a CSRF state
 * cookie and 307s the browser to Agora SSO. The matching callback at
 * /api/auth/agora/callback handles the response.
 *
 * In bypass mode this is a no-op redirect — the synthetic demo user
 * is already "logged in" via authMode() returning "bypass".
 */
export async function GET(request: Request) {
  // Optional ?next=<same-origin path> — where to land after login (preserves
  // e.g. /?avatar=lemonslice or a /manage/... link through the round-trip).
  const next = sanitizeReturnPath(new URL(request.url).searchParams.get("next"));
  if (authMode() === "bypass") {
    return NextResponse.redirect(new URL(next ?? "/", request.url));
  }
  const state = await issueOAuthStateCookie();
  if (next) await issueReturnPathCookie(next);
  return NextResponse.redirect(buildAuthorizeUrl(state));
}
