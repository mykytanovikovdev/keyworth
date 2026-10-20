// Manages the closed beta's invite list (the allowed_emails table).
//
//   npm run allowlist -- list
//   npm run allowlist -- add friend@example.com
//   npm run allowlist -- remove friend@example.com
//
// Targets DATABASE_URL when it is set (for production: the Neon owner
// connection string), otherwise the local database from compose.yaml. The
// target host is printed first, so a command never runs against the wrong one
// unnoticed. Emails are personal data: they live in the database, never in code.
import { Pool } from "pg";

const LOCAL_DATABASE =
  "postgres://keyworth_owner:keyworth_owner@localhost:5433/keyworth";

const [command, rawEmail] = process.argv.slice(2);
const connectionString = process.env.DATABASE_URL ?? LOCAL_DATABASE;
const { hostname, pathname } = new URL(connectionString);

function usage(): never {
  console.error(
    "Usage: npm run allowlist -- list | add <email> | remove <email>",
  );
  process.exit(1);
}

function parseEmail(value: string | undefined): string {
  const email = value?.trim().toLowerCase() ?? "";
  // Deliberately loose: Google has already verified the address at sign-in.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage();
  return email;
}

console.log(`Database: ${hostname}${pathname}`);
const pool = new Pool({ connectionString });

try {
  switch (command) {
    case "list": {
      const { rows } = await pool.query<{ email: string }>(
        "select email from allowed_emails order by email",
      );
      console.log(
        rows.length ? rows.map((row) => row.email).join("\n") : "(empty)",
      );
      break;
    }
    case "add": {
      const email = parseEmail(rawEmail);
      const { rowCount } = await pool.query(
        "insert into allowed_emails (email) values ($1) on conflict do nothing",
        [email],
      );
      console.log(rowCount ? `Added ${email}` : `${email} was already invited`);
      break;
    }
    case "remove": {
      const email = parseEmail(rawEmail);
      const { rowCount } = await pool.query(
        "delete from allowed_emails where email = $1",
        [email],
      );
      // Existing sessions keep working until they expire or the user signs
      // out; the next sign-in is refused.
      console.log(rowCount ? `Removed ${email}` : `${email} was not invited`);
      break;
    }
    default:
      usage();
  }
} finally {
  await pool.end();
}
