# src/ui/

## Purpose

The design system: every color, size and motion value, the base components,
and the light and dark themes. **This README is the source of truth for how
Keyworth looks.** Every screen is built from what is described here; a new
style or component outside it needs a deliberate decision first.

In scope: tokens, theme switching, accessible base components (buttons, fields,
cards, badges, dialogs, toasts, tooltips, skeletons, the theme toggle), motion
helpers, and the `/design` page that shows all of them.

Out of scope: screens and feature components (they live in `src/features/` and
compose these parts), and charts (wrappers arrive with the first chart, in
phase 4, and take their colors from the tokens below).

## How it works

| File                           | Role                                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| `tokens.css`                   | Every raw value: colors per theme, font, radii, shadows, motion           |
| `styles.css`                   | Tokens to Tailwind utilities, no Tailwind defaults, keyframes, print rule |
| `theme.ts`                     | The user's theme choice and the theme on screen, as React hooks           |
| `../../public/theme-init.js`   | Sets the theme before the first paint (not bundled, see below)            |
| `UIProvider.tsx`               | English for React Aria's strings, icon defaults, links through the router |
| `components/`                  | Base components, mostly thin styling layers over React Aria Components    |
| `toast.ts`                     | The toast queue and `showToast()`, callable from anywhere                 |
| `motion.ts`                    | anime.js helpers for charts and choreographed reveals                     |
| `gallery/DesignSystemPage.tsx` | The `/design` page: every component and state                             |
| `index.ts`                     | The public surface: import from `src/ui/index.ts`, not from inner files   |

### Tokens become utilities

`tokens.css` holds the values as CSS variables (`--kw-surface`). `styles.css`
maps them into Tailwind's theme and first removes Tailwind's own palette,
fonts, radii and type scale. Components therefore write `bg-surface` or
`text-fg-muted`; a raw color such as `bg-blue-500` or an off-scale size simply
does not exist. Dark values replace light ones under
`:root[data-theme="dark"]`, so components never use `dark:` variants.

### Colors

Warm neutrals with one indigo accent. Every text and background pair below is
checked for WCAG AA in both themes by `tests/unit/design-tokens.test.ts`.

| Token         | Light     | Dark      | Role                                                 |
| ------------- | --------- | --------- | ---------------------------------------------------- |
| `canvas`      | `#faf9f6` | `#1f1e1b` | Page background                                      |
| `surface`     | `#f2f0eb` | `#262522` | Quiet groups on the page: sidebar, settings sections |
| `raised`      | `#ffffff` | `#2e2c29` | Cards, dialogs, menus, fields                        |
| `hover`       | `#e9e6df` | `#383631` | Hover and pressed backgrounds, skeletons             |
| `bubble`      | `#efece5` | `#33312d` | The user's chat messages                             |
| `fg`          | `#26231f` | `#ede9e2` | Main text                                            |
| `fg-muted`    | `#625d55` | `#b1ab9f` | Secondary text, placeholders, idle icons             |
| `line`        | `#e2ded5` | `#3b3934` | Dividers and card borders (decorative)               |
| `line-strong` | `#8e887d` | `#7d786e` | Field borders: 3:1, as WCAG requires for controls    |
| `accent`      | `#3d4fb5` | `#95a2f2` | The primary action, links, selection                 |
| `on-accent`   | `#ffffff` | `#161827` | Text on the accent                                   |
| `accent-soft` | `#e9ebf8` | `#2b2e45` | Accent-tinted backgrounds                            |
| `focus`       | `#3d4fb5` | `#95a2f2` | The focus ring (2px, offset 2px, on every control)   |
| `gain`        | `#1d7a50` | `#5cc594` | Increases; always with a sign or an arrow            |
| `loss`        | `#b83e2e` | `#f08370` | Decreases and errors; always with a sign or an icon  |
| `on-loss`     | `#ffffff` | `#1f1e1b` | Text on the loss color (the danger button)           |
| `warning`     | `#855900` | `#e2b455` | Warnings, such as an unusual price                   |
| `*-soft`      |           |           | Tinted backgrounds for the three status colors       |
| `scrim`       | 32% ink   | 55% black | Behind modal dialogs                                 |

**Data colors** (`series-1` to `series-5`) are a separate categorical palette,
validated for color-vision deficiency and independent of the brand, with
separate steps for the dark background. A color follows the asset, never its
rank. Three light-theme slots are below 3:1 against the background, so every
chart segment also has a text label and a table repeats the numbers.

| Slot       | Light     | Dark      |
| ---------- | --------- | --------- |
| `series-1` | `#2a78d6` | `#3987e5` |
| `series-2` | `#eb6834` | `#d95926` |
| `series-3` | `#1baf7a` | `#199e70` |
| `series-4` | `#eda100` | `#c98500` |
| `series-5` | `#e87ba4` | `#d55181` |

### Typography

**Onest**, a variable font with Cyrillic (answers can be in Russian), served
from our own origin. Weights: 400 for text, 500 for labels and buttons, 600 for
headings. Numbers in tables, badges and axes use `tabular-nums`.

| Utility     | Size / line height | Use                                  |
| ----------- | ------------------ | ------------------------------------ |
| `text-3xl`  | 36 / 44            | Key figures, such as portfolio value |
| `text-2xl`  | 28 / 36            | The new chat greeting                |
| `text-xl`   | 24 / 32            | Page titles                          |
| `text-lg`   | 18 / 28            | Dialog and section titles            |
| `text-md`   | 16 / 24            | Text inputs (iOS zooms into smaller) |
| `text-base` | 15 / 24            | Reading text: answers, descriptions  |
| `text-sm`   | 14 / 20            | Controls, labels, tables             |
| `text-xs`   | 12 / 16            | Captions, metadata, field hints      |
| `text-2xs`  | 11 / 16            | Chart axes, initials                 |

Headings of 24px and up use `tracking-tight`.

### Spacing, radii, elevation

- **Spacing:** Tailwind's 4px grid. Page gutter 16px on phones, 24px from
  640px. Content width: `max-w-3xl` for the conversation, `max-w-4xl` for pages.
- **Radii:** `sm` 6px (badges, tooltips, segments), `md` 8px (buttons,
  fields), `lg` 14px (cards, toasts), `xl` 20px (dialogs). An inner radius is
  the outer one minus the padding: the theme toggle is `md` with 2px padding
  around `sm` segments.
- **Elevation:** one shadow, `shadow-raised`, for things above the page (cards,
  dialogs, toasts, the selected segment). Surfaces on the page have none.

### Motion

Short and smooth. All values are CSS variables read by both CSS and anime.js,
and every one becomes 0 when the user prefers reduced motion, so screens appear
in their final state without extra code.

| Token                 | Value                            | Use                                      |
| --------------------- | -------------------------------- | ---------------------------------------- |
| `--kw-duration-fast`  | 150ms                            | Color changes on hover, exits            |
| `--kw-duration-base`  | 240ms                            | Entrances of messages, dialogs, toasts   |
| `--kw-duration-slow`  | 900ms                            | Reserved for larger reveals (unused yet) |
| `--kw-stagger`        | 70ms                             | Delay between items revealed in turn     |
| `--kw-ease-out`       | `cubic-bezier(0.22, 1, 0.36, 1)` | Default easing                           |
| `--kw-duration-chart` | 1500ms                           | A chart line drawing in, as one stroke   |
| `--kw-ease-chart`     | `cubic-bezier(0.4, 0, 0.2, 1)`   | Gentle at both ends, for charts          |
| `--kw-duration-text`  | 400ms                            | Each streamed word fading in             |
| `--kw-duration-step`  | 150ms                            | Agent steps and the status line          |

CSS covers entrances (`animate-enter`, `animate-fade-in`, `animate-pop-in`, and
the matching `-out` exits), streamed words (`animate-word`), agent steps
(`animate-step`) and height changes (`collapsible`). anime.js, through
`motion.ts`, covers what CSS expresses poorly: drawing a chart line with its
fill opening exactly to the pen tip, filling a bar left to right, staggered
reveals. Exits are faster than entrances.

### Icons

[Lucide](https://lucide.dev), 16px at a 1.75 stroke by default (set once in
`UIProvider`). Decorative icons get `aria-hidden="true"`; an icon-only button
gets its name from `IconButton`'s `label`.

### Themes

Three modes: **System** (the default), **Light** and **Dark**.

```
localStorage "keyworth-theme" ("light" | "dark" | absent = system)
        │
        ▼
public/theme-init.js ── runs in <head>, before CSS and React ──► <html data-theme="light|dark">
   ▲  listens to the system setting and to other tabs                 │
   │                                                                  ├─► tokens.css: colors
theme.ts: setThemePreference() writes storage + the attribute         └─► useTheme(): React re-renders
```

`data-theme` always holds the **resolved** theme, so one dark block in
`tokens.css` covers both "Dark" and "System while the system is dark", and code
that cannot read CSS variables by itself (canvas charts) learns the current
theme from `useTheme()`. `color-scheme` follows the theme, so native scrollbars
and form controls match.

### Components

| Component                 | Built on                   | Notes                                                                              |
| ------------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| `Button`                  | React Aria `Button`        | `primary` (one per view), `secondary`, `ghost`, `danger`; `sm`/`md`; `isPending`   |
| `IconButton`              | React Aria `Button`        | Required `label`, shown as a tooltip; `ghost` or `primary` (Send)                  |
| `TextField`               | React Aria `TextField`     | Visible label, hint, error; ARIA validation, no native bubbles                     |
| `PasswordField`           | React Aria `TextField`     | Secrets: hidden with a show button; no autocorrect, capitals, spellcheck, autofill |
| `Select`                  | React Aria `Menu`          | A short list that applies at once, such as a currency; not React Aria's `Select`   |
| `Checkbox`                | React Aria `CheckboxField` | With `CheckboxButton`; label and an optional description line                      |
| `Notice`                  | `p`                        | `error` (announced), `warning`, `info`; always with an icon                        |
| `Card`                    | `div`                      | `raised` (above the page) or `surface` (on it); padding from the caller            |
| `Badge`                   | `span`                     | `neutral`, `accent`, `gain`, `loss`, `warning`; status needs an icon               |
| `Dialog`, `DialogActions` | React Aria `Modal`         | Focus trap and return, scroll lock; `alertdialog` ignores Escape                   |
| `Toaster`, `showToast()`  | React Aria `Toast`         | Top of the screen; errors stay until dismissed, others 5 seconds                   |
| `Tooltip`                 | React Aria `Tooltip`       | Hover and keyboard focus only; never the only label                                |
| `Skeleton`                | `div`                      | Hidden from screen readers; mark the region `aria-busy`                            |
| `ThemeToggle`             | `ToggleButtonGroup`        | Icons in the header, icons with text in settings                                   |
| `ButtonLink`              | React Aria `Link`          | Navigation that reads as an action; the same variants as `Button`                  |
| `TextLink`                | React Aria `Link`          | Inline link in running text, always underlined                                     |
| `KeyworthMark`            | `svg`                      | The app's mark (a keyhole on the accent); decorative                               |

Text controls (`TextField`, `PasswordField`, and feature fields built from
React Aria parts, such as the recovery key field) share one box style,
`fieldBoxClassName` in `components/field-styles.ts`: the same border,
background and hover, focus, invalid and disabled states. `PasswordField`,
`Select`, `Checkbox` and `Notice` were approved on 2026-10-31 for the
encryption screens.

Links are React Aria `Link`s, so they share the buttons' hover, press and
focus states. `UIProvider` receives the app router's `navigate`, which keeps
`src/ui` independent of the router while links still navigate without a page
load.

States come from React Aria's data attributes (`data-hovered`,
`data-pressed`, `data-focus-visible`, `data-disabled`) rather than CSS
`:hover`, so a tap on a phone never leaves a "stuck" hover. A component's
`className` is for layout only (margins, width); colors and sizes come from its
props.

### The `/design` page

`src/routes/router.tsx` adds the `/design` route only when
`import.meta.env.DEV` is true or the build runs with `--mode design`. In a production build the condition is
the constant `false`, so the page's code is not even in the bundle
(`tests/e2e/app.spec.ts` checks the page is absent). The design build goes to
`dist-design/` and is what the visual, accessibility and CSP tests run against.

## Writing for the interface

- English only, in sentence case. No ALL CAPS labels.
- Buttons are verbs that say what happens ("Record trade", not "Submit"), and
  the result uses the same word ("Trade recorded").
- Errors say what is wrong and how to fix it, without apologizing:
  "Quantity must be greater than zero."
- Dates that a user confirms are written in words: `December 20, 2025`, never
  `20.12.25`.
- Gains and losses always carry a sign and an arrow; color is never the only
  signal.
- The red `danger` button appears only on the final confirmation of an
  irreversible deletion, and its label names what is lost ("Delete account").
  The control that opens the confirmation stays neutral, so red marks the point
  of no return and nothing else.

## Why this way

- **The warm direction.** Chosen by the owner from two prototypes; the
  reasoning and the rejected neutral variant are in
  [design/README.md](../../design/README.md).
- **React Aria Components** for accessible primitives (focus management,
  keyboard support, screen reader semantics) instead of writing them.
  **Radix was rejected:** its dialog's scroll lock inserts a `<style>` tag
  whose content depends on the scrollbar width, so no CSP hash can allow it,
  and our CSP has no nonce. React Aria inserts two `<style>` tags of its own,
  but their text is fixed, so the CSP allows exactly those two by SHA-256 hash
  (see Pitfalls). Base UI was also clean, but has no date picker, which trade
  entry will need.
- **No `tailwind-merge` or variant libraries.** Each component has a few
  variants written out as plain maps; restricting `className` to layout avoids
  the class conflicts those libraries exist to resolve.
- **Tailwind's defaults removed.** Without them, a raw color or an off-scale
  size fails to exist at all, instead of slipping through review.
- **The danger button darkens by mixing, not by transparency.** `primary` fades
  the accent on hover and press (`bg-accent/90`); the same on the red would
  lighten it over a white dialog and drop white text to 3.9:1 when pressed.
  `loss-hover` and `loss-pressed` (in `styles.css`) mix the red toward `fg`
  instead: darker in the light theme, lighter in the dark one, so the contrast
  with `on-loss` rises in every state. The unit test checks the same mixes.
- **One dark block, set by a script.** The alternative, a
  `prefers-color-scheme` media query plus an override attribute, needs every
  dark value written twice. The theme script must exist anyway (the CSP forbids
  inline scripts, and a stored choice must apply before the first paint), so it
  also resolves "System".
- **anime.js for motion.** GSAP was rejected (a proprietary, revocable license,
  and plugins that write `innerHTML` or style attributes); Motion was rejected
  (it inserts `<style>` tags in some modes). anime.js is MIT licensed, and an
  ESLint rule bans its two modules that write `innerHTML`.
- **Onest.** The first choice, Instrument Sans, has no Cyrillic, so Russian
  answers would fall back to a different typeface.
- **Toasts at the top.** The chat composer occupies the bottom of the screen
  on every device.
- **English locale for React Aria.** Its built-in labels ("Close", "Dismiss")
  would otherwise follow the browser's language, while the rest of the
  interface is English only.

## Pitfalls & gotchas

- **React Aria's two runtime `<style>` blocks are allowed by hash** in
  `public/_headers`: `touch-action` for every pressable element, and
  `overscroll-behavior` while a dialog is open on iOS. If an upgrade changes
  their text, the e2e tests fail with a CSP violation (they also check that the
  styles actually apply, on desktop engines and on an emulated iPhone).
  Chromium's console error then prints the new hash; update `_headers`,
  `tests/e2e/headers.spec.ts` and [worker/README.md](../../worker/README.md).
- **There is no CSP in `npm run dev`.** A component can look fine in dev and
  break in production. `npm run test:e2e` runs `/design` under the real
  headers in three engines.
- **React Aria's toast API is still marked unstable** (`UNSTABLE_` exports).
  It is used only in `toast.ts` and `Toaster.tsx`.
- **No native `<select>`, anywhere.** WebKit reports creating one as a CSP
  violation (`style-src-attr`, from the browser's own internals, with an empty
  sample), so every Safari console would show an error. React Aria's `Select`
  always adds a hidden one for form autofill; our `Select` is therefore a menu
  of radio items (`MenuTrigger` + `Menu`). The e2e suite fails on the
  violation in WebKit.
- **Spin-button fields (NumberField, DateField) clear an announcement with
  `innerHTML = ''`**, which Trusted Types may block. Check them under the real
  CSP before using them (phase 4, trade entry).
- **`vite preview` serves whichever build ran last**, and `vite build --mode
design` also redirects `wrangler deploy` to `dist-design/` until the next
  production build. So the previews run `wrangler dev` with each build's own
  config, and `npm run deploy` always rebuilds first. Never run a bare
  `wrangler deploy` after `npm run build:design`.
- **Tailwind scans only `src/`** (`source(none)` plus `@source "../"`). Class
  names must appear in full in the source: `bg-${tone}` would never be
  generated, which is why variant maps spell out every class.
- **Prettier sorts classes using `styles.css`** (`.prettierrc.json`). A class
  it does not know, such as one defined only in another stylesheet, is moved to
  the front.
- **Tooltips never appear on touch screens.** An icon-only control's name must
  come from `aria-label` (`IconButton` requires one).
- **`exactOptionalPropertyTypes`** rejects passing `undefined` to React
  Aria's optional props; spread the prop conditionally instead.
- **Dialogs follow the visible part of the page, not the layout**: as tall
  as it (`h-(--visual-viewport-height)`, set by React Aria) and starting where
  it starts (`useVisualViewportTop`, `viewport.ts`). On iOS the on-screen
  keyboard shrinks the visible part and Safari may move it down the page; a
  dialog placed by the layout sat behind the keyboard, or above the screen.
- **No `autoFocus` on fields in dialogs on touch screens**
  (`autoFocus={hasFinePointer()}`): focusing in code does not open the
  keyboard there, and a later tap on the already focused field skips React
  Aria's focus handling, so Safari scrolls the page itself. With a mouse or
  trackpad the first field still takes focus.
- The e2e test fakes the keyboard by replacing `visualViewport`, which
  Playwright cannot shrink or move by itself; it fails without either fix.
- **The production CSS minifier rewrites durations in seconds** when shorter
  (`240ms` becomes `.24s`). Read tokens with `durationMs()` (`motion.ts`), never
  `parseFloat` alone: that read 0.24 ms, and only in production builds.
- **Printing a recovery key** uses the one print rule in `styles.css`: while
  `<html>` has `data-printing-key`, everything is hidden except
  `[data-print-key]` (by `visibility`, so it works in dialogs, which render in
  a portal). The panel in `src/features/unlock` sets both; nothing else
  prints specially.

## How to work with it

```sh
npm run dev                  # http://localhost:5173/design
npm run test:e2e             # /design under the real CSP: errors, keyboard, themes, axe
npm run test:visual          # screenshots of /design against the baselines (Docker)
npm run test:visual:update   # after an intended visual change; review the PNG diff
npx vitest run --project unit  # contrast of every token pair
```

**Adding a color token:** add it to both blocks in `tokens.css`, map it in
`styles.css` (`@theme inline`), add its text/background pairs to
`tests/unit/design-tokens.test.ts`, show it on `/design`, and document it in the
table above.

**Adding a component:** build on a React Aria component when one exists, style
it with tokens only, export it from `index.ts`, add every state to
`/design`, extend `tests/e2e/design-system.spec.ts` if it has behavior, and
update the baselines with `npm run test:visual:update`.

## Related

- [design/](../../design/README.md): the phase 1 prototype and the brief
- [tests/visual/](../../tests/visual/README.md): screenshot baselines of `/design`
- [tests/e2e/](../../tests/e2e/README.md): CSP, keyboard, theme and axe checks
- [worker/](../../worker/README.md): the CSP and why each exception exists
