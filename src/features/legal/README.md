# src/features/legal/

## Purpose

The privacy policy and terms pages, reachable without signing in. Google
requires both before an OAuth app can leave its testing mode, and users should
be able to read them before signing in.

## How it works

| File              | Role                                                  |
| ----------------- | ----------------------------------------------------- |
| `LegalPage.tsx`   | Shared layout: title, a "draft" notice, readable text |
| `PrivacyPage.tsx` | What is stored, what is not, processors, deletion     |
| `TermsPage.tsx`   | Closed beta, no financial advice, account rules       |

## Why this way

- **Plain components, no markdown.** The text is short, and the app renders no
  HTML from strings anywhere.
- **Drafts that say so.** The texts describe what the code does today (for
  example, that Google tokens and the avatar are not stored, and what the
  server can and cannot see of encrypted data); the final versions are due
  before the public release (phase 10).

## Pitfalls & gotchas

- When storage or processors change (encrypted vault, the model provider for
  chat), update the privacy policy in the same pull request.

## How to work with it

Edit the page components directly; keep sentences short and concrete.

## Related

- [worker/db/](../../../worker/db/README.md): what the database actually stores
