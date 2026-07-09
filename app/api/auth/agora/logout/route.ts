import { NextResponse } from "next/server";

import { authMode, clearSessionCookie } from "@/lib/auth";
import { buildLogoutUrl } from "@/lib/agora-sso";

/**
 * GET /api/auth/agora/logout
 *
 * Clears our session cookie. In SSO mode we ALSO redirect through
 * Agora's logout endpoint so the user is signed out of the SSO
 * provider itself — otherwise hitting /api/auth/agora/start would
 * silently re-create a session for the same user.
 */
export async function GET(request: Request) {
  await clearSessionCookie();
  if (authMode() === "bypass") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  const homeUrl = new URL("/", request.url).toString();
  return NextResponse.redirect(buildLogoutUrl(homeUrl));
}
