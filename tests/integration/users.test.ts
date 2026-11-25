import { env } from "cloudflare:workers";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  block,
  deleteAccount,
  invite,
  listSessions,
  listUsers,
  parseEmail,
  revoke,
  unblock,
  uninvite,
} from "../../scripts/user-admin.ts";
import {
  fetchWorker,
  invite as addInvite,
  query,
  signInWithGoogle,
  uniqueUser,
} from "./helpers.ts";

// The operations behind `npm run users`, run as the Worker's restricted role
// (they must need nothing more than DML) next to real sign-ins. Never ended:
// see worker/db/client.ts.
const pool = new Pool({
  connectionString: env.HYPERDRIVE.connectionString,
  idleTimeoutMillis: 0,
});

const status = async (cookie: string) =>
  (await fetchWorker("/api/me", { headers: { cookie } })).status;

const NOT_INVITED = /^\/sign-in\?error=NOT_INVITED&/;

describe("block", () => {
  it("ends the sessions at once and keeps the email out", async () => {
    const user = uniqueUser("blocked");
    await addInvite(user.email);
    const { cookie } = await signInWithGoogle(user);
    expect(await status(cookie)).toBe(200);

    expect(await block(pool, user.email, "spam")).toEqual({
      newlyBlocked: true,
      uninvited: true,
      revoked: 1,
    });

    expect(await status(cookie)).toBe(401);
    const again = await signInWithGoogle(user);
    expect(again.callback.headers.get("location")).toMatch(NOT_INVITED);
    expect(await invite(pool, user.email)).toBe("blocked");
    expect(
      await query("select reason from blocked_emails where email = $1", [
        user.email,
      ]),
    ).toEqual([{ reason: "spam" }]);
  });

  it("keeps the account and its data until it is deleted", async () => {
    const user = uniqueUser("kept");
    await addInvite(user.email);
    await signInWithGoogle(user);

    await block(pool, user.email, null);

    expect(
      await query('select 1 from "user" where email = $1', [user.email]),
    ).toHaveLength(1);
  });

  it("is idempotent", async () => {
    const user = uniqueUser("twice");
    await block(pool, user.email, null);

    expect(await block(pool, user.email, "again")).toEqual({
      newlyBlocked: false,
      uninvited: false,
      revoked: 0,
    });
  });
});

describe("the sign-in hooks", () => {
  it("refuse a new account for a blocked email that is still invited", async () => {
    const user = uniqueUser("reinvited");
    await addInvite(user.email);
    await query("insert into blocked_emails (email) values ($1)", [user.email]);

    const { callback, cookie } = await signInWithGoogle(user);

    expect(callback.headers.get("location")).toMatch(NOT_INVITED);
    expect(cookie).not.toContain("session_token");
    expect(
      await query('select 1 from "user" where email = $1', [user.email]),
    ).toEqual([]);
  });

  it("refuse a new session for an existing account once it is blocked", async () => {
    const user = uniqueUser("existing");
    await addInvite(user.email);
    await signInWithGoogle(user);
    await query("insert into blocked_emails (email) values ($1)", [user.email]);

    const { callback } = await signInWithGoogle(user);

    expect(callback.headers.get("location")).toMatch(NOT_INVITED);
  });
});

describe("unblock", () => {
  it("lifts the block without inviting again", async () => {
    const user = uniqueUser("forgiven");
    await block(pool, user.email, null);

    expect(await unblock(pool, user.email)).toBe(true);
    expect(await unblock(pool, user.email)).toBe(false);
    expect(
      (await signInWithGoogle(user)).callback.headers.get("location"),
    ).toMatch(NOT_INVITED);

    expect(await invite(pool, user.email)).toBe("invited");
    const { cookie } = await signInWithGoogle(user);
    expect(await status(cookie)).toBe(200);
  });
});

describe("invite", () => {
  it("adds an email once", async () => {
    const user = uniqueUser("new");

    expect(await invite(pool, user.email)).toBe("invited");
    expect(await invite(pool, user.email)).toBe("already invited");
  });
});

describe("revoke", () => {
  it("ends every session, but the user may sign in again", async () => {
    const user = uniqueUser("revoked");
    await addInvite(user.email);
    const laptop = await signInWithGoogle(user);
    const phone = await signInWithGoogle(user);

    expect(await revoke(pool, user.email)).toBe(2);

    expect(await status(laptop.cookie)).toBe(401);
    expect(await status(phone.cookie)).toBe(401);
    const { cookie } = await signInWithGoogle(user);
    expect(await status(cookie)).toBe(200);
  });
});

describe("uninvite", () => {
  it("ends the sessions and stops the next sign-in", async () => {
    const user = uniqueUser("uninvited");
    await addInvite(user.email);
    const { cookie } = await signInWithGoogle(user);

    expect(await uninvite(pool, user.email)).toEqual({
      uninvited: true,
      revoked: 1,
    });

    expect(await status(cookie)).toBe(401);
    expect(
      (await signInWithGoogle(user)).callback.headers.get("location"),
    ).toMatch(NOT_INVITED);
  });
});

describe("sessions", () => {
  it("shows where each session came from, never its token", async () => {
    const user = uniqueUser("watched");
    await addInvite(user.email);
    await signInWithGoogle(user);
    const [stored] = await query<{ token: string }>(
      `select token from session
        where user_id = (select id from "user" where email = $1)`,
      [user.email],
    );

    const sessions = await listSessions(pool, user.email);

    expect(sessions).toEqual([
      expect.objectContaining({ ipAddress: user.ip }) as unknown,
    ]);
    expect(JSON.stringify(sessions)).not.toContain(stored?.token);
    expect(Object.keys(sessions[0] ?? {})).not.toContain("token");
  });
});

describe("delete", () => {
  it("removes the account with its sessions and its Google link", async () => {
    const user = uniqueUser("deleted");
    await addInvite(user.email);
    const { cookie } = await signInWithGoogle(user);
    const [account] = await query<{ id: string }>(
      'select id from "user" where email = $1',
      [user.email],
    );

    expect(await deleteAccount(pool, user.email)).toEqual({
      deleted: true,
      stillInvited: true,
    });

    expect(await status(cookie)).toBe(401);
    for (const table of ["session", "account"]) {
      expect(
        await query(`select 1 from ${table} where user_id = $1`, [account?.id]),
      ).toEqual([]);
    }
    expect(await deleteAccount(pool, user.email)).toEqual({
      deleted: false,
      stillInvited: true,
    });
  });
});

describe("list", () => {
  it("shows every known email with its state", async () => {
    const active = uniqueUser("active");
    const waiting = uniqueUser("waiting");
    const banned = uniqueUser("banned");
    await addInvite(active.email);
    await addInvite(waiting.email);
    await signInWithGoogle(active);
    await block(pool, banned.email, "abuse");

    const users = await listUsers(pool);
    const mine = (email: string) => users.find((user) => user.email === email);

    expect(mine(active.email)).toMatchObject({
      invited: true,
      blocked: false,
      hasAccount: true,
      sessions: 1,
    });
    expect(mine(active.email)?.lastActive).toBeInstanceOf(Date);
    expect(mine(waiting.email)).toMatchObject({
      invited: true,
      hasAccount: false,
      sessions: 0,
      lastActive: null,
    });
    expect(mine(banned.email)).toMatchObject({
      invited: false,
      blocked: true,
      reason: "abuse",
    });
  });
});

describe("parseEmail", () => {
  it("lowercases and trims, and rejects what is not an email", () => {
    expect(parseEmail("  Friend@Example.COM ")).toBe("friend@example.com");
    expect(parseEmail("not-an-email")).toBeNull();
    expect(parseEmail(undefined)).toBeNull();
  });
});
