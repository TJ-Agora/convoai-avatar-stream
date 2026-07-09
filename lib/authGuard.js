// Session gate for host-flavored API routes. In AUTH_MODE=bypass (local dev)
// getSessionUser() returns a synthetic user, so everything passes; in sso mode
// (production) requests without a valid session cookie are rejected — a leaked
// host link is useless without an Agora login. Guest APIs never use this.

import { NextResponse } from 'next/server';
import { getSessionUser } from './auth';

export async function requireSession() {
  const user = await getSessionUser();
  if (!user) {
    return {
      user: null,
      deny: NextResponse.json({ error: 'Unauthorized — sign in with Agora' }, { status: 401 }),
    };
  }
  return { user, deny: null };
}
