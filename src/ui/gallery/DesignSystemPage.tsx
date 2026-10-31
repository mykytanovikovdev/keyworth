import {
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  Copy,
  KeyRound,
  Lock,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  TriangleAlert,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Dialog,
  DialogActions,
  DialogTrigger,
  IconButton,
  KeyworthMark,
  Notice,
  PasswordField,
  Select,
  showToast,
  Skeleton,
  TextField,
  TextLink,
  ThemeToggle,
  useTheme,
} from "../index.ts";

/*
 * The living reference of src/ui: every component and state in both themes.
 * Built only in dev and in `vite build --mode design` (see src/App.tsx), and
 * the target of the visual, accessibility and CSP tests.
 */

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="max-w-prose text-sm text-fg-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
      <span className="w-28 shrink-0 text-xs text-fg-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

// Class names are written out in full so Tailwind can find them.
const colorGroups: { name: string; tokens: [string, string][] }[] = [
  {
    name: "Surfaces",
    tokens: [
      ["canvas", "bg-canvas"],
      ["surface", "bg-surface"],
      ["raised", "bg-raised"],
      ["hover", "bg-hover"],
      ["bubble", "bg-bubble"],
    ],
  },
  {
    name: "Text and lines",
    tokens: [
      ["fg", "bg-fg"],
      ["fg-muted", "bg-fg-muted"],
      ["line", "bg-line"],
      ["line-strong", "bg-line-strong"],
    ],
  },
  {
    name: "Accent",
    tokens: [
      ["accent", "bg-accent"],
      ["on-accent", "bg-on-accent"],
      ["accent-soft", "bg-accent-soft"],
      ["focus", "bg-focus"],
    ],
  },
  {
    name: "Status",
    tokens: [
      ["gain", "bg-gain"],
      ["gain-soft", "bg-gain-soft"],
      ["loss", "bg-loss"],
      ["on-loss", "bg-on-loss"],
      ["loss-soft", "bg-loss-soft"],
      ["warning", "bg-warning"],
      ["warning-soft", "bg-warning-soft"],
    ],
  },
  {
    name: "Data series",
    tokens: [
      ["series-1", "bg-series-1"],
      ["series-2", "bg-series-2"],
      ["series-3", "bg-series-3"],
      ["series-4", "bg-series-4"],
      ["series-5", "bg-series-5"],
    ],
  },
];

function Colors() {
  // Re-read the values when the theme changes.
  useTheme();
  const styles = getComputedStyle(document.documentElement);
  return (
    <div className="flex flex-col gap-6">
      {colorGroups.map((group) => (
        <div key={group.name} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{group.name}</h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {group.tokens.map(([token, className]) => (
              <li key={token} className="flex items-center gap-2">
                <span
                  className={`size-8 shrink-0 rounded-md ring-1 ring-line ${className}`}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium">{token}</span>
                  <span className="text-2xs text-fg-muted tabular-nums">
                    {styles.getPropertyValue(`--kw-${token}`).trim()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const typeScale: [string, string, string, ReactNode][] = [
  ["3xl", "36 / 44", "text-3xl font-semibold tracking-tight", "$48,215.30"],
  [
    "2xl",
    "28 / 36",
    "text-2xl font-semibold tracking-tight",
    "What would you like to know?",
  ],
  ["xl", "24 / 32", "text-xl font-semibold tracking-tight", "Portfolio"],
  ["lg", "18 / 28", "text-lg font-semibold", "Record this trade?"],
  ["md", "16 / 24", "text-md", "Text typed into a field"],
  [
    "base",
    "15 / 24",
    "text-base",
    "Your portfolio grew 4.2% in October, mostly because of Bitcoin.",
  ],
  ["sm", "14 / 20", "text-sm", "Buttons, labels and table cells"],
  ["xs", "12 / 16", "text-xs text-fg-muted", "Captions and metadata"],
  ["2xs", "11 / 16", "text-2xs text-fg-muted", "Chart axes: Oct 1, Oct 8"],
];

function Typography() {
  return (
    <div className="flex flex-col gap-4">
      {typeScale.map(([name, metrics, className, sample]) => (
        <div
          key={name}
          className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6"
        >
          <span className="flex w-28 shrink-0 gap-2 text-xs text-fg-muted tabular-nums">
            <span className="w-8 font-medium text-fg">{name}</span>
            <span>{metrics}</span>
          </span>
          <span className={className}>{sample}</span>
        </div>
      ))}
      <Row label="Weights">
        <span className="text-base">Regular 400</span>
        <span className="text-base font-medium">Medium 500</span>
        <span className="text-base font-semibold">Semibold 600</span>
      </Row>
      <Row label="Cyrillic">
        <span className="text-base">
          Купил 5 LTC 20 декабря по 60,03 $ — ответ на языке вопроса.
        </span>
      </Row>
      <Row label="Numbers">
        <span className="text-base tabular-nums">
          1,204.50
          <br />
          98,061.07
        </span>
        <span className="text-xs text-fg-muted">
          Tabular figures keep columns aligned.
        </span>
      </Row>
    </div>
  );
}

function Buttons() {
  return (
    <div className="flex flex-col gap-4">
      <Row label="Variants">
        <Button variant="primary">Confirm</Button>
        <Button>Edit</Button>
        <Button variant="ghost">Reject</Button>
      </Row>
      <Row label="With icon">
        <Button variant="primary" icon={<Plus aria-hidden="true" />}>
          Add trade
        </Button>
        <Button icon={<RotateCcw aria-hidden="true" />}>Retry</Button>
      </Row>
      <Row label="Small">
        <Button variant="primary" size="sm">
          Confirm
        </Button>
        <Button size="sm">Edit</Button>
        <Button variant="ghost" size="sm">
          Reject
        </Button>
      </Row>
      <Row label="Disabled">
        <Button variant="primary" isDisabled>
          Confirm
        </Button>
        <Button isDisabled>Edit</Button>
      </Row>
      <Row label="Pending">
        <Button variant="primary" isPending>
          Saving
        </Button>
      </Row>
      <Row label="Danger">
        <Button variant="danger">Delete account</Button>
        <Button variant="danger" isPending>
          Deleting
        </Button>
      </Row>
      <Row label="Icon buttons">
        <IconButton label="Copy answer">
          <Copy />
        </IconButton>
        <IconButton label="Search chats">
          <Search />
        </IconButton>
        <IconButton label="Send" variant="primary">
          <ArrowUp />
        </IconButton>
      </Row>
      <Row label="Links">
        <ButtonLink
          href="/design#buttons"
          icon={<Settings aria-hidden="true" />}
        >
          Open settings
        </ButtonLink>
        <span className="text-sm text-fg-muted">
          Read the <TextLink href="/design#buttons">privacy policy</TextLink>.
        </span>
      </Row>
    </div>
  );
}

const CURRENCIES = [
  { id: "USD", label: "US dollar (USD)" },
  { id: "EUR", label: "Euro (EUR)" },
  { id: "GBP", label: "British pound (GBP)" },
];

function Fields() {
  const [value, setValue] = useState("");
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <PasswordField
        label="Passphrase"
        autoComplete="off"
        description="At least 12 characters. It never leaves this device."
        value={value}
        onChange={setValue}
      />
      <TextField
        label="Quantity"
        defaultValue="-5"
        inputMode="decimal"
        isInvalid
        errorMessage="Quantity must be greater than zero."
      />
      <TextField label="Asset" placeholder="Search by name or ticker" />
      <TextField label="Exchange" defaultValue="Binance" isDisabled />
      <Select label="Base currency" options={CURRENCIES} defaultValue="USD" />
      <Checkbox
        label="Remember this device"
        description="Stay unlocked in this browser until you lock Keyworth."
      />
    </div>
  );
}

function Notices() {
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="error">
        This passphrase doesn&apos;t unlock your data. Check it and try again.
      </Notice>
      <Notice tone="warning">
        This price is far from the market price on that day.
      </Notice>
      <Notice tone="info">Locked after 15 minutes without activity.</Notice>
    </div>
  );
}

function Badges() {
  return (
    <Row label="Tones">
      <Badge tone="gain" icon={<ArrowUpRight size={12} aria-hidden="true" />}>
        +4.2%
      </Badge>
      <Badge tone="loss" icon={<ArrowDownRight size={12} aria-hidden="true" />}>
        −1.1%
      </Badge>
      <Badge
        tone="warning"
        icon={<TriangleAlert size={12} aria-hidden="true" />}
      >
        Price looks unusual
      </Badge>
      <Badge tone="accent" icon={<Lock size={12} aria-hidden="true" />}>
        Encrypted
      </Badge>
      <Badge>Manual</Badge>
    </Row>
  );
}

function Cards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="flex flex-col gap-1 p-5">
        <span className="text-sm text-fg-muted">Portfolio value</span>
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          $48,215.30
        </span>
        <span className="flex items-center gap-2 text-sm">
          <Badge
            tone="gain"
            icon={<ArrowUpRight size={12} aria-hidden="true" />}
          >
            +4.2%
          </Badge>
          <span className="text-fg-muted">this month</span>
        </span>
      </Card>
      <Card tone="surface" className="flex flex-col gap-2 p-5">
        <span className="text-sm font-medium">Surface</span>
        <span className="text-sm text-fg-muted">
          Quiet grouping on the page: settings sections, the chat history.
        </span>
      </Card>
    </div>
  );
}

function Dialogs() {
  return (
    <Row label="Modal">
      <DialogTrigger>
        <Button>Open dialog</Button>
        <Dialog title="Recovery key">
          {(close) => (
            <>
              <p className="mt-2 text-base text-fg-muted">
                Store this key somewhere safe. With your passphrase, it is the
                only way to unlock your data.
              </p>
              <DialogActions>
                <Button onPress={close}>Cancel</Button>
                <Button
                  variant="primary"
                  icon={<KeyRound aria-hidden="true" />}
                  onPress={close}
                >
                  I saved it
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>
      </DialogTrigger>
      <DialogTrigger>
        <Button>Open confirmation</Button>
        <Dialog title="Discard this trade?" role="alertdialog">
          {(close) => (
            <>
              <p className="mt-2 text-base text-fg-muted">
                The trade has not been saved. Nothing will be recorded.
              </p>
              <DialogActions>
                <Button onPress={close}>Keep editing</Button>
                <Button variant="primary" onPress={close}>
                  Discard
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>
      </DialogTrigger>
    </Row>
  );
}

function Toasts() {
  return (
    <Row label="Tones">
      <Button
        onPress={() =>
          showToast("Trade recorded", {
            tone: "success",
            description: "5 LTC, December 20, 2025",
          })
        }
      >
        Show success
      </Button>
      <Button
        onPress={() =>
          showToast("Couldn't save the trade", {
            tone: "error",
            description: "Check your connection and try again.",
          })
        }
      >
        Show error
      </Button>
      <Button onPress={() => showToast("Prices updated")}>Show info</Button>
    </Row>
  );
}

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">Loading holdings</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

const iconSamples: [string, ReactNode][] = [
  ["Send", <Send key="send" aria-hidden="true" />],
  ["Search", <Search key="search" aria-hidden="true" />],
  ["Lock", <Lock key="lock" aria-hidden="true" />],
  ["KeyRound", <KeyRound key="key" aria-hidden="true" />],
  ["Copy", <Copy key="copy" aria-hidden="true" />],
  [
    "ArrowUpRight",
    <ArrowUpRight key="up" aria-hidden="true" className="text-gain" />,
  ],
  [
    "ArrowDownRight",
    <ArrowDownRight key="down" aria-hidden="true" className="text-loss" />,
  ],
];

function Icons() {
  return (
    <div className="flex flex-col gap-4">
      <Row label="Mark">
        <KeyworthMark />
        <KeyworthMark className="size-10" />
      </Row>
      <ul className="flex flex-wrap gap-x-6 gap-y-4">
        {iconSamples.map(([name, icon]) => (
          <li
            key={name}
            className="flex items-center gap-2 text-xs text-fg-muted"
          >
            <span className="text-fg">{icon}</span>
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Motion() {
  const [replay, setReplay] = useState(0);
  const words =
    "Each word of a streamed answer fades in over 400 ms, so the newest words form a soft edge.".split(
      " ",
    );
  return (
    <div className="flex flex-col gap-4">
      <Row label="Replay">
        <Button
          size="sm"
          icon={<RotateCcw aria-hidden="true" />}
          onPress={() => {
            setReplay((value) => value + 1);
          }}
        >
          Replay
        </Button>
      </Row>
      <div key={replay} className="flex flex-col gap-3">
        <Card className="animate-enter p-4 text-sm">
          Panels and messages enter over 240 ms, rising 6 px.
        </Card>
        <p className="text-base">
          {words.map((word, index) => (
            <span
              // Words repeat, so the index is part of the key.
              key={`${String(index)}-${word}`}
              className="animate-word"
              // The stagger token is 0 with reduced motion, so no word waits.
              style={{
                animationDelay: `calc(var(--kw-stagger) * ${String(index)})`,
              }}
            >
              {word}{" "}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

export default function DesignSystemPage() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
          <span className="text-sm font-semibold">Keyworth</span>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex max-w-4xl flex-col gap-12 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            Design system
          </h1>
          <p className="max-w-prose text-base text-fg-muted">
            Every component and state, in the current theme. Values come from
            src/ui/tokens.css; rules and reasoning are in src/ui/README.md.
          </p>
        </div>
        <Section
          id="colors"
          title="Colors"
          description="Semantic tokens only. Components never use raw colors; data series are separate from the brand."
        >
          <Colors />
        </Section>
        <Section
          id="type"
          title="Typography"
          description="Onest, a variable font with Cyrillic. Sizes in px: font size / line height."
        >
          <Typography />
        </Section>
        <Section
          id="buttons"
          title="Buttons"
          description="One primary action per view. Labels are verbs that say what happens. Links that navigate can look like buttons."
        >
          <Buttons />
        </Section>
        <Section
          id="fields"
          title="Fields"
          description="Always a visible label. Errors say what is wrong and how to fix it. Secrets have a show button and no autocorrect."
        >
          <Fields />
        </Section>
        <Section
          id="notices"
          title="Notices"
          description="A short message inside a page or form. Only errors are announced; status colors always come with an icon."
        >
          <Notices />
        </Section>
        <Section
          id="badges"
          title="Badges"
          description="Status uses a sign or an icon as well as color."
        >
          <Badges />
        </Section>
        <Section
          id="cards"
          title="Cards"
          description="Raised cards sit above the page; surface groups sit on it."
        >
          <Cards />
        </Section>
        <Section
          id="dialogs"
          title="Dialogs"
          description="A confirmation cannot be dismissed by accident: no Escape, no click outside."
        >
          <Dialogs />
        </Section>
        <Section
          id="toasts"
          title="Toasts"
          description="Short feedback at the top of the screen. Errors stay until dismissed."
        >
          <Toasts />
        </Section>
        <Section
          id="loading"
          title="Loading"
          description="Skeletons mirror the layout that is loading. Hidden from screen readers."
        >
          <Loading />
        </Section>
        <Section
          id="theme"
          title="Theme"
          description="Follows the system by default. The choice is saved on this device."
        >
          <Row label="With labels">
            <ThemeToggle showLabels />
          </Row>
        </Section>
        <Section
          id="icons"
          title="Mark and icons"
          description="The Keyworth mark, then Lucide icons at a 1.75 stroke. Decorative icons are hidden from screen readers."
        >
          <Icons />
        </Section>
        <Section
          id="motion"
          title="Motion"
          description="Short and smooth. With reduced motion, everything appears in its final state."
        >
          <Motion />
        </Section>
      </main>
    </div>
  );
}
