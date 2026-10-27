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

- **Two roles:** `keyworth_owner` runs migrations and `npm run users`;
  `keyworth_app`, the Worker's role, may only read and write rows. Migrations
  run in CI before each deploy and must stay backward compatible.
- **Tables:** the Google profile and sessions (Better Auth), the invite and
  block lists, rate-limit counters, and the encryption tables: wrapped data
  keys, the data key's check value, encrypted records and remembered devices. Every table with user data is
  deleted with the account. Every timestamp is `timestamp with time zone`.

The details live in [`docs/`](docs/):

| Document                                                | Covers                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [data-inventory.md](docs/data-inventory.md)             | Every table and column: what it holds, whether the server can read it, what deletes it |
| [roles-and-migrations.md](docs/roles-and-migrations.md) | Connections, Hyperdrive, the two roles, how migrations run and change safely           |

User management (`npm run users`) and blocking IP addresses:
[scripts/docs/user-management.md](../../scripts/docs/user-management.md).

## Why this way

- **Hyperdrive and `pg`**, with the query cache off, and **Postgres in Docker**
  for development and tests:
  [roles-and-migrations.md](docs/roles-and-migrations.md).
- **A restricted runtime role:** if the Worker is ever tricked into running
  arbitrary SQL, it still cannot drop or alter tables.
- **Only ciphertext for financial data:** the server stores what the browser's
  encryption produces ([data-inventory.md](docs/data-inventory.md)).
- **Users are managed from a terminal, not an admin page,** and blocked by
  email in the database, IP addresses at Cloudflare
  ([user-management.md](../../scripts/docs/user-management.md)).

## Pitfalls & gotchas

- **The Hyperdrive `id` in `wrangler.jsonc` is not a secret**: the
  credentials live in the Hyperdrive config at Cloudflare. Local dev and tests
  ignore it and use `localConnectionString` or the environment variable.
- **Connection pitfalls** (never `pool.end()`, port 5433, pg in the Workers test
  runner): [roles-and-migrations.md](docs/roles-and-migrations.md).
- **Migrations run before the new Worker is deployed**, so the running Worker
  briefly sees the new schema. Keep migrations backward compatible: add a column
  and backfill first, drop the old one in a later release.
- **Never edit `auth-schema.ts`.** After changing Better Auth options that add
  tables or columns, run `npm run db:auth-schema`, then `npm run db:generate`.
- **`npm audit` reports esbuild** through drizzle-kit's old loader. It is a
  development-only dependency, and the vulnerable feature (esbuild's dev server)
  is not used.
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
5. After the first deploy, invite people with `npm run users -- invite <email>`
   against production ([user-management.md](../../scripts/docs/user-management.md)).

## Related

- [docs/](docs/): the data inventory, roles and migrations

- [worker/](../README.md): routes, session checks and security headers
- [tests/integration/](../../tests/integration/README.md): Worker tests against the test database
- [scripts/](../../scripts/README.md): the user management and schema generation scripts
