// Manages who can use Keyworth: invites, sessions, blocks and account deletion.
//
//   npm run users -- list
//   npm run users -- sessions <email>
//   npm run users -- invite <email>
//   npm run users -- uninvite <email>
//   npm run users -- revoke <email>
//   npm run users -- block <email> [--reason "<why>"]
//   npm run users -- unblock <email>
//   npm run users -- delete <email>
//
// Targets DATABASE_URL when it is set (for production: the Neon owner
// connection string), otherwise the local database from compose.yaml. The
// target host is printed first, so a command never runs against the wrong one
// unnoticed. Emails are personal data: they live in the database, never in code.
// There is deliberately no admin page or HTTP route for any of this.
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { Pool } from "pg";
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
} from "./user-admin.ts";

const LOCAL_DATABASE =
  "postgres://keyworth_owner:keyworth_owner@localhost:5433/keyworth";

const USAGE = `Usage: npm run users -- <command>

  list                              everyone: invited, blocked, with an account
  sessions <email>                  live sessions with IP address and browser
  invite <email>                    allow sign-in (refused for a blocked email)
  uninvite <email>                  remove the invite and end all sessions
  revoke <email>                    end all sessions; they can sign in again
  block <email> [--reason "<why>"]  block, remove the invite, end all sessions
  unblock <email>                   lift the block (does not invite again)
  delete <email>                    delete the account and all its data`;

function fail(message = USAGE): never {
  console.error(message);
  process.exit(1);
}

const { positionals, values } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: { reason: { type: "string" } },
    });
  } catch (error) {
    return fail(`${(error as Error).message}\n\n${USAGE}`);
  }
})();
const [command, rawEmail] = positionals;

function email(): string {
  return parseEmail(rawEmail) ?? fail();
}

// Dates in the machine's own time zone: this runs on the owner's computer.
const when = (date: Date | null) =>
  date
    ? date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "-";

async function confirmDelete(target: string): Promise<boolean> {
  if (!process.stdin.isTTY)
    fail("delete asks for confirmation; run it in a terminal.");
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(
      `This permanently deletes ${target}'s account and everything stored with it.\nType the email again to confirm: `,
    );
    return answer.trim().toLowerCase() === target;
  } finally {
    prompt.close();
  }
}

const connectionString = process.env.DATABASE_URL ?? LOCAL_DATABASE;
const { hostname, pathname } = new URL(connectionString);
console.log(`Database: ${hostname}${pathname}`);
const pool = new Pool({ connectionString });

try {
  switch (command) {
    case "list": {
      const users = await listUsers(pool);
      if (!users.length) {
        console.log("(nobody yet)");
        break;
      }
      console.table(
        users.map((user) => ({
          email: user.email,
          status: user.blocked
            ? `blocked${user.reason ? `: ${user.reason}` : ""}`
            : user.invited
              ? "invited"
              : "not invited",
          account: user.hasAccount ? "yes" : "no",
          sessions: user.sessions,
          "last active": when(user.lastActive),
        })),
      );
      break;
    }
    case "sessions": {
      const sessions = await listSessions(pool, email());
      if (!sessions.length) {
        console.log("No live sessions.");
        break;
      }
      console.table(
        sessions.map((session) => ({
          "signed in": when(session.createdAt),
          "last active": when(session.lastActive),
          expires: when(session.expiresAt),
          ip: session.ipAddress ?? "-",
          browser: session.userAgent?.slice(0, 60) ?? "-",
        })),
      );
      break;
    }
    case "invite": {
      const target = email();
      const result = await invite(pool, target);
      console.log(
        result === "blocked"
          ? `${target} is blocked; run unblock first if that is intended.`
          : result === "invited"
            ? `${target}: invited. While the Google app is in Testing, also add it to its test users.`
            : `${target} was already invited.`,
      );
      break;
    }
    case "uninvite": {
      const target = email();
      const { uninvited, revoked } = await uninvite(pool, target);
      console.log(
        `${target}: ${uninvited ? "invite removed" : "was not invited"}, ${String(revoked)} session(s) ended.`,
      );
      break;
    }
    case "revoke": {
      const target = email();
      const revoked = await revoke(pool, target);
      console.log(`${target}: ${String(revoked)} session(s) ended.`);
      break;
    }
    case "block": {
      const target = email();
      const reason = values.reason?.trim() ?? "";
      const { newlyBlocked, uninvited, revoked } = await block(
        pool,
        target,
        reason.length > 0 ? reason : null,
      );
      console.log(
        `${target}: ${newlyBlocked ? "blocked" : "was already blocked"}` +
          `${uninvited ? ", invite removed" : ""}, ${String(revoked)} session(s) ended.` +
          " The account and its data remain; delete removes them.",
      );
      break;
    }
    case "unblock": {
      const target = email();
      const lifted = await unblock(pool, target);
      console.log(
        lifted
          ? `${target}: block lifted. It is not invited; run invite if it should sign in.`
          : `${target} was not blocked.`,
      );
      break;
    }
    case "delete": {
      const target = email();
      if (!(await confirmDelete(target)))
        fail("Not confirmed; nothing deleted.");
      const { deleted, stillInvited } = await deleteAccount(pool, target);
      console.log(
        deleted
          ? `${target}: account deleted.` +
              (stillInvited
                ? " Still invited: signing in again creates a new, empty account."
                : "")
          : `${target} has no account.`,
      );
      break;
    }
    default:
      fail();
  }
} finally {
  await pool.end();
}
