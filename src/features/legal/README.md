# src/features/legal/

## Purpose

The privacy policy and terms pages, reachable without signing in: from the
sign-in page and from Settings. Google requires both before an OAuth app can
leave its testing mode, users should be able to read them before signing in, and
the GDPR (Art. 13) and Georgia's Law on Personal Data Protection (Art. 24) say
what the policy must contain.

## How it works

| File                       | Role                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `LegalPage.tsx`            | Shared layout: title, last-updated date, readable text                              |
| `PrivacyPage.tsx`          | Controller, purposes and legal bases, processors, retention, rights, device storage |
| `TermsPage.tsx`            | The agreement: closed beta, 18+, no financial advice, lost keys, liability          |
| `../../../shared/legal.ts` | The date each text last changed; the terms' date is also their version              |

The sign-in page's line under the button makes continuing an acceptance of the
terms, and `worker/auth.ts` records `TERMS_VERSION` with each new account.

## Why this way

- **Plain components, no markdown.** The app renders no HTML from strings
  anywhere, and links inside the text need the router anyway.
- **No sign-off dialog.** The policy informs rather than asks for consent (the
  legal bases are the contract and legitimate interests), so there is no
  checkbox for it and no cookie banner: everything on the device is strictly
  necessary or a setting the user chose.
- **The text says what the code does.** Retention comes from
  [data-inventory.md](../../../worker/db/docs/data-inventory.md), device storage
  from `src/vault`, `src/ui/theme.ts` and the cookies in `worker/`.

## Pitfalls & gotchas

- Change the date in `shared/legal.ts` in the same commit as the text.
- These pages promise things the code must keep true. When any of these change,
  update the policy in the same pull request:
  - processors and where they run;
  - what the server stores and how long (the cleanup in `worker/cleanup.ts` is
    what makes the "2 days" true);
  - any new cookie or localStorage, sessionStorage or IndexedDB entry, each of
    which is listed by name.
- Links stay inside the app (`TextLink`, React Aria's `Link`): Settings links
  here with the data open, and a page reload would lock it.
- Long storage names must wrap at 320 px (`overflow-wrap` in `LegalPage`).

## How to work with it

Edit the page components directly; keep sentences short and concrete.

## Related

- [worker/db/docs/data-inventory.md](../../../worker/db/docs/data-inventory.md):
  what the database stores and how long
- [worker/docs/auth-and-sessions.md](../../../worker/docs/auth-and-sessions.md):
  how acceptance of the terms is recorded
