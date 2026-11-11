# design/

## Purpose

Phase 1 design exploration: a clickable prototype of Keyworth's key screens, in
light and dark, used to choose a direction before the design system is built in
`src/ui/`.

The prototype is a review tool, not product code. It is excluded from the
production build and never deployed.

**The design system now lives in [`src/ui/`](../src/ui/README.md)**, which is
the source of truth for tokens and components. The prototype keeps its own copy
of the tokens as they were when the direction was chosen, and is kept for now as
a reference for the chat screens (agent steps, streamed answer, chart, trade
confirmation) in phases 5–7. Whether it stays after that is decided later.

## Design brief

- **Audience.** A few private investors (the owner and friends) who check their
  portfolio daily or weekly. Later, people reviewing the open-source project, who
  give it about a minute to form an opinion.
- **Primary job.** Answer "how is my portfolio doing?" calmly, and let the user
  record a trade safely. The chat is the main screen.
- **Tone.** Business-like, calm and intuitive. Not a trading terminal, not a
  crypto casino. Familiar beats novel.
- **Layout.** Follows the conventions of mainstream AI chat assistants: a history
  sidebar, a centered conversation, the composer at the bottom, tool steps as a
  collapsible line. Added for a portfolio: the lock status, charts inside answers,
  the trade confirmation card, and a portfolio page.
- **Numbers.** Tabular figures in tables and on axes. Gain and loss always carry a
  sign and an arrow, never color alone.
- **Motion.** Short and smooth: answers stream in word by word, steps appear as
  they run, charts draw in. Everything respects the reduced-motion setting.
- **Languages.** The interface is English only; conversations can be in any
  language, so every font must cover Cyrillic.

## Direction: warm

Two variants were prototyped on one shared layout and set of components; only the
tokens differed. **Warm was chosen** and is now the only one in the prototype.

|         | Warm (chosen)                        | Neutral (rejected)                                  |
| ------- | ------------------------------------ | --------------------------------------------------- |
| Palette | Warm neutrals with one indigo accent | White and near-black; color only for data and focus |
| Type    | Onest                                | IBM Plex Sans                                       |
| Radii   | 8 / 14 / 20 px                       | 10 / 16 / 26 px                                     |

Why warm: both themes came out balanced; the indigo accent makes primary actions
such as Confirm stand apart from text, where Neutral's near-black buttons blended
in; and the overall look has more character without becoming decorative. Neutral
was the safer, more generic option. Its tokens are in the git history of this
folder if a comparison is ever needed.

## How it works

| Path                   | Role                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `prototype/index.html` | Dev-only Vite entry, served at `/design/prototype/` by `npm run dev`   |
| `prototype/tokens.css` | Every raw value: colors per theme, fonts, radii, motion                |
| `prototype/styles.css` | Maps tokens to Tailwind utilities; removes the default palette         |
| `prototype/motion.ts`  | anime.js helpers: chart line and fill, bar fill, staggered reveals     |
| `prototype/hooks.ts`   | Scripted scene timing, streamed text, element width, reduced motion    |
| `prototype/screens/`   | New chat, conversation, portfolio, unlock                              |
| `capture/`             | Playwright config that writes screenshots and videos to `screenshots/` |

- **The URL is the state:** `/design/prototype/?theme=dark&screen=portfolio`.
  Add `&chrome=0` to hide the prototype controls.
- **The conversation is a scripted scene:** the question, two tool steps, a streamed
  answer, a chart, a second question and the confirmation card, phase by phase.
  The replay button in the controls restarts it.
- **Motion has two layers.** CSS handles entrances and the fade of streamed
  words. anime.js handles what CSS expresses poorly: drawing the chart line,
  filling the allocation bar, choreographed reveals. Both read durations and
  easing from the same CSS tokens. With reduced motion, the durations become zero
  and the anime.js helpers do nothing, so every screen shows its final state.
- **Charts draw as one stroke** (`--kw-duration-chart`, 1.5 s, on the gentle
  `--kw-ease-chart` curve). The line and its fill run from a single timer: on
  every frame the fill opens exactly up to the pen tip (`getPointAtLength`), so the
  two never drift apart. The current-value marker appears near the end. The
  allocation bar fills left to right in one movement rather than segment by segment.
- **Streamed words fade over 400 ms** (`--kw-duration-text`), longer than the time
  between words, so the newest few words are partly transparent at once: the text
  gets a soft trailing edge instead of popping in.
- **Agent steps fade in over 150 ms** (`--kw-duration-step`): the step list and
  the status line above it use the same opacity-only fade as the answer, but
  faster. Status should feel immediate; content gets more time. The status line is
  keyed by its text, so each change ("Read portfolio…" → "Calculated
  performance…") fades in instead of jumping.

## Why this way

- **Prototype in code, not in a design tool.** Tokens, contrast and motion are
  real, and the chosen variant's tokens and components move straight into
  `src/ui/`.
- **Tokens only.** The default Tailwind palette, fonts and radii are removed, so
  a component cannot use a raw color. The same tokens, now in `src/ui/tokens.css`,
  are checked for WCAG AA contrast by `tests/unit/design-tokens.test.ts`.
- **Chart colors.** A validated categorical palette: adjacent pairs stay
  distinguishable under color-vision deficiency, and a color follows the asset,
  never its rank. Three slots fall below 3:1 against the light background, so
  every segment also has a text label, and the holdings table repeats the shares.
- **Self-hosted fonts.** The CSP allows fonts only from our own origin. Instrument
  Sans was the first choice for the warm variant and was dropped: it has no
  Cyrillic, and Russian answers would fall back to a different typeface.
- **anime.js for motion.** GSAP was rejected: its license is proprietary and
  revocable, which conflicts with AGPL, and its text and scroll plugins write
  `innerHTML` or `style` attributes that our CSP and Trusted Types block. Motion
  was rejected: it injects `<style>` tags in some modes. anime.js is MIT licensed;
  its two modules that write `innerHTML` (text splitting, scroll debug markers) are
  banned by an ESLint rule, and text is split in React instead.
- **UI primitives for the next step.** Radix was rejected after reading its
  source: its dialog's scroll lock injects a `<style>` tag with content that
  depends on the scrollbar width, which our nonce-free CSP cannot allow. React
  Aria, used in `src/ui/`, injects two `<style>` tags too, but with fixed text,
  so the CSP allows exactly those by hash (details in
  [src/ui/README.md](../src/ui/README.md)).

## Pitfalls & gotchas

- **There is no CSP in dev, and the prototype never runs under one.** Components
  are checked under the real CSP only once they move into `src/ui/` and the
  production build.
- **React's `style` prop is fine under our CSP** because React applies it through
  the CSSOM in the browser. The same markup rendered as HTML on a server would be
  blocked.
- **The prototype's tokens are a snapshot.** Changes to the design system go to
  `src/ui/tokens.css`; the prototype's copy is not tested and not kept in sync.
- **Use Chromium for captures.** Playwright's Firefox build on macOS ignores
  color-scheme emulation.
- **Mock numbers are plain numbers,** used for display only. Real money uses
  decimal strings (`shared/money`).

## How to work with it

```sh
npm run dev                  # open http://localhost:5173/design/prototype/
npm run design:screenshots   # 20 PNGs: 4 screens × 2 themes × 2 widths, plus the top of the chat
npm run design:videos        # WebM recordings of the animated scenes in both themes
```

Output goes to `design/screenshots/`, which is not committed.

To try a visual idea in the context of a whole screen, edit the prototype; to
change the product, edit `src/ui/` (see its README).

## Related

- [Root README](../README.md)
- [Design system](../src/ui/README.md): what this exploration turned into
- [Unit tests](../tests/unit/README.md): contrast check of the tokens
