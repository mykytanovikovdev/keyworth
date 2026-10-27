# Database roles, connections and migrations

How the Worker reaches Postgres, with which privileges, and how the schema
changes. Code: `client.ts`, `schema.ts`, `local/init.sql`, `drizzle/`,
`drizzle.config.ts`, the `migrate` job in `.github/workflows/ci.yml`.

## Connections

```
production   Worker ─► pg ─► Hyperdrive (pooled, query cache off) ─► Neon Postgres 18, Frankfurt
local, tests Worker ─► pg ─► Postgres 18 in Docker (compose.yaml), port 5433
```

- One `pg` pool per request (`connect()`, at most 5 connections; Workers allow
  six outbound connections per request). Connections open only when a query
  runs and close with the request; the code never calls `pool.end()`.
- **Hyperdrive's query cache is off.** It is on by default and would keep read
  results for up to 60 seconds: a deleted session or a revoked invite could keep
  working for a minute.
- Hyperdrive connects with the runtime role's **direct** (not pooled) Neon
  connection; Hyperdrive does the pooling. Its id in `wrangler.jsonc` is not a
  secret: the credentials live in the Hyperdrive configuration at Cloudflare.

## Two roles, everywhere

| Role             | Used by                                                | May                                         |
| ---------------- | ------------------------------------------------------ | ------------------------------------------- |
| `keyworth_owner` | migrations (CI, `npm run db:migrate`), `npm run users` | everything on the schema                    |
| `keyworth_app`   | the Worker                                             | `SELECT`, `INSERT`, `UPDATE`, `DELETE` only |

Roles are created outside migrations: `local/init.sql` locally; in Neon, the
runtime role is created **with SQL** as the owner (`CREATE ROLE … WITH LOGIN
PASSWORD …; GRANT CONNECT ON DATABASE …`), because roles created in Neon's
console join `neon_superuser`, which brings `GRANT ALL` on the tables of
`public` and would undo the restriction. Migration `0000` grants
`keyworth_app` usage of the schema and, through default privileges, DML on every
table and sequence the owner creates later — new tables need no grants of their
own.

## Migrations

- drizzle-kit generates SQL from `schema.ts` into `drizzle/` (committed, read
  before applying). Better Auth's tables come from its CLI
  (`npm run db:auth-schema`), rewritten to `timestamp with time zone`.
- **CI applies migrations automatically**, in the `migrate` job, after all
  checks pass and **before** the deploy job (which waits for it). It uses the
  owner's connection from the `DATABASE_URL` repository secret and fails
  loudly if the secret is missing; then the deploy does not run and production
  keeps the previous version.
- Because the old Worker briefly runs against the new schema, **migrations must
  be backward compatible:** add a column and backfill first; drop the old one in
  a later release.

## Invariants

1. The Worker never runs as a role that can change the schema.
2. Every timestamp is `timestamp with time zone` (without a zone, `pg` writes
   the machine's local time and a session from a UTC+4 laptop would be off by
   four hours).
3. Migrations are append-only and applied before the code that needs them.

## Decisions and alternatives

- **Hyperdrive and `pg`:** plain Postgres over TCP everywhere, with real
  transactions; the same driver locally, in tests, in CI and in production.
  Rejected: Neon's HTTP driver (needs Neon's proxy to run locally, no
  interactive transactions).
- **Postgres in Docker for development and tests,** not Neon branches: no
  network or account, the same state on every run, and production data never
  touches a test.
- **Neon's Agent tooling (skill, CLI, MCP) is not used:** Neon advises against
  connecting agents to production databases, and its CLI writes the owner's
  connection into a local `.env`.

## Edge cases

- **Port 5433, not 5432:** a Postgres installed on the host often holds 5432.
- **Ending the pool breaks things:** pg-cloudflare's read loop fails on the
  closed socket and surfaces as an unhandled rejection. So does pg's idle
  timeout (10 seconds by default), which ends idle connections by itself: both
  the Worker's pools and the tests' `query()` set `idleTimeoutMillis: 0`.
  Locally a test file finishes in seconds and never shows it; on CI, a file
  that ran longer than 10 seconds failed with "This socket has been closed".
- **pg in the Workers test runner** needs two module redirects (`pg-protocol`,
  `pg-cloudflare`) in `vitest.config.ts`.
- **drizzle-kit's metadata files** (`drizzle/meta/*.json`) must be formatted with
  Prettier after `npm run db:generate`, or the format check fails.
- **Database passwords** are changed with Neon's Reset password, copied with
  Show password then Copy snippet, kept in a password manager, and passed to
  commands as `DATABASE_URL="$(pbpaste)"` — never typed into files, chats or
  shell history.

## How it is tested

`tests/support/database.ts` applies every migration to the test database and
empties it before a run; the Worker tests connect as `keyworth_app`, so a
missing grant fails them. See
[tests/integration/docs/storage-and-isolation.md](../../../tests/integration/docs/storage-and-isolation.md).

Last reviewed: 2026-10-27
