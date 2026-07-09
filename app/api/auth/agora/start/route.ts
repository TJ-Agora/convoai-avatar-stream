import { NextResponse } from "next/server";

import { authMode, issueOAuthStateCookie } from "@/lib/auth";
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
  if (authMode() === "bypass") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  const state = await issueOAuthStateCookie();
  return NextResponse.redirect(buildAuthorizeUrl(state));
}
