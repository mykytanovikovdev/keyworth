# design/

## Purpose

Phase 1 design exploration: a clickable prototype of Keyworth's key screens in
two visual variants, light and dark, used to choose a direction before the design
system is built in `src/ui/`.

The prototype is a review tool, not product code. It is excluded from the
production build and never deployed.

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

## The two variants

Both share one layout and one set of components; only the tokens differ.

|         | Neutral                                             | Warm                                 |
| ------- | --------------------------------------------------- | ------------------------------------ |
| Palette | White and near-black; color only for data and focus | Warm neutrals with one indigo accent |
| Type    | IBM Plex Sans                                       | Onest                                |
| Radii   | 10 / 16 / 26 px                                     | 8 / 14 / 20 px                       |

## How it works

| Path                   | Role                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `index.html`           | Dev-only Vite entry, served at `/design/` by `npm run dev`             |
| `prototype/tokens.css` | Every raw value: colors per variant and theme, fonts, radii, motion    |
| `prototype/styles.css` | Maps tokens to Tailwind utilities; removes the default palette         |
| `prototype/motion.ts`  | anime.js helpers: draw a line, grow bars, staggered reveals            |
| `prototype/hooks.ts`   | Scripted scene timing, streamed text, element width, reduced motion    |
| `prototype/screens/`   | New chat, conversation, portfolio, unlock                              |
| `capture/`             | Playwright config that writes screenshots and videos to `screenshots/` |

- **The URL is the state:** `/design/?variant=warm&theme=dark&screen=portfolio`.
  Add `&chrome=0` to hide the prototype controls.
- **The conversation is a scripted scene:** the question, two tool steps, a streamed
  answer, a chart, a second question and the confirmation card, phase by phase.
  The replay button in the controls restarts it.
- **Motion has two layers.** CSS handles entrances and the per-word fade of
  streamed text. anime.js handles what CSS expresses poorly: drawing the chart
  line, growing allocation bars, choreographed reveals. Both read durations and
  easing from the same CSS tokens. With reduced motion, the durations become zero
  and the anime.js helpers do nothing, so every screen shows its final state.

## Why this way

- **Prototype in code, not in a design tool.** Tokens, contrast and motion are
  real, and the chosen variant's tokens and components move straight into
  `src/ui/`.
- **Tokens only.** The default Tailwind palette, fonts and radii are removed, so
  a component cannot use a raw color. `tests/unit/design-tokens.test.ts` checks
  WCAG AA contrast for every text and background pair, in every variant and theme.
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
  source: its dialog's scroll lock injects a `<style>` tag, which our nonce-free
  CSP blocks. React Aria has no such injection and will be used in `src/ui/`.

## Pitfalls & gotchas

- **There is no CSP in dev, and the prototype never runs under one.** Components
  are checked under the real CSP only once they move into `src/ui/` and the
  production build.
- **React's `style` prop is fine under our CSP** because React applies it through
  the CSSOM in the browser. The same markup rendered as HTML on a server would be
  blocked.
- **Keep the selector form in `tokens.css` exactly as it is.** The contrast test
  parses blocks like `:root[data-variant="warm"][data-theme="dark"]`.
- **Use Chromium for captures.** Playwright's Firefox build on macOS ignores
  color-scheme emulation.
- **Mock numbers are plain numbers,** used for display only. Real money uses
  decimal strings from phase 4.

## How to work with it

```sh
npm run dev                  # open http://localhost:5173/design/
npm run design:screenshots   # 40 PNGs: 2 variants × 4 screens × 2 themes × 2 widths (+ chat top)
npm run design:videos        # 6 WebM recordings of the animated scenes
```

Output goes to `design/screenshots/`, which is not committed.

To try a token change, edit `prototype/tokens.css`, then run
`npx vitest run --project unit` to check contrast.

## Related

- [Root README](../README.md)
- [Unit tests](../tests/unit/README.md): contrast check of the tokens
- `src/ui/README.md`: the design system that follows from this exploration
