/**
 * Agora SSO OAuth 2.0 authorization-code client (confidential client).
 *
 * The flow this file implements:
 *   1. Redirect the browser to `buildAuthorizeUrl(state)`.
 *   2. Agora SSO redirects back to AGORA_SSO_REDIRECT_URI with
 *      `?code=…&state=…`.
 *   3. Swap the code for a Bearer token via `exchangeCodeForToken()`.
 *   4. Fetch the user's profile via `fetchCustomer()`.
 *
 * We never persist Agora SSO tokens. We use the Bearer once at callback
 * to identify the user, then issue our own session JWT (see `auth.ts`).
 *
 * Doc reference (Agora internal): "SSO V2 / OAuth 授权接入指南" by
 * sunmingda. Endpoints below are for the international cluster; for
 * China set AGORA_SSO_BASE_URL=https://sso.shengwang.cn.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function ssoBaseUrl(): string {
  return (process.env.AGORA_SSO_BASE_URL || "https://sso2.agora.io").replace(
    /\/+$/,
    "",
  );
}

/**
 * The customer/profile API lives on a DIFFERENT host than the SSO
 * login UI. Confirmed paths (Swagger lives at /api-docs/v1/customer,
 * actual endpoints at /api/v0/customer/*):
 *   GET https://sso-open.agora.io/api/v0/customer/user-auth
 *   GET https://sso-open.agora.io/api/v0/customer/company/basic-info
 */
function ssoOpenHost(): string {
  return (
    process.env.AGORA_SSO_OPEN_HOST || "https://sso-open.agora.io"
  ).replace(/\/+$/, "");
}

function ssoClientId(): string {
  return requiredEnv("AGORA_SSO_CLIENT_ID");
}

function ssoClientSecret(): string {
  return requiredEnv("AGORA_SSO_CLIENT_SECRET");
}

export function ssoRedirectUri(): string {
  return requiredEnv("AGORA_SSO_REDIRECT_URI");
}

/**
 * Build the browser-facing authorize URL with a caller-supplied CSRF
 * `state`. The caller is responsible for persisting that state in a
 * cookie so it can be verified on the callback (see
 * `issueOAuthStateCookie()` in auth.ts).
 */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: ssoClientId(),
    redirect_uri: ssoRedirectUri(),
    // basic_info is enough to identify the user. Add "console" if you
    // need to call console-related OpenAPI endpoints.
    scope: "basic_info",
    state,
  });
  return `${ssoBaseUrl()}/api/v0/oauth/authorize?${params.toString()}`;
}

export function buildLogoutUrl(redirectUri: string): string {
  const params = new URLSearchParams({ redirect_uri: redirectUri });
  return `${ssoBaseUrl()}/api/v0/logout?${params.toString()}`;
}

// ---- Token exchange -------------------------------------------------

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

export async function exchangeCodeForToken(
  code: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: ssoClientId(),
    client_secret: ssoClientSecret(),
    code,
    redirect_uri: ssoRedirectUri(),
  });
  const res = await fetch(`${ssoBaseUrl()}/api/v0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SSO token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

// ---- Customer profile fetch ----------------------------------------

export type AgoraCustomer = {
  id: string;
  email: string;
  name: string;
  raw: Record<string, unknown>;
};

/**
 * Probe known /customer paths in order. A 200 with an unrecognized
 * payload should NOT abort the loop — we keep trying so a partial
 * deploy doesn't lock us out of login.
 */
export async function fetchCustomer(
  accessToken: string,
): Promise<AgoraCustomer> {
  const host = ssoOpenHost();
  const candidates = [
    `${host}/api/v0/customer/user-auth`,
    `${host}/api/v0/customer/company/basic-info`,
  ];
  let lastError: string | null = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = `${url} → ${res.status} ${text.slice(0, 200)}`;
        console.warn(`[sso] customer probe miss: ${lastError}`);
        continue;
      }
      const json = (await res.json()) as Record<string, unknown>;
      console.log(
        `[sso] customer probe hit ${url}, keys=${JSON.stringify(
          Object.keys(json),
        )}`,
      );
      // Agora wraps most responses in `{ code, message, data }`.
      const data =
        (json.data as Record<string, unknown> | undefined) ??
        (json.customer as Record<string, unknown> | undefined) ??
        json;
      try {
        return normalizeCustomer(data);
      } catch (normErr) {
        lastError = `${url} → 200 but ${(normErr as Error).message}`;
        console.warn(`[sso] ${lastError}`);
        continue;
      }
    } catch (err) {
      lastError = `${url} → ${(err as Error).message}`;
      console.warn(`[sso] customer probe threw: ${lastError}`);
    }
  }
  throw new Error(
    `Failed to fetch Agora customer profile. Last error: ${lastError ?? "unknown"}`,
  );
}

/**
 * Agora's profile responses are inconsistent across endpoints. We
 * probe several plausible field names for each of id/email/name and
 * fall back to whatever's stable.
 */
function normalizeCustomer(data: Record<string, unknown>): AgoraCustomer {
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const v = data[key];
      if (v == null) continue;
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
    return "";
  };

  const id =
    pick("customerId", "customer_id", "userId", "user_id", "id", "uid") ||
    pick("accountId", "account_id") ||
    pick("email", "emailAddress", "email_address", "loginEmail");
  const email = pick("email", "emailAddress", "email_address", "loginEmail");
  const name = pick(
    "name",
    "displayName",
    "display_name",
    "nickname",
    "fullName",
    "full_name",
    "username",
  );

  if (!id) {
    throw new Error(
      "Agora /customer response did not include a stable user identifier.",
    );
  }

  return {
    id,
    email,
    name: name || email || id,
    raw: data,
  };
}
