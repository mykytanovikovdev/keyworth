import { LogOut, Settings } from "lucide-react";
import { useState, type ReactNode } from "react";
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
import { KeysUnavailableScreen } from "../features/unlock/KeysUnavailableScreen.tsx";
import { NeedsHttpsScreen } from "../features/unlock/NeedsHttpsScreen.tsx";
import { RecoveryScreen } from "../features/unlock/RecoveryScreen.tsx";
import { SaveRecoveryKeyScreen } from "../features/unlock/SaveRecoveryKeyScreen.tsx";
import { UnlockScreen } from "../features/unlock/UnlockScreen.tsx";
import { Button, ButtonLink, KeyworthMark, ThemeToggle } from "../ui/index.ts";

/*
 * Mockups of the phase 3.3 screens, for review before they are wired up
 * (dev and design builds only). `?screen=<id>` opens one; `&bare` hides the
 * switcher, for screenshots.
 */

const EMAIL = "alex@example.com";
// A sample to show the layout (the test vector of bytes 40..53), not a credential.
const SAMPLE_KEY = "810M-4GT4-8N34-EJ29-995M-RKAE-9X85-2MJK-99VN"; // gitleaks:allow

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
  const screen = SCREENS.find((entry) => entry.id === screenId) ?? SCREENS[0];
  return (
    <>
      {screen?.render()}
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
          <ThemeToggle />
        </div>
      )}
    </>
  );
}
