# Keyworth — private AI portfolio assistant

> Your net worth. Your key.

**Status: early development.** Google sign-in, security headers, tests, the deployment pipeline,
end-to-end encryption of user data, the privacy policy and terms, transactions (with CSV import and
export) and the portfolio page (value, gains and risk figures for crypto) are in place; the assistant is next. Nothing here is
ready for real data yet.

Keyworth is an investment portfolio tracker (crypto first; stocks, ETFs and metals
next) with an AI assistant you can ask questions in plain language, in any
language. Financial data is **encrypted in the browser** with a key the server
never has: the operator stores only ciphertext.

## What it will do

- **Ask, don't dig.** "How did my portfolio change this month?" — the assistant
  calls tools, the interface shows each step live, and the answer streams in with
  charts.
- **End-to-end encryption.** Trades, chat history and alerts are encrypted with
  AES-256-GCM in the browser; the data key is unlocked with a passphrase
  (Argon2id) or a recovery key and never leaves the device.
- **The model does not do math.** Positions, P&L, drawdown and volatility are
  computed by tested pure functions in the browser; the model only explains the
  numbers it receives.
- **Nothing changes without a click.** The assistant can propose recording a trade
  ("bought 5 LTC yesterday at $60"), but it is saved only after the user confirms
  a card showing exactly what will be written.
- **Data minimization.** By default the model sees shares and percentages, not
  amounts, and never the user's name or email.

## Architecture

```
Browser (React SPA) — keys, decrypted data, calculations and agent tools live here
   │  one origin, httpOnly session cookie
   ▼
Cloudflare Worker (Hono) — sees encrypted envelopes only, except the chat's transit to the model
   ├── /            static SPA (Workers Assets)
   ├── /api/auth    sign-in with Google, invite-only beta
   ├── /api/keys    wrapped data keys (never the keys themselves)
   ├── /api/vault   encrypted records
   ├── /api/market  prices, history, exchange rates: shared cache for everyone
   ├── /api/assets  coin search and logos, through the Worker
   └── /api/chat/completions  the model's stream passed through, never stored or logged
   │
   ├──► PostgreSQL (Neon, via Hyperdrive) — envelopes and service data only
   ├──► CoinGecko, Frankfurter — market data, asked by the server, never by the browser
   └──► the chat's model: Workers AI (GLM-4.7-Flash) while in development,
        then Anthropic API (Claude Haiku)
```

| Layer    | Choice                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend | React 19, Vite 8, TypeScript (strict), TanStack Router and Query                                                                                       |
| UI       | Tailwind CSS 4 on semantic tokens, React Aria Components, Lucide icons, anime.js, the Onest font                                                       |
| API      | Hono on Cloudflare Workers; static files via Workers Assets                                                                                            |
| Chat     | AI SDK 7 in the browser (the agent's loop and its tools); the Worker a thin proxy; GLM-4.7-Flash on Workers AI while in development, Claude Haiku next |
| Auth     | Better Auth: Google sign-in, database sessions, invite list                                                                                            |
| Data     | PostgreSQL 18 (Neon in production, Docker locally) through Hyperdrive, Drizzle ORM and migrations                                                      |
| Tests    | Vitest (Node and workerd + Postgres), Playwright (Chromium, Firefox, WebKit), axe, screenshots                                                         |
| Crypto   | WebCrypto (AES-256-GCM, HKDF), Argon2id from @noble/hashes (plain JavaScript), zod schemas                                                             |
| Money    | big.js decimals, pure calculations in `shared/metrics`; prices and rates through the Worker                                                            |
| Planned  | Claude Haiku for the chat                                                                                                                              |

## Getting started

Requirements: Node 24 (see `.nvmrc`), Docker (local Postgres and visual tests)
and [gitleaks](https://github.com/gitleaks/gitleaks) for the pre-commit secret
scan (`brew install gitleaks` on macOS).

```sh
npm ci                  # install exactly what package-lock.json says
npm run hooks:install   # once per clone: git hooks (secret scan before commit)
cp .dev.vars.example .dev.vars   # local secrets; fill in BETTER_AUTH_SECRET
npm run db:up           # local Postgres 18 in Docker
npm run db:migrate      # create the tables
npm run dev             # SPA + Worker on one port, with hot reload
```

For end-to-end tests, install the browsers once:
`npx playwright install chromium firefox webkit`, or run them from the
Playwright Docker image with `npm run test:e2e:docker`, as CI does.

## Scripts

| Script                       | What it does                                                              |
| ---------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`                | Vite dev server with the Worker running in workerd                        |
| `npm run build`              | Production build: `dist/client` (static) and `dist/keyworth` (Worker)     |
| `npm run preview`            | Serve the production build locally in workerd                             |
| `npm run check`              | Format, lint, types, Worker types, tests, licenses, docs, build pre-merge |
| `npm test`                   | Unit (Node) and Worker (workerd) tests                                    |
| `npm run test:e2e`           | Playwright against fresh production and design builds                     |
| `npm run test:e2e:docker`    | The same, with the browsers in the Playwright Docker image (as in CI)     |
| `npm run test:visual`        | Screenshots of `/design` against the baselines (needs Docker)             |
| `npm run test:visual:update` | Rewrite the screenshot baselines after an intended change                 |
| `npm run lint`               | ESLint, including the project's security rules                            |
| `npm run format`             | Prettier                                                                  |
| `npm run typecheck`          | TypeScript project references                                             |
| `npm run licenses`           | Dependency license check                                                  |
| `npm run docs:check`         | Links, review dates and forbidden content in READMEs and `docs/`          |
| `npm run bundle:size`        | Script chunks and the largest one by package                              |
| `npm run mutate -- <plan>`   | Break lines on purpose and see whether the tests notice                   |
| `npm run cf:types`           | Regenerate Worker types after changing `wrangler.jsonc`                   |
| `npm run hooks:install`      | Install git hooks                                                         |
| `npm run build:design`       | Build with the `/design` page into `dist-design/`                         |
| `npm run preview:design`     | Serve the design build locally (port 4174)                                |
| `npm run design:screenshots` | Screenshots of the design prototype (see [design](design/README.md))      |
| `npm run design:videos`      | Recordings of the prototype animations                                    |
| `npm run db:up` / `db:down`  | Start or stop the local Postgres (Docker)                                 |
| `npm run db:migrate`         | Apply migrations (local, or `DATABASE_URL` when set)                      |
| `npm run db:generate`        | Create a migration from schema changes                                    |
| `npm run db:auth-schema`     | Regenerate Better Auth's tables after changing its options                |
| `npm run users`              | Invites, sessions, blocks and account deletion (see `worker/db`)          |
| `npm run deploy`             | Build and deploy manually (CI normally does this)                         |

## Project structure

```
src/        React SPA; src/ui/ is the design system, src/crypto/ the encryption core
shared/     definitions and logic shared by the browser and the Worker: zod schemas,
            decimal money and the portfolio calculations
worker/     Cloudflare Worker (Hono): API, sign-in, security headers, market data, daily cleanup;
            db/ is the database
drizzle/    SQL migrations
public/     static files, including _headers (page CSP) and robots.txt
design/     design exploration: a dev-only prototype, never deployed
scripts/    project tooling (user management, license and docs checks, visual test runner)
tests/      unit/, integration/ (workerd), e2e/ and visual/ (Playwright)
.github/    CI, deployment and Dependabot
```

Every major folder has its own README explaining what it does, why it is built
that way, and its pitfalls; critical features and their tests are described in
depth in `docs/` folders next to the code. READMEs: [design system](src/ui/README.md),
[encryption](src/crypto/README.md), [privacy policy and terms](src/features/legal/README.md),
[shared schemas](shared/schemas/README.md), [money](shared/money/README.md),
[calculations](shared/metrics/README.md), [transactions](src/features/transactions/README.md),
[portfolio](src/features/portfolio/README.md),
[worker](worker/README.md), [database](worker/db/README.md), [market data](worker/market/README.md),
[design](design/README.md),
[scripts](scripts/README.md), [tests](tests/README.md).

## Quality gates

Every pull request and every push to `main` runs, on GitHub Actions:

- **`npm run check`** — formatting, lint, types, stale Worker types, unit and
  Worker tests, license check, documentation check, production build; plus
  `npm audit` for runtime
  dependencies;
- **end-to-end tests** in three browser engines against the production build,
  and against the `/design` page with every UI component (CSP, keyboard, themes,
  axe accessibility checks);
- **visual tests**: screenshots of `/design`, sign-in and settings in both themes, rendered in the
  official Playwright Docker image and compared with committed baselines;
- **gitleaks** over the full git history.

A push to `main` applies database migrations and deploys to Cloudflare **only
after all of them pass**, then runs the header and browser smoke tests against
the live site.

### Dependencies

A malicious dependency is served from our own origin, where no CSP can stop it,
so dependencies are treated as part of the attack surface:

- exact versions only and a committed lockfile (`npm ci` in CI);
- dependency install scripts are disabled (`ignore-scripts` in `.npmrc`);
- Dependabot proposes updates only after a 7-day cooldown (security fixes are not
  delayed); majors that would break the toolchain (TypeScript 7, Node types newer
  than the Node we run) are held back with the reason in `.github/dependabot.yml`;
- GitHub Actions are pinned to commit SHAs;
- every license must be compatible with AGPL-3.0 ([policy](scripts/README.md)).

## Security

**Encryption model (in place).** The
server never stores financial data in plaintext and never receives the
passphrase, the recovery key or the data key. A random AES-256-GCM data key,
made in the browser, encrypts every record; the server stores it only wrapped by
keys derived from the passphrase (Argon2id, 64 MiB, 3 passes) and from a
160-bit recovery key. Each record is an envelope `{ v, alg, iv, ct }` with a
fresh random IV, padded to a size bucket and bound to its owner, record type,
record ID and revision through additional authenticated data, so it cannot be
swapped for another user's, moved to another row or written back over a newer
version. Argon2id runs as plain JavaScript, so the CSP needs no WebAssembly
exception. The design and an honest threat model —
what is protected, what the operator can still see, and what it does not
protect against — are in [src/crypto/README.md](src/crypto/README.md) and the
[threat model](src/crypto/docs/threat-model.md).

**Sign-in (in place).** Google accounts only, for an invite list kept in the
database. Sessions live in the database and in an httpOnly, Secure, SameSite
cookie, so signing out or deleting the account takes effect immediately.
Keyworth stores the name and email from Google, never Google's access tokens or
the avatar. Deleting the account requires a sign-in from the last 10 minutes.
Expired sessions, with their IP address and browser, are deleted once a day.
Details: [worker/README.md](worker/README.md).

**Web hardening (in place).** A cross-site scripting bug would mean key theft, so
the page runs under a strict Content Security Policy (`default-src 'none'`,
same-origin scripts and styles only, no inline scripts; the only inline styles
allowed are two fixed blocks from the UI library, by hash), Trusted Types, cross-origin
isolation, HSTS and a deny-by-default Permissions Policy. Details and the
reasoning behind each header are in [worker/README.md](worker/README.md); the e2e
suite asserts every value.

**Input validation (in place).** Every field, address parameter, API request and
market source answer goes through the same layers: the field keeps out what can
never be valid, a shared schema refuses the rest, the server checks again, and
data is only ever shown as text. Free text keeps no hidden or direction-changing
characters. The rules, the attacks they stop and the checklist for a new field:
[shared/schemas/docs/input-validation.md](shared/schemas/docs/input-validation.md).

### Reporting a vulnerability

The repository is private during early development, and a dedicated private
reporting channel will be published here before it becomes public. Until then,
please report issues directly to the maintainer and do not disclose them publicly.

## License

[GNU Affero General Public License v3.0 or later](LICENSE). If you run a modified
version of Keyworth as a network service, you must offer its users the source code
of your version.
