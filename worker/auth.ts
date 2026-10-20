import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { Database } from "./db/client.ts";
import * as schema from "./db/schema.ts";

export interface AuthEnv {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

/** Signing in requires a fresh session at most this old to delete the account. */
export const FRESH_SESSION_SECONDS = 10 * 60;

/**
 * Thrown from the database hooks. Because it carries a code, Better Auth's OAuth
 * callback turns it into a redirect to `/sign-in?error=NOT_INVITED` instead of a
 * bare JSON error page; the sign-in screen maps known codes to its own text.
 */
const notInvited = () =>
  new APIError("FORBIDDEN", {
    code: "NOT_INVITED",
    message: "This Google account is not on the invite list.",
  });

async function isInvited(db: Database, email: string): Promise<boolean> {
  const rows = await db
    .select({ email: schema.allowedEmails.email })
    .from(schema.allowedEmails)
    .where(eq(schema.allowedEmails.email, email.toLowerCase()))
    .limit(1);
  return rows.length > 0;
}

// Google tokens would let whoever reads the database act on the user's Google
// account. Keyworth only needs to know who signed in, so they are never stored.
const withoutTokens = <T extends object>(account: T) => ({
  data: {
    ...account,
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
  },
});

/**
 * Options shared by the Worker and the test-only auth instance, so tests
 * exercise exactly the production configuration.
 */
export function authOptions(db: Database, env: AuthEnv) {
  return {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
      },
    },
    emailAndPassword: { enabled: false },
    session: {
      // Re-check the database on every request, so a deleted or revoked
      // session stops working immediately.
      cookieCache: { enabled: false },
      freshAge: FRESH_SESSION_SECONDS,
    },
    user: { deleteUser: { enabled: true } },
    account: { updateAccountOnSignIn: false },
    // Workers have no shared memory between requests, so limits live in Postgres.
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      // Set by Cloudflare's edge; the client cannot spoof it.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          // The closed beta: only invited, Google-verified emails get an account.
          before: async (user) => {
            if (!user.emailVerified || !(await isInvited(db, user.email))) {
              throw notInvited();
            }
            // The avatar is never shown (img-src 'self'), so its URL is not kept.
            return { data: { ...user, image: null } };
          },
        },
      },
      session: {
        create: {
          // Checked on every sign-in too: removing an email from the list
          // blocks its next sign-in, not just new accounts.
          before: async (session) => {
            const [owner] = await db
              .select({ email: schema.user.email })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .limit(1);
            if (!owner || !(await isInvited(db, owner.email))) {
              throw notInvited();
            }
          },
        },
      },
      account: {
        create: {
          before: (account) => Promise.resolve(withoutTokens(account)),
        },
        update: {
          before: (account) => Promise.resolve(withoutTokens(account)),
        },
      },
    },
  } satisfies BetterAuthOptions;
}

export function createAuth(db: Database, env: AuthEnv) {
  return betterAuth(authOptions(db, env));
}

export type Auth = ReturnType<typeof createAuth>;
