# worker/db/

## Purpose

The Worker's Postgres layer: the schema (Drizzle), the per-request database
handle, migrations, the restricted role the Worker runs as, and the local
database for development and tests.

The database holds only what the server is allowed to see in plaintext: for
now, the invite list; sign-in data arrives with authentication.
Financial data arrives in phase 3, and only as encrypted envelopes. Queries that
belong to a feature live with that feature, not here.

## How it works

```
production   Worker ─► connect(env.HYPERDRIVE) ─► pg ─► Hyperdrive (pooled, no cache) ─► Neon, Frankfurt
local, tests Worker ─► connect(env.HYPERDRIVE) ─► pg ─► Postgres 18 in Docker (compose.yaml), port 5433
```

| File                         | Role                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `client.ts`                  | `connect()`: a Drizzle handle over a pg pool, one per request        |
| `schema.ts`                  | All tables: `allowed_emails` for now                                 |
| `local/init.sql`             | Creates the `keyworth_app` role and `keyworth_test` database locally |
| `../../drizzle/`             | SQL migrations and drizzle-kit snapshots, committed                  |
| `../../drizzle.config.ts`    | drizzle-kit settings; targets `DATABASE_URL` or the local database   |
| `../../compose.yaml`         | Local Postgres, pinned by digest                                     |
| `../../scripts/allowlist.ts` | `npm run allowlist`: add, remove or list invited emails              |

**Two roles, in every environment:**

| Role             | Used by                               | May                                         |
| ---------------- | ------------------------------------- | ------------------------------------------- |
| `keyworth_owner` | migrations (CI, `npm run db:migrate`) | change the schema                           |
| `keyworth_app`   | the Worker                            | `SELECT`, `INSERT`, `UPDATE`, `DELETE` only |

Roles are created outside migrations (`local/init.sql` here, the Neon console in
production). Migration `0000` grants `keyworth_app` its privileges through
default privileges, so tables added by later migrations need no grants of their
own.

**Tables:**

| Table            | Holds           | Notes                    |
| ---------------- | --------------- | ------------------------ |
| `allowed_emails` | The invite list | Lowercase only (`CHECK`) |

Every timestamp is `timestamp with time zone`.

## Why this way

- **Hyperdrive and `pg`.** Plain Postgres over TCP everywhere: the same driver
  talks to Docker locally, in tests and in CI, and to Neon in production, with
  real transactions. Hyperdrive keeps the connections to Neon pooled near the
  database, which matters for friends far from Frankfurt, and is part of the
  free plan. Rejected: Neon's HTTP driver, which needs Neon's proxy image to run
  locally and has no interactive transactions.
- **Hyperdrive's query cache is off** (`--caching-disabled`). It is on by
  default and keeps read results for up to 60 seconds, so a deleted session or
  revoked invite could keep working for a minute.
- **A restricted runtime role.** If the Worker is ever tricked into running
  arbitrary SQL, it still cannot drop or alter tables.
- **Postgres in Docker for development and tests**, not Neon branches: no
  network, no account, the same state on every run. Production data never
  touches a test.
- **Time zones everywhere.** Without a zone, `pg` writes dates in the machine's
  local zone while the Worker reads them as UTC: a session created from a laptop
  in UTC+4 would be off by four hours.
- **No explicit `pool.end()`.** A Worker's sockets belong to the request and the
  runtime closes them when it ends; Cloudflare's own Hyperdrive example never
  closes its client.

## Pitfalls & gotchas

- **The Hyperdrive `id` in `wrangler.jsonc` is a placeholder** until the
  production config exists (see below). Local dev and tests ignore it.
- **Migrations run before the new Worker is deployed**, so the running Worker
  briefly sees the new schema. Keep migrations backward compatible: add a column
  and backfill first, drop the old one in a later release.
- **Ending the pool breaks things.** pg-cloudflare's read loop fails on the
  closed socket and the error surfaces as an unhandled rejection.
- **pg in the Workers test runner** needs two module redirects
  (`pg-protocol`, `pg-cloudflare`); they live in `vitest.config.ts`. The app's
  bundle is unaffected.
- **Port 5433, not 5432:** a Postgres installed on the host often holds 5432.
- **`npm audit` reports esbuild** through drizzle-kit's old loader. It is a
  development-only dependency, and the vulnerable feature (esbuild's dev server)
  is not used.
- **Removing an invite does not end existing sessions**: it blocks the next
  sign-in. To cut someone off at once, also delete their sessions.

## How to work with it

```sh
npm run db:up                    # start local Postgres (Docker)
npm run db:migrate               # apply migrations to the local database
npm run allowlist -- add me@example.com
npm run dev                      # the Worker uses the local database
docker compose exec postgres psql -U keyworth_owner -d keyworth   # inspect
docker compose down -v           # wipe local data; next db:up starts empty
```

**Changing the schema:** edit `schema.ts`, run `npm run db:generate`, read the generated SQL,
apply it with `npm run db:migrate`, and add tests.

**Production setup (once):**

1. A Neon project on Postgres 18 in AWS Frankfurt (`aws-eu-central-1`).
2. A `keyworth_app` role (Neon console) and the owner's connection string for
   migrations, stored as the `DATABASE_URL` GitHub secret.
3. `npx wrangler hyperdrive create keyworth --connection-string="<keyworth_app's connection string>" --caching-disabled`,
   then put the returned id into `wrangler.jsonc`.
4. Invite people: `DATABASE_URL="<owner connection string>" npm run allowlist -- add <email>`.

## Related

- [worker/](../README.md): routes, session checks and security headers
- [tests/integration/](../../tests/integration/README.md): Worker tests against the test database
- [scripts/](../../scripts/README.md): the allowlist and schema generation scripts
