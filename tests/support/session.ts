import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { testUtils, type TestHelpers } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { authOptions } from "../../worker/auth.ts";
import * as schema from "../../worker/db/schema.ts";

/*
 * Signed-in browser sessions for Playwright, without Google. Better Auth's
 * testUtils plugin writes a user and a session straight into the test database
 * and returns the signed cookie. It lives only in this Node-side, test-only
 * auth instance: the Worker has no test routes and no test code.
 */

/** Fake values the e2e and visual servers run with; nothing real. */
export const TEST_SECRETS = {
  BETTER_AUTH_SECRET: "browser-tests-only-0123456789abcdef",
  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  COINGECKO_API_KEY: "test-coingecko-key",
};

/** `wrangler dev` flags that give a local server the values above. */
export function testServerVars(baseURL: string): string {
  return Object.entries({ ...TEST_SECRETS, BETTER_AUTH_URL: baseURL })
    .map(([name, value]) => `--var ${name}:${value}`)
    .join(" ");
}

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
  expires: number;
}

/**
 * Invites the email, creates the user and signs them in. Runs the production
 * auth options, so the invite-list hooks apply here too.
 */
export async function createSignedInUser(options: {
  databaseUrl: string;
  baseURL: string;
  email: string;
  name: string;
}): Promise<BrowserCookie[]> {
  const pool = new Pool({ connectionString: options.databaseUrl });
  try {
    await pool.query(
      "insert into allowed_emails (email) values ($1) on conflict do nothing",
      [options.email.toLowerCase()],
    );
    const auth = betterAuth({
      ...authOptions(drizzle(pool, { schema }), {
        ...TEST_SECRETS,
        BETTER_AUTH_URL: options.baseURL,
      }),
      // The plugin's declared types clash with exactOptionalPropertyTypes
      // (an optional field typed `| undefined`); its runtime shape is fine.
      plugins: [testUtils() as unknown as BetterAuthPlugin],
    });
    const { test } = (await auth.$context) as unknown as { test: TestHelpers };
    const user = await test.saveUser(
      test.createUser({
        email: options.email,
        name: options.name,
        emailVerified: true,
      }),
    );
    const { cookies } = await test.login({ userId: user.id });
    return cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: new URL(options.baseURL).hostname,
      path: cookie.path,
      httpOnly: cookie.httpOnly ?? true,
      secure: cookie.secure ?? false,
      sameSite: cookie.sameSite ?? "Lax",
      expires: cookie.expires ?? -1,
    }));
  } finally {
    await pool.end();
  }
}
