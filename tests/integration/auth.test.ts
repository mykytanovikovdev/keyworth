import { describe, expect, it } from "vitest";
import type { MeJson } from "../../shared/schemas/me.ts";
import {
  BASE_URL,
  expectWorkerHeaders,
  fetchWorker,
  invite,
  query,
  signInWithGoogle,
  uniqueUser,
} from "./helpers.ts";

async function me(cookie: string) {
  return fetchWorker("/api/me", { headers: { cookie } });
}

async function deleteAccount(cookie: string, origin = BASE_URL) {
  return fetchWorker("/api/auth/delete-user", {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: "{}",
  });
}

describe("GET /api/me", () => {
  it("returns 401 without a session", async () => {
    const response = await fetchWorker("/api/me");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expectWorkerHeaders(response);
  });

  it("returns 401 for a forged session cookie", async () => {
    const response = await me(
      "__Secure-better-auth.session_token=forged.value",
    );

    expect(response.status).toBe(401);
  });

  it("says how long the session still counts as a recent sign-in", async () => {
    const user = uniqueUser("fresh");
    await invite(user.email);
    const { cookie } = await signInWithGoogle(user);
    const freshFor = async (age: string) => {
      await query(
        `update session set created_at = now() - $2::interval
          where user_id = (select id from "user" where email = $1)`,
        [user.email, age],
      );
      return (await (await me(cookie)).json<MeJson>()).freshForSeconds;
    };

    expect(await freshFor("0 seconds")).toBeGreaterThan(590);
    expect(await freshFor("9 minutes")).toBeGreaterThan(50);
    expect(await freshFor("9 minutes")).toBeLessThanOrEqual(60);
    expect(await freshFor("10 minutes 1 second")).toBe(0);
    expect(await freshFor("2 days")).toBe(0);
  });
});

describe("sign-in with Google", () => {
  it("lets an invited user in and returns only their own profile", async () => {
    const alice = uniqueUser("alice");
    await invite(alice.email);

    const { callback, cookie } = await signInWithGoogle(alice);

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/");
    expectWorkerHeaders(callback);
    const response = await me(cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: expect.any(String) as string,
      name: alice.name,
      email: alice.email,
      freshForSeconds: expect.any(Number) as number,
    });
  });

  it("sets the session cookie httpOnly, Secure and SameSite=Lax", async () => {
    const user = uniqueUser("cookie");
    await invite(user.email);

    const { callback } = await signInWithGoogle(user);

    const session = callback.headers
      .getSetCookie()
      .find((cookie) =>
        cookie.startsWith("__Secure-better-auth.session_token="),
      );
    expect(session).toBeDefined();
    expect(session).toMatch(/; HttpOnly/i);
    expect(session).toMatch(/; Secure/i);
    expect(session).toMatch(/; SameSite=Lax/i);
  });

  it("keeps no Google tokens and no avatar URL", async () => {
    const user = uniqueUser("minimal");
    await invite(user.email);

    await signInWithGoogle(user);

    const [account] = await query(
      `select a.access_token, a.refresh_token, a.id_token, u.image
         from account a join "user" u on u.id = a.user_id where u.email = $1`,
      [user.email],
    );
    expect(account).toEqual({
      access_token: null,
      refresh_token: null,
      id_token: null,
      image: null,
    });
  });

  it("matches the invite list case-insensitively", async () => {
    const user = uniqueUser("mixed");
    await invite(user.email);

    const { cookie } = await signInWithGoogle({
      ...user,
      email: user.email.toUpperCase(),
    });

    expect((await me(cookie)).status).toBe(200);
  });

  it("turns away an email that is not on the invite list", async () => {
    const stranger = uniqueUser("stranger");

    const { callback, cookie } = await signInWithGoogle(stranger);

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toMatch(
      /^\/sign-in\?error=NOT_INVITED&/,
    );
    expect(cookie).not.toContain("session_token");
    expect(
      await query('select 1 from "user" where email = $1', [stranger.email]),
    ).toEqual([]);
  });

  it("turns away an invited email that Google has not verified", async () => {
    const user = uniqueUser("unverified");
    await invite(user.email);

    const { callback } = await signInWithGoogle({
      ...user,
      emailVerified: false,
    });

    expect(callback.headers.get("location")).toMatch(
      /^\/sign-in\?error=NOT_INVITED&/,
    );
  });

  it("blocks the next sign-in once an email is removed from the list", async () => {
    const user = uniqueUser("removed");
    await invite(user.email);
    await signInWithGoogle(user);
    await query("delete from allowed_emails where email = $1", [user.email]);

    const { callback, cookie } = await signInWithGoogle(user);

    expect(callback.headers.get("location")).toMatch(
      /^\/sign-in\?error=NOT_INVITED&/,
    );
    expect(cookie).not.toContain("session_token");
  });
});

describe("sessions", () => {
  it("stops working as soon as the user signs out", async () => {
    const user = uniqueUser("signout");
    await invite(user.email);
    const { cookie } = await signInWithGoogle(user);

    const signOut = await fetchWorker("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie, origin: BASE_URL },
    });

    expect(signOut.status).toBe(200);
    expect((await me(cookie)).status).toBe(401);
  });

  it("rejects a cross-site request that carries the session cookie", async () => {
    const user = uniqueUser("csrf");
    await invite(user.email);
    const { cookie } = await signInWithGoogle(user);

    const response = await fetchWorker("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie, origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    expect((await me(cookie)).status).toBe(200);
  });
});

describe("account deletion", () => {
  it("deletes only the signed-in user, with their sessions", async () => {
    const alice = uniqueUser("alice");
    const bob = uniqueUser("bob");
    await invite(alice.email);
    await invite(bob.email);
    const aliceSession = await signInWithGoogle(alice);
    const bobSession = await signInWithGoogle(bob);

    const response = await deleteAccount(aliceSession.cookie);

    expect(response.status).toBe(200);
    expect((await me(aliceSession.cookie)).status).toBe(401);
    expect(
      await query('select 1 from "user" where email = $1', [alice.email]),
    ).toEqual([]);
    const bobMe = await me(bobSession.cookie);
    expect(bobMe.status).toBe(200);
    expect(await bobMe.json()).toMatchObject({ email: bob.email });
  });

  it("requires a sign-in from the last 10 minutes", async () => {
    const user = uniqueUser("stale");
    await invite(user.email);
    const { cookie } = await signInWithGoogle(user);
    await query(
      `update session set created_at = now() - interval '11 minutes'
        where user_id = (select id from "user" where email = $1)`,
      [user.email],
    );

    const response = await deleteAccount(cookie);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
    expect(
      await query('select 1 from "user" where email = $1', [user.email]),
    ).toHaveLength(1);
  });
});

describe("rate limiting", () => {
  it("allows three sign-in attempts per 10 seconds from one address", async () => {
    const { ip } = uniqueUser("limited");
    const attempt = () =>
      fetchWorker("/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: BASE_URL,
          "cf-connecting-ip": ip,
        },
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      });

    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await attempt()).status);

    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});
