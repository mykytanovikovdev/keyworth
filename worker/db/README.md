# worker/db/

## Purpose

The Worker's Postgres layer: the schema (Drizzle), the per-request database
handle, migrations, the restricted role the Worker runs as, and the local
database for development and tests.

The database holds only what the server is allowed to see in plaintext: the
Google profile (name, email), sessions, the invite and block lists and
rate-limit counters. Everything financial is stored only encrypted: wrapped
copies of each user's data key and encrypted records, which the server cannot
open. Queries that belong to a feature live with that feature (for example
`worker/routes/`), not here.

## How it works

```
production   Worker ─► connect(env.HYPERDRIVE) ─► pg ─► Hyperdrive (pooled, no cache) ─► Neon, Frankfurt
local, tests Worker ─► connect(env.HYPERDRIVE) ─► pg ─► Postgres 18 in Docker (compose.yaml), port 5433
```

| File                      | Role                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| `client.ts`               | `connect()`: a Drizzle handle over a pg pool, one per request            |
| `schema.ts`               | All tables: re-exports Better Auth's, defines the invite and block lists |
| `auth-schema.ts`          | Better Auth's tables, generated from `worker/auth.ts`; never hand-edited |
| `auth-cli.config.ts`      | What Better Auth's CLI loads to generate `auth-schema.ts`                |
| `local/init.sql`          | Creates the `keyworth_app` role and `keyworth_test` database locally     |
| `../../drizzle/`          | SQL migrations and drizzle-kit snapshots, committed                      |
| `../../drizzle.config.ts` | drizzle-kit settings; targets `DATABASE_URL` or the local database       |
| `../../compose.yaml`      | Local Postgres, pinned by digest                                         |
| `../../scripts/users.ts`  | `npm run users`: invites, sessions, blocks, account deletion             |

**Two roles, in every environment:**

| Role             | Used by                               | May                                         |
| ---------------- | ------------------------------------- | ------------------------------------------- |
| `keyworth_owner` | migrations (CI, `npm run db:migrate`) | change the schema                           |
| `keyworth_app`   | the Worker                            | `SELECT`, `INSERT`, `UPDATE`, `DELETE` only |

Roles are created outside migrations (`local/init.sql` here, SQL in Neon's editor
in production). Migration `0000` grants `keyworth_app` its privileges through
default privileges, so tables added by later migrations need no grants of their
own.

**Tables:**

| Table             | Holds                                                                                            | Notes                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `user`            | Name and email from Google                                                                       | No avatar URL                                         |
| `session`         | Session tokens, expiry, IP address, user agent                                                   | Deleted with the user                                 |
| `account`         | The link between a user and their Google account                                                 | No Google tokens: they are stripped before saving     |
| `verification`    | Short-lived OAuth state                                                                          | Better Auth cleans it up                              |
| `rate_limit`      | Request counters per IP and path                                                                 | Workers have no shared memory                         |
| `allowed_emails`  | The invite list                                                                                  | Lowercase only (`CHECK`)                              |
| `blocked_emails`  | Emails that may never sign in, with a reason                                                     | Lowercase only; checked at every sign-in              |
| `user_key_slots`  | The data key wrapped by the passphrase and by the recovery key, Argon2 settings, salts           | Ciphertext only; exact byte lengths (`CHECK`)         |
| `vault_records`   | Encrypted records: kind, revision, IV, ciphertext, dates                                         | Keyed by (user, id); content unreadable to the server |
| `device_unlocks`  | "Remember this device": the data key wrapped by a device-only key, the hash of the device cookie | Deleted with its session                              |
| `api_rate_limits` | Write counters per user for the app's own routes                                                 | One row per user and bucket                           |

Every timestamp is `timestamp with time zone`. Every table with user data
references `user.id` with `on delete cascade` (`device_unlocks` also
`session.id`), so deleting an account deletes all of it.

## Why this way

- **Hyperdrive and `pg`.** Plain Postgres over TCP everywhere: the same driver
  talks to Docker locally, in tests and in CI, and to Neon in production, with
  real transactions. Hyperdrive keeps the connections to Neon pooled near the
  database, which matters for friends far from Frankfurt, and is part of the
  free plan. Rejected: Neon's HTTP driver, which needs Neon's proxy image to run
  locally and has no interactive transactions.
- **Hyperdrive's query cache is off** (`--caching-disabled`). It is on by
  default and keeps read results for up to 60 seconds, so a deleted session or
  a revoked invite could keep working for a minute.
- **A restricted runtime role.** If the Worker is ever tricked into running
  arbitrary SQL, it still cannot drop or alter tables.
- **Users are managed from a terminal, not an admin page.** An admin page would
  be a new HTTP route with powers over every account: one more thing to
  protect, for an action needed a few times a year. `npm run users` uses the
  owner's connection string and adds no attack surface.
- **Blocking is by email, at the database.** Removing an invite alone would
  leave open sessions alive for up to seven days, and a later `invite` could
  let the person back by mistake; `block` ends the sessions and records the
  email in `blocked_emails`, which `invite` and the sign-in hooks both check.
  Each command that touches several tables is one SQL statement, so it never
  half-applies. IP addresses are blocked at Cloudflare's edge instead (see
  [worker/README.md](../README.md#blocking-by-ip-address)): friends behind a
  shared VPN address would be blocked with the attacker.
- **Postgres in Docker for development and tests**, not Neon branches: no
  network, no account, the same state on every run. Production data never
  touches a test.
- **Time zones everywhere.** Without a zone, `pg` writes dates in the machine's
  local zone while the Worker reads them as UTC: a session created from a laptop
  in UTC+4 would be off by four hours. `npm run db:auth-schema` rewrites the
  generated schema accordingly.
- **No explicit `pool.end()`.** A Worker's sockets belong to the request and the
  runtime closes them when it ends; Cloudflare's own Hyperdrive example never
  closes its client.

## Pitfalls & gotchas

- **The Hyperdrive `id` in `wrangler.jsonc` is not a secret**: the
  credentials live in the Hyperdrive config at Cloudflare. Local dev and tests
  ignore it and use `localConnectionString` or the environment variable.
- **Migrations run before the new Worker is deployed**, so the running Worker
  briefly sees the new schema. Keep migrations backward compatible: add a column
  and backfill first, drop the old one in a later release.
- **Never edit `auth-schema.ts`.** After changing Better Auth options that add
  tables or columns, run `npm run db:auth-schema`, then `npm run db:generate`.
- **Ending the pool breaks things.** pg-cloudflare's read loop fails on the
  closed socket and the error surfaces as an unhandled rejection.
- **pg in the Workers test runner** needs two module redirects
  (`pg-protocol`, `pg-cloudflare`); they live in `vitest.config.ts`. The app's
  bundle is unaffected.
- **Port 5433, not 5432:** a Postgres installed on the host often holds 5432.
- **`npm audit` reports esbuild** through drizzle-kit's old loader. It is a
  development-only dependency, and the vulnerable feature (esbuild's dev server)
  is not used.
- **Deleting an `allowed_emails` row by hand does not end existing sessions**:
  it only stops the next sign-in. `npm run users -- uninvite` and `block` also
  delete the sessions.
- **A blocked email sees "not on the invite list"**, the same as a stranger:
  nothing confirms to that person that they were singled out.
- **Tables added in later phases must reference `user.id` with
  `on delete cascade`**, so `delete` (and self-service deletion) removes their
  rows too.

## How to work with it

```sh
npm run db:up                    # start local Postgres (Docker)
npm run db:migrate               # apply migrations to the local database
npm run users -- invite me@example.com
npm run dev                      # the Worker uses the local database
docker compose exec postgres psql -U keyworth_owner -d keyworth   # inspect
docker compose down -v           # wipe local data; next db:up starts empty
```

**Changing the schema:** edit `schema.ts` (or the Better Auth options, then
`npm run db:auth-schema`), run `npm run db:generate`, read the generated SQL,
apply it with `npm run db:migrate`, and add tests.

**Production setup (once):**

1. A Neon project on Postgres 18 in AWS Frankfurt (`aws-eu-central-1`), with a
   database named `keyworth`.
2. The `keyworth_app` role, created **with SQL** as the owner in Neon's SQL
   editor, not in the console:
   `CREATE ROLE keyworth_app WITH LOGIN PASSWORD '<random>'; GRANT CONNECT ON DATABASE keyworth TO keyworth_app;`.
   Roles created in the console join `neon_superuser`, which brings
   `GRANT ALL` on the tables of `public`, and the restriction would be lost.
3. The owner's direct (not pooled) connection string as the `DATABASE_URL`
   GitHub secret: CI applies migrations with it before each deploy.
4. A Hyperdrive configuration with `keyworth_app`'s direct connection string
   and caching disabled (dashboard, or
   `npx wrangler hyperdrive create keyworth --connection-string="…" --caching-disabled`);
   its id goes into `wrangler.jsonc`. Check it with `npx wrangler hyperdrive list`
   (user `keyworth_app`, a host without `-pooler`, caching `disabled`); turn the
   cache off later with `npx wrangler hyperdrive update <id> --caching-disabled`. Neon's own pooler is not needed:
   Hyperdrive pools.
5. After the first deploy, invite people:
   `DATABASE_URL="<owner connection string>" npm run users -- invite <email>`.
   While the Google app is in Testing, each person must also be one of its
   test users.

### Managing users

`npm run users -- <command>`, with `DATABASE_URL="<owner connection string>"`
in front for production. The target database is printed first.

| Command                          | Does                                                    | Use when                                     |
| -------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| `list`                           | Every known email: invited, blocked, account, sessions  | Checking who has access                      |
| `sessions <email>`               | Live sessions: when, IP address, browser (never tokens) | Something looks wrong with an account        |
| `invite <email>`                 | Allows sign-in; refused for a blocked email             | Adding a friend                              |
| `uninvite <email>`               | Removes the invite and ends all sessions                | Someone should simply stop using it          |
| `revoke <email>`                 | Ends all sessions; signing in again still works         | A lost or shared device                      |
| `block <email> [--reason "why"]` | Blocks, removes the invite, ends all sessions           | Abuse; the account stays for a closer look   |
| `unblock <email>`                | Lifts the block, without inviting again                 | A block was a mistake                        |
| `delete <email>`                 | Deletes the account and everything that references it   | After `block`, or on request; asks to retype |

## Related

- [worker/](../README.md): routes, session checks and security headers
- [tests/integration/](../../tests/integration/README.md): Worker tests against the test database
- [scripts/](../../scripts/README.md): the user management and schema generation scripts
