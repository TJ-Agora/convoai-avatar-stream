import { NextResponse } from "next/server";

import { authMode, getSessionUser } from "@/lib/auth";

/**
 * GET /api/auth/me
 *
 * Identity only — no database, no quota store.
 *
 * Use this when you added Agora SSO login but did NOT add the optional
 * demo time-limit layer (see docs/DEMO-QUOTA.md). For quota + remaining
 * time, use GET /api/session/me instead.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { authenticated: false, authMode: authMode() },
      { status: 200 },
    );
  }

  return NextResponse.json({
    authenticated: true,
    authMode: authMode(),
    user: { id: user.id, email: user.email, name: user.name },
  });
}
