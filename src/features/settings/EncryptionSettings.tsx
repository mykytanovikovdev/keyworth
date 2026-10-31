import { Lock } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  PasswordField,
  Select,
  type SelectOption,
} from "../../ui/index.ts";
import { RecoveryKeyPanel } from "../unlock/RecoveryKeyPanel.tsx";
import { PASSPHRASE_HINT } from "../unlock/messages.ts";
import { Section } from "./Section.tsx";

/*
 * The encryption part of Settings (phase 3, step 3). Mockup: the sections and
 * dialogs as they will look; the actions are wired once the design is agreed.
 */

// The final list depends on the price source chosen in phase 4.
const BASE_CURRENCIES: readonly SelectOption[] = [
  { id: "USD", label: "US dollar (USD)" },
  { id: "EUR", label: "Euro (EUR)" },
  { id: "GBP", label: "British pound (GBP)" },
  { id: "CHF", label: "Swiss franc (CHF)" },
  { id: "JPY", label: "Japanese yen (JPY)" },
];

export function BaseCurrencySection() {
  return (
    <Section
      title="Base currency"
      description="Totals, gains and charts are shown in this currency. Saved encrypted, like your trades."
    >
      <Select
        label="Base currency"
        hideLabel
        options={BASE_CURRENCIES}
        defaultValue="USD"
      />
    </Section>
  );
}

export function PassphraseSection() {
  return (
    <Section title="Passphrase" description="Unlocks your data on each device.">
      <Button>Change passphrase</Button>
    </Section>
  );
}

export function RecoveryKeySection() {
  return (
    <Section
      title="Recovery key"
      description="Your way back in if you forget the passphrase. A new key replaces the old one."
    >
      <Button>Create new key</Button>
    </Section>
  );
}

export function LockSection({ remembered }: { remembered: boolean }) {
  return (
    <Section
      title="Lock"
      description={
        remembered
          ? "Locks Keyworth in every tab of this browser and forgets this device. You'll need your passphrase to open it again."
          : "Locks Keyworth in every tab of this browser. You'll need your passphrase to open it again."
      }
    >
      <Button icon={<Lock aria-hidden="true" />}>Lock now</Button>
    </Section>
  );
}

/** Same words as deleting the account: a fresh Google sign-in comes first. */
function SignInAgain({ action }: { action: string }) {
  return (
    <>
      <p className="mt-2 text-base text-fg-muted">
        For your security, sign in with Google again, then {action}. You&apos;ll
        come back to this step.
      </p>
      <DialogActions>
        <Button>Cancel</Button>
        <Button variant="primary">Sign in again</Button>
      </DialogActions>
    </>
  );
}

export function ChangePassphraseDialog({
  needsSignIn = false,
}: {
  needsSignIn?: boolean;
}) {
  return (
    <Dialog title="Change passphrase" isOpen>
      {needsSignIn ? (
        <SignInAgain action="change your passphrase" />
      ) : (
        <form
          className="mt-4 flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <PasswordField
            label="Current passphrase"
            autoComplete="current-password"
          />
          <PasswordField
            label="New passphrase"
            autoComplete="new-password"
            description={PASSPHRASE_HINT}
          />
          <Checkbox
            label="Sign out other devices"
            description="Other browsers will need to sign in and unlock with the new passphrase."
          />
          <DialogActions>
            <Button>Cancel</Button>
            <Button type="submit" variant="primary">
              Change passphrase
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}

export function NewRecoveryKeyDialog({
  step,
  recoveryKey,
}: {
  step: "confirm" | "save";
  recoveryKey: string;
}) {
  if (step === "save") {
    // No way to dismiss it by accident before the key is kept somewhere.
    return (
      <Dialog title="Save your new recovery key" role="alertdialog" isOpen>
        <p className="mt-2 text-base text-fg-muted">
          Your previous key no longer works. Keep this one offline or in a
          password manager.
        </p>
        <div className="mt-5">
          <RecoveryKeyPanel recoveryKey={recoveryKey} />
        </div>
        <DialogActions>
          <Button variant="primary">I&apos;ve saved it</Button>
        </DialogActions>
      </Dialog>
    );
  }
  return (
    <Dialog title="Create a new recovery key" isOpen>
      <form
        className="mt-2 flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <p className="text-base text-fg-muted">
          Enter your passphrase. The new key replaces your current one, which
          stops working.
        </p>
        <PasswordField label="Passphrase" autoComplete="current-password" />
        <DialogActions>
          <Button>Cancel</Button>
          <Button type="submit" variant="primary">
            Create key
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
