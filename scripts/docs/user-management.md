# User management

Who can use Keyworth, and how the owner invites, removes, blocks and deletes
users. There is deliberately no admin page and no admin API: everything runs
from the owner's terminal with the owner's database connection. Code:
`users.ts` (the command line), `user-admin.ts` (the SQL).

## Commands

`npm run users -- <command>`. Locally it targets the Docker database; for
production, put the owner's connection in front: copy it from the password
manager and run `DATABASE_URL="$(pbpaste)" npm run users -- <command>`, so it
never lands in shell history. The target database host is printed first.

| Command                          | Does                                                                                     | Use when                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `list`                           | Every known email: invited, blocked (with reason), account, live sessions, last activity | Checking who has access                                |
| `sessions <email>`               | Live sessions: when, last active, expiry, IP, browser (never tokens)                     | Something looks wrong with an account                  |
| `invite <email>`                 | Allows sign-in; refused for a blocked email                                              | Adding a friend                                        |
| `uninvite <email>`               | Removes the invite and ends all sessions                                                 | Someone should simply stop using it                    |
| `revoke <email>`                 | Ends all sessions; signing in again still works                                          | A lost or shared device                                |
| `block <email> [--reason "why"]` | Blocks, removes the invite, ends all sessions                                            | Abuse; the account stays for a closer look             |
| `unblock <email>`                | Lifts the block, without inviting again                                                  | A block was a mistake                                  |
| `delete <email>`                 | Deletes the account and everything that references it                                    | After `block`, or on request; asks to retype the email |

Inviting a friend takes two steps while Google's app is in Testing mode: add
them to the test users in Google Auth Platform → Audience, then `invite`.

**Ending sessions also forgets remembered devices** (their rows are deleted with
the sessions). **Deleting an account** deletes its sessions, Google link,
wrapped keys, encrypted records, remembered devices and counters through
foreign keys; the invite and any block stay, so a deleted but still invited
person can sign in and gets a new, empty account.

## Blocking by IP address

IP addresses are blocked at Cloudflare's edge, before the Worker runs, not in
code. In the dashboard, open the zone, then **Security → Security rules →
Create rule**:

- **Custom rules** (what Cloudflare recommends; the free plan includes a few):
  for example the expression `(ip.src in {203.0.113.7 198.51.100.0/24})` with
  the action **Block**. A rule can also match an ASN or a country.
- **IP access rules:** one IP address, range, ASN or country per rule, with a
  note saying why.

Prefer blocking the account: friends in Russia reach the app through a shared
VPN address, and blocking it would lock them out too. An IP rule is for an
ongoing attack and is removed once it ends. `sessions <email>` shows which
addresses an account uses.

## Invariants

1. Every command that touches several tables is a **single SQL statement**
   (data-modifying CTEs), so it applies completely or not at all.
2. A blocked email can neither sign in nor be invited; the sign-in hooks check
   the block list even if an invite exists.
3. `sessions` never selects the session token (a bearer credential).
4. `delete` refuses to run without a terminal and asks to type the email again.
5. The operations are plain DML: they work with the Worker's restricted role,
   which is how the tests run them.

## Decisions and alternatives

- **A terminal, not an admin page:** an admin page would be a new HTTP route
  with power over every account — one more thing to protect for an action
  needed a few times a year.
- **Block by email at the database, IP at the edge:** removing an invite alone
  leaves open sessions alive for up to seven days, and a later `invite` could
  let the person back by mistake.
- **Blocked people see "not invited":** nothing confirms they were singled out.

## How it is tested

`tests/integration/users.test.ts` runs `user-admin.ts` as the Worker's role
next to real sign-ins: block ends sessions at once and keeps the email out (also
from `invite`); the hooks refuse a blocked email that is still invited, for new
and existing accounts; unblock does not invite again; revoke and uninvite end
sessions; `sessions` never returns the token; delete removes the account with
its sessions and Google link; `list` reports each state.

Last reviewed: 2026-10-27
