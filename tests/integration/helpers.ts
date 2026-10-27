import { env, exports } from "cloudflare:workers";
import { expect, vi } from "vitest";
import { Pool } from "pg";

// Must match BETTER_AUTH_URL in vitest.config.ts.
export const BASE_URL = "https://keyworth.test";

export const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`${BASE_URL}${path}`, init));

// Headers every Worker response must carry, whatever the route or status.
const WORKER_HEADERS = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-robots-tag": "noindex, nofollow",
};

export function expectWorkerHeaders(response: Response) {
  for (const [name, value] of Object.entries(WORKER_HEADERS)) {
    expect(response.headers.get(name), name).toBe(value);
  }
  expect(response.headers.has("x-powered-by")).toBe(false);
}

/** Runs SQL against the test database as the Worker's restricted role. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString });
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

/** A unique identity per test, so tests never share users or rate limits. */
export function uniqueUser(label: string) {
  const id = crypto.randomUUID().slice(0, 8);
  const [a = 0, b = 0, c = 0] = crypto.getRandomValues(new Uint8Array(3));
  return {
    email: `${label}-${id}@example.com`,
    name: `Test ${label}`,
    // Better Auth reads the client IP from cf-connecting-ip for rate limits.
    ip: `10.${String(a)}.${String(b)}.${String(c)}`,
  };
}

interface ApiOptions {
  cookie: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Sent on every state-changing request, as a browser would. */
  origin?: string | null;
}

/** A JSON request to the app's own API, signed in with `cookie`. */
export function api(
  path: string,
  { cookie, method = "GET", body, origin = BASE_URL }: ApiOptions,
) {
  const headers: Record<string, string> = { cookie };
  if (method !== "GET" && origin !== null) headers.origin = origin;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetchWorker(path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

/** Signs a new invited user in and returns their cookie and id. */
export async function signedIn(label: string) {
  const user = uniqueUser(label);
  await invite(user.email);
  const { cookie } = await signInWithGoogle(user);
  const [row] = await query<{ id: string }>(
    'select id from "user" where email = $1',
    [user.email],
  );
  if (!row) throw new Error("Sign-in did not create the user");
  return { ...user, cookie, userId: row.id };
}

export async function invite(email: string) {
  await query("insert into allowed_emails (email) values ($1)", [
    email.toLowerCase(),
  ]);
}

function base64Url(value: object): string {
  return btoa(JSON.stringify(value))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

interface GoogleProfile {
  email: string;
  name: string;
  emailVerified?: boolean;
}

/**
 * Stands in for Google's token endpoint. In the authorization-code flow Better
 * Auth receives the ID token straight from Google over TLS and only decodes it,
 * so an unsigned token with the right claims exercises the real code path.
 */
function mockGoogle(profile: GoogleProfile) {
  const realFetch = globalThis.fetch;
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request ? input.url : new URL(input).toString();
      if (url !== "https://oauth2.googleapis.com/token") {
        return realFetch(input, init);
      }
      const idToken = [
        base64Url({ alg: "RS256", typ: "JWT" }),
        base64Url({
          iss: "https://accounts.google.com",
          sub: `google-${profile.email}`,
          email: profile.email,
          email_verified: profile.emailVerified ?? true,
          name: profile.name,
          picture: "https://lh3.googleusercontent.com/a/avatar",
        }),
        "signature",
      ].join(".");
      return Promise.resolve(
        Response.json({
          access_token: "google-access-token",
          refresh_token: "google-refresh-token",
          id_token: idToken,
          expires_in: 3599,
          token_type: "Bearer",
          scope: "openid email profile",
        }),
      );
    });
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

export interface SignInResult {
  /** The OAuth callback's response: a redirect to the app. */
  callback: Response;
  /** Cookies to send on later requests (empty when sign-in failed). */
  cookie: string;
}

/**
 * Walks the whole Google sign-in as a browser would: start the flow (state
 * cookie), come back to the callback with a code, follow nothing else.
 */
export async function signInWithGoogle(
  profile: GoogleProfile & { ip: string },
): Promise<SignInResult> {
  const google = mockGoogle(profile);
  try {
    const start = await fetchWorker("/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        "cf-connecting-ip": profile.ip,
      },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/sign-in",
      }),
    });
    expect(start.status).toBe(200);
    const { url } = await start.json<{ url: string }>();
    const state = new URL(url).searchParams.get("state") ?? "";

    const callback = await fetchWorker(
      `/api/auth/callback/google?code=test-code&state=${state}`,
      {
        headers: {
          cookie: cookieHeader(start),
          "cf-connecting-ip": profile.ip,
        },
        redirect: "manual",
      },
    );
    return { callback, cookie: cookieHeader(callback) };
  } finally {
    google.mockRestore();
  }
}
