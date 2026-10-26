// The operations behind `npm run users` (scripts/users.ts), kept free of
// argument parsing and printing so the Worker tests can run them against the
// test database next to a real sign-in.
//
// Everything here is plain DML, so it works with the Worker's restricted role
// as well as with the schema owner. Each change that touches several tables is
// a single statement (data-modifying CTEs), so it applies completely or not
// at all without holding a transaction open.
import type { Pool } from "pg";

export interface UserRow {
  email: string;
  invited: boolean;
  blocked: boolean;
  reason: string | null;
  hasAccount: boolean;
  /** Sessions that have not expired yet. */
  sessions: number;
  lastActive: Date | null;
}

export interface SessionRow {
  createdAt: Date;
  lastActive: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export type InviteResult = "invited" | "already invited" | "blocked";

/** Lowercase and trimmed, or null when it does not look like an email. */
export function parseEmail(value: string | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  // Deliberately loose: Google has already verified the address at sign-in.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Every email the database knows: invited, blocked or with an account. */
export async function listUsers(pool: Pool): Promise<UserRow[]> {
  const { rows } = await pool.query<UserRow>(
    `with emails as (
       select email from allowed_emails
       union select email from blocked_emails
       union select lower(email) from "user"
     )
     select e.email,
            exists (select 1 from allowed_emails a where a.email = e.email) as "invited",
            b.email is not null as "blocked",
            b.reason,
            u.id is not null as "hasAccount",
            (select count(*)::int from session s
              where s.user_id = u.id and s.expires_at > now()) as "sessions",
            (select max(s.updated_at) from session s
              where s.user_id = u.id) as "lastActive"
       from emails e
       left join blocked_emails b on b.email = e.email
       left join "user" u on lower(u.email) = e.email
      order by e.email`,
  );
  return rows;
}

/**
 * Live sessions with where they came from. The session token is a bearer
 * credential and is never selected.
 */
export async function listSessions(
  pool: Pool,
  email: string,
): Promise<SessionRow[]> {
  const { rows } = await pool.query<SessionRow>(
    `select s.created_at as "createdAt", s.updated_at as "lastActive",
            s.expires_at as "expiresAt", s.ip_address as "ipAddress",
            s.user_agent as "userAgent"
       from session s
       join "user" u on u.id = s.user_id
      where lower(u.email) = $1 and s.expires_at > now()
      order by s.updated_at desc`,
    [email],
  );
  return rows;
}

/** Adds the invite unless the email is blocked. */
export async function invite(pool: Pool, email: string): Promise<InviteResult> {
  const { rows } = await pool.query<{ added: boolean; blocked: boolean }>(
    `with added as (
       insert into allowed_emails (email)
       select $1 where not exists (select 1 from blocked_emails where email = $1)
       on conflict do nothing
       returning email
     )
     select exists (select 1 from added) as "added",
            exists (select 1 from blocked_emails where email = $1) as "blocked"`,
    [email],
  );
  const [row] = rows;
  if (row?.added) return "invited";
  return row?.blocked ? "blocked" : "already invited";
}

/** Ends every session of the account; it can sign in again if still invited. */
export async function revoke(pool: Pool, email: string): Promise<number> {
  const { rowCount } = await pool.query(
    `delete from session
      where user_id in (select id from "user" where lower(email) = $1)`,
    [email],
  );
  return rowCount ?? 0;
}

/** Removes the invite and ends the sessions, so access stops right away. */
export async function uninvite(
  pool: Pool,
  email: string,
): Promise<{ uninvited: boolean; revoked: number }> {
  const { rows } = await pool.query<{ uninvited: boolean; revoked: number }>(
    `with uninvited as (
       delete from allowed_emails where email = $1 returning email
     ), revoked as (
       delete from session
        where user_id in (select id from "user" where lower(email) = $1)
       returning id
     )
     select exists (select 1 from uninvited) as "uninvited",
            (select count(*)::int from revoked) as "revoked"`,
    [email],
  );
  return rows[0] ?? { uninvited: false, revoked: 0 };
}

/**
 * Blocks the email, removes its invite and ends its sessions. The account and
 * its data stay until `deleteAccount`, so they can be looked at first.
 */
export async function block(
  pool: Pool,
  email: string,
  reason: string | null,
): Promise<{ newlyBlocked: boolean; uninvited: boolean; revoked: number }> {
  const { rows } = await pool.query<{
    newlyBlocked: boolean;
    uninvited: boolean;
    revoked: number;
  }>(
    `with blocked as (
       insert into blocked_emails (email, reason) values ($1, $2)
       on conflict do nothing
       returning email
     ), uninvited as (
       delete from allowed_emails where email = $1 returning email
     ), revoked as (
       delete from session
        where user_id in (select id from "user" where lower(email) = $1)
       returning id
     )
     select exists (select 1 from blocked) as "newlyBlocked",
            exists (select 1 from uninvited) as "uninvited",
            (select count(*)::int from revoked) as "revoked"`,
    [email, reason],
  );
  return rows[0] ?? { newlyBlocked: false, uninvited: false, revoked: 0 };
}

/** Lifts the block. It does not invite the email again. */
export async function unblock(pool: Pool, email: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "delete from blocked_emails where email = $1",
    [email],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Deletes the account and, through foreign keys, its sessions, its Google link
 * and every row that references the user (encrypted data from phase 3 on).
 * The invite and any block are left as they are.
 */
export async function deleteAccount(
  pool: Pool,
  email: string,
): Promise<{ deleted: boolean; stillInvited: boolean }> {
  const { rows } = await pool.query<{
    deleted: boolean;
    stillInvited: boolean;
  }>(
    `with deleted as (
       delete from "user" where lower(email) = $1 returning id
     )
     select exists (select 1 from deleted) as "deleted",
            exists (select 1 from allowed_emails where email = $1) as "stillInvited"`,
    [email],
  );
  return rows[0] ?? { deleted: false, stillInvited: false };
}
