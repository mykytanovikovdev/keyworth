import { argon2idAsync } from "@noble/hashes/argon2.js";
import { LogOut, RotateCcw, Settings } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { CURRENT_KDF_PARAMS } from "../crypto/index.ts";
import { DeleteAccountMock } from "../features/settings/DeleteAccountMock.tsx";
import {
  BaseCurrencySection,
  ChangePassphraseDialog,
  LockSection,
  NewRecoveryKeyDialog,
  PassphraseSection,
  RecoveryKeySection,
  SignOutEverywhereSection,
} from "../features/settings/EncryptionSettings.tsx";
import { Section } from "../features/settings/Section.tsx";
import { CreatePassphraseScreen } from "../features/unlock/CreatePassphraseScreen.tsx";
import { ExplainerScreen } from "../features/unlock/ExplainerScreen.tsx";
import { KeyProgress } from "../features/unlock/key-progress.ts";
import { KeysUnavailableScreen } from "../features/unlock/KeysUnavailableScreen.tsx";
import { NeedsHttpsScreen } from "../features/unlock/NeedsHttpsScreen.tsx";
import { RecoveryScreen } from "../features/unlock/RecoveryScreen.tsx";
import { SaveRecoveryKeyScreen } from "../features/unlock/SaveRecoveryKeyScreen.tsx";
import { UnlockScreen } from "../features/unlock/UnlockScreen.tsx";
import {
  baseDuration,
  Button,
  ButtonLink,
  KeyworthMark,
  ThemeToggle,
} from "../ui/index.ts";

/*
 * Mockups of the phase 3.3 screens, for review before they are wired up
 * (dev and design builds only). `?screen=<id>` opens one; `&bare` hides the
 * switcher, for screenshots. The "try it" screens run Argon2 for the ring
 * around the mark; Replay starts a screen over.
 */

const EMAIL = "alex@example.com";
// A sample to show the layout (the test vector of bytes 40..53), not a credential.
const SAMPLE_KEY = "810M-4GT4-8N34-EJ29-995M-RKAE-9X85-2MJK-99VN"; // gitleaks:allow

/**
 * Argon2 with the production settings, or four times the passes to watch the
 * ring under the same load. noble alone, without WebCrypto, so a phone on the
 * local network can run it too (over HTTPS: see /design/kdf).
 */
async function derive(progress: KeyProgress, slow: boolean) {
  const { memoryKiB, passes, parallelism } = CURRENT_KDF_PARAMS;
  await argon2idAsync(
    crypto.getRandomValues(new Uint8Array(24)),
    crypto.getRandomValues(new Uint8Array(16)),
    {
      t: slow ? passes * 4 : passes,
      m: memoryKiB,
      p: parallelism,
      dkLen: 32,
      onProgress: progress.report,
    },
  );
}

/** A key screen's life as the app runs it: Argon2, then the lock turns or refuses. */
function useTryIt({ slow = false, refuse = false }) {
  const [progress] = useState(() => new KeyProgress());
  const [phase, setPhase] = useState<"form" | "working" | "opened" | "done">(
    "form",
  );
  const [refused, setRefused] = useState(false);
  return {
    progress,
    pending: phase === "working",
    opened: phase === "opened",
    done: phase === "done",
    refused,
    clear: () => {
      setRefused(false);
    },
    start: () => {
      setRefused(false);
      setPhase("working");
      void derive(progress, slow).then(() => {
        if (refuse) {
          setRefused(true);
          setPhase("form");
          return;
        }
        setPhase("opened");
        window.setTimeout(() => {
          setPhase("done");
        }, baseDuration());
      });
    },
  };
}

function TryUnlock(options: { slow?: boolean; refuse?: boolean }) {
  const demo = useTryIt(options);
  if (demo.done) return <SettingsMock />;
  return (
    <UnlockScreen
      email={EMAIL}
      progress={demo.progress}
      pending={demo.pending}
      opened={demo.opened}
      problem={demo.refused ? "wrong" : undefined}
      onEdit={demo.clear}
      onSubmit={demo.start}
    />
  );
}

function TryCreate() {
  const demo = useTryIt({});
  if (demo.done) {
    return <SaveRecoveryKeyScreen email={EMAIL} recoveryKey={SAMPLE_KEY} />;
  }
  return (
    <CreatePassphraseScreen
      email={EMAIL}
      progress={demo.progress}
      pending={demo.pending}
      opened={demo.opened}
      onSubmit={demo.start}
    />
  );
}

function TryRecovery() {
  const demo = useTryIt({});
  if (demo.done) return <SettingsMock />;
  return (
    <RecoveryScreen
      email={EMAIL}
      progress={demo.progress}
      pending={demo.pending}
      opened={demo.opened}
      onSubmit={demo.start}
      backHref="/design/encryption?screen=unlock-try"
    />
  );
}

function SettingsMock({ dialog }: { dialog?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <KeyworthMark />
            Keyworth
          </span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ButtonLink
              href="/design/encryption?screen=settings"
              variant="ghost"
              size="sm"
              icon={<Settings aria-hidden="true" />}
            >
              Settings
            </ButtonLink>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <Section
          title="Account"
          description={`Signed in with Google as ${EMAIL}.`}
        >
          <Button icon={<LogOut aria-hidden="true" />}>Sign out</Button>
        </Section>
        <SignOutEverywhereSection />
        <PassphraseSection />
        <RecoveryKeySection />
        <LockSection remembered />
        <BaseCurrencySection value="USD" />
        <Section title="Theme" description="Saved on this device.">
          <ThemeToggle showLabels />
        </Section>
        <DeleteAccountMock />
      </main>
      {dialog}
    </div>
  );
}

const SCREENS: { id: string; label: string; render: () => ReactNode }[] = [
  {
    id: "explainer",
    label: "0. Onboarding: only you can read your portfolio",
    render: () => <ExplainerScreen email={EMAIL} />,
  },
  {
    id: "explainer-still",
    label: "0a. … with reduced motion",
    render: () => <ExplainerScreen email={EMAIL} still />,
  },
  {
    id: "create",
    label: "1. Onboarding: create passphrase",
    render: () => <CreatePassphraseScreen email={EMAIL} />,
  },
  {
    id: "create-not-latin",
    label: "1a. … not Latin",
    render: () => (
      <CreatePassphraseScreen
        email={EMAIL}
        problem="not-latin"
        defaultPassphrase="фиолетовый слон"
      />
    ),
  },
  {
    id: "create-pending",
    label: "1b. … encrypting",
    render: () => <CreatePassphraseScreen email={EMAIL} pending />,
  },
  {
    id: "create-try",
    label: "1c. … try it: real Argon2",
    render: () => <TryCreate />,
  },
  {
    id: "save-key",
    label: "2. Onboarding: save recovery key",
    render: () => (
      <SaveRecoveryKeyScreen email={EMAIL} recoveryKey={SAMPLE_KEY} />
    ),
  },
  {
    id: "unlock",
    label: "3. Unlock",
    render: () => (
      <UnlockScreen
        email={EMAIL}
        recoveryHref="/design/encryption?screen=recovery"
      />
    ),
  },
  {
    id: "unlock-wrong",
    label: "3a. … wrong passphrase",
    render: () => (
      <UnlockScreen
        email={EMAIL}
        problem="wrong"
        defaultPassphrase="purple elephant"
      />
    ),
  },
  {
    id: "unlock-not-latin",
    label: "3b. … not Latin",
    render: () => (
      <UnlockScreen
        email={EMAIL}
        problem="not-latin"
        defaultPassphrase="фиолетовый слон танцует"
      />
    ),
  },
  {
    id: "unlock-auto-locked",
    label: "3c. … locked after inactivity",
    render: () => <UnlockScreen email={EMAIL} autoLocked />,
  },
  {
    id: "unlock-pending",
    label: "3d. … unlocking",
    render: () => <UnlockScreen email={EMAIL} pending />,
  },
  {
    id: "unlock-try",
    label: "3e. … try it: real Argon2",
    render: () => <TryUnlock />,
  },
  {
    id: "unlock-try-slow",
    label: "3f. … try it: Argon2 four times longer",
    render: () => <TryUnlock slow />,
  },
  {
    id: "unlock-try-wrong",
    label: "3g. … try it: a wrong passphrase",
    render: () => <TryUnlock refuse />,
  },
  {
    id: "recovery-sign-in",
    label: "4. Recovery: sign in again",
    render: () => (
      <RecoveryScreen
        email={EMAIL}
        needsSignIn
        backHref="/design/encryption?screen=unlock"
      />
    ),
  },
  {
    id: "recovery",
    label: "4a. Recovery: key and new passphrase",
    render: () => (
      <RecoveryScreen
        email={EMAIL}
        backHref="/design/encryption?screen=unlock"
        deleteAccount={<Button>Delete account</Button>}
      />
    ),
  },
  {
    id: "recovery-typo",
    label: "4b. … typo in the key",
    render: () => (
      <RecoveryScreen
        email={EMAIL}
        problem="typo"
        deleteAccount={<Button>Delete account</Button>}
        // The sample with its last character mistyped.
        defaultRecoveryKey={`${SAMPLE_KEY.slice(0, -1)}M`}
        backHref="/design/encryption?screen=unlock"
      />
    ),
  },
  {
    id: "recovery-try",
    label: "4c. … try it: real Argon2",
    render: () => <TryRecovery />,
  },
  {
    id: "settings",
    label: "5. Settings",
    render: () => <SettingsMock />,
  },
  {
    id: "change-passphrase",
    label: "5a. Change passphrase",
    render: () => <SettingsMock dialog={<ChangePassphraseDialog isOpen />} />,
  },
  {
    id: "change-passphrase-sign-in",
    label: "5b. … sign in again first",
    render: () => (
      <SettingsMock dialog={<ChangePassphraseDialog isOpen needsSignIn />} />
    ),
  },
  {
    id: "new-key",
    label: "5c. New recovery key: passphrase",
    render: () => (
      <SettingsMock
        dialog={
          <NewRecoveryKeyDialog isOpen step="confirm" recoveryKey={null} />
        }
      />
    ),
  },
  {
    id: "new-key-save",
    label: "5d. New recovery key: save it",
    render: () => (
      <SettingsMock
        dialog={
          <NewRecoveryKeyDialog isOpen step="save" recoveryKey={SAMPLE_KEY} />
        }
      />
    ),
  },
  {
    id: "new-key-sign-in",
    label: "5e. New recovery key: sign in again first",
    render: () => (
      <SettingsMock
        dialog={
          <NewRecoveryKeyDialog isOpen step="sign-in" recoveryKey={null} />
        }
      />
    ),
  },
  {
    id: "https",
    label: "6. Not on HTTPS",
    render: () => <NeedsHttpsScreen />,
  },
  {
    id: "unavailable",
    label: "7. Keys couldn't load",
    render: () => <KeysUnavailableScreen email={EMAIL} />,
  },
];

export default function EncryptionMockupsPage() {
  const params = new URLSearchParams(window.location.search);
  const [screenId, setScreenId] = useState(params.get("screen") ?? "create");
  const [run, setRun] = useState(0);
  const screen = SCREENS.find((entry) => entry.id === screenId) ?? SCREENS[0];
  return (
    <>
      <Fragment key={`${screenId}:${String(run)}`}>{screen?.render()}</Fragment>
      {!params.has("bare") && (
        <div className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-lg border border-line bg-raised p-2 shadow-raised">
          <label className="sr-only" htmlFor="mockup-screen">
            Screen
          </label>
          <select
            id="mockup-screen"
            value={screen?.id}
            onChange={(event) => {
              setScreenId(event.target.value);
              const url = new URL(window.location.href);
              url.searchParams.set("screen", event.target.value);
              window.history.replaceState(null, "", url);
            }}
            className="h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-fg"
          >
            {SCREENS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw aria-hidden="true" />}
            onPress={() => {
              setRun((count) => count + 1);
            }}
          >
            Replay
          </Button>
          <ThemeToggle />
        </div>
      )}
    </>
  );
}
