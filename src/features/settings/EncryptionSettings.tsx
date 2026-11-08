import { Lock, LogOut } from "lucide-react";
import { useState } from "react";
import { FIAT_CURRENCIES } from "../../../shared/schemas/currencies.ts";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  hasFinePointer,
  ComboBox,
  type ComboBoxOption,
  PasswordField,
} from "../../ui/index.ts";
import {
  messages,
  PASSPHRASE_HINT,
  type PassphraseProblem,
  passphraseMessage,
} from "../unlock/messages.ts";
import { RecoveryKeyPanel } from "../unlock/RecoveryKeyPanel.tsx";
import { Section } from "./Section.tsx";
import { formText } from "../unlock/form-text.ts";

/*
 * The encryption part of Settings: how the sections and dialogs look in every
 * state. They take their state as props; ManageKeys.tsx wires them to the
 * vault, and /design/encryption shows each state.
 */

// Every currency with a central bank's rate, by name; typing finds one by its
// name or its code ("lari", "GEL").
const BASE_CURRENCIES: readonly ComboBoxOption[] = [...FIAT_CURRENCIES]
  .sort(([, a], [, b]) => a.localeCompare(b, "en"))
  .map(([code, name]) => ({ id: code, label: name, detail: code }));

export function SignOutEverywhereSection({
  pending = false,
  onPress,
}: {
  pending?: boolean;
  onPress?: () => void;
}) {
  return (
    <Section
      title="Sign out everywhere"
      description="Signs out every browser, this one included, and forgets every remembered device."
    >
      <Button
        icon={<LogOut aria-hidden="true" />}
        isPending={pending}
        {...(onPress && { onPress })}
      >
        Sign out everywhere
      </Button>
    </Section>
  );
}

export function BaseCurrencySection({
  value,
  onChange,
  isDisabled = false,
}: {
  value: string;
  onChange?: (currency: string) => void;
  isDisabled?: boolean;
}) {
  return (
    <Section
      title="Base currency"
      description="Totals, gains and charts are shown in this currency. Saved encrypted, like your trades."
    >
      <ComboBox
        label="Base currency"
        hideLabel
        placeholder="Search currencies"
        options={BASE_CURRENCIES}
        value={value}
        isDisabled={isDisabled}
        emptyMessage="No currency matches."
        className="w-full sm:w-64"
        onChange={(currency) => {
          if (currency) onChange?.(currency);
        }}
      />
    </Section>
  );
}

export function PassphraseSection({
  pending = false,
  onPress,
}: {
  /** Checking whether a fresh sign-in is needed first. */
  pending?: boolean;
  onPress?: () => void;
}) {
  return (
    <Section title="Passphrase" description="Unlocks your data on each device.">
      <Button isPending={pending} {...(onPress && { onPress })}>
        Change passphrase
      </Button>
    </Section>
  );
}

export function RecoveryKeySection({
  pending = false,
  onPress,
}: {
  pending?: boolean;
  onPress?: () => void;
}) {
  return (
    <Section
      title="Recovery key"
      description="Your way back in if you forget the passphrase. A new key replaces the old one."
    >
      <Button isPending={pending} {...(onPress && { onPress })}>
        Create new key
      </Button>
    </Section>
  );
}

export function LockSection({
  remembered,
  pending = false,
  onLock,
}: {
  remembered: boolean;
  pending?: boolean;
  onLock?: () => void;
}) {
  return (
    <Section
      title="Lock"
      description={
        remembered
          ? "Locks Keyworth in every tab of this browser and forgets this device. You'll need your passphrase to open it again."
          : "Locks Keyworth in every tab of this browser. You'll need your passphrase to open it again."
      }
    >
      <Button
        icon={<Lock aria-hidden="true" />}
        isPending={pending}
        {...(onLock && { onPress: onLock })}
      >
        Lock now
      </Button>
    </Section>
  );
}

/** Same words as deleting the account: a fresh Google sign-in comes first. */
function SignInAgain({
  action,
  signingIn,
  onCancel,
  onSignIn,
}: {
  action: string;
  signingIn: boolean;
  onCancel: () => void;
  onSignIn?: (() => void) | undefined;
}) {
  return (
    <>
      <p className="mt-2 text-base text-fg-muted">
        For your security, sign in with Google again, then {action}. You&apos;ll
        come back to this step.
      </p>
      <DialogActions>
        <Button onPress={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          isPending={signingIn}
          {...(onSignIn && { onPress: onSignIn })}
        >
          Sign in again
        </Button>
      </DialogActions>
    </>
  );
}

interface DialogState {
  isOpen: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  pending?: boolean;
  signingIn?: boolean;
  onSignInAgain?: () => void;
  /** A field changed: shown problems no longer apply. */
  onEdit?: () => void;
}

export function ChangePassphraseDialog({
  isOpen,
  onOpenChange,
  needsSignIn = false,
  pending = false,
  signingIn = false,
  onSignInAgain,
  currentProblem,
  newProblem,
  onSubmit,
  onEdit,
}: DialogState & {
  needsSignIn?: boolean;
  currentProblem?: "wrong" | "not-latin" | undefined;
  newProblem?: PassphraseProblem | undefined;
  onSubmit?: (change: {
    currentPassphrase: string;
    newPassphrase: string;
    signOutOthers: boolean;
  }) => void;
}) {
  const [signOutOthers, setSignOutOthers] = useState(false);
  const close = () => onOpenChange?.(false);
  return (
    <Dialog
      title="Change passphrase"
      isOpen={isOpen}
      {...(onOpenChange && { onOpenChange })}
    >
      {needsSignIn ? (
        <SignInAgain
          action="change your passphrase"
          signingIn={signingIn}
          onCancel={close}
          onSignIn={onSignInAgain}
        />
      ) : (
        <form
          className="mt-4 flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            onSubmit?.({
              currentPassphrase: formText(
                event.currentTarget,
                "currentPassphrase",
              ),
              newPassphrase: formText(event.currentTarget, "newPassphrase"),
              signOutOthers,
            });
          }}
        >
          <PasswordField
            name="currentPassphrase"
            label="Current passphrase"
            autoFocus={hasFinePointer()}
            isInvalid={currentProblem !== undefined}
            errorMessage={
              currentProblem === "not-latin"
                ? messages.notLatin
                : messages.wrongPassphrase
            }
            isReadOnly={pending}
            {...(onEdit && { onChange: onEdit })}
          />
          <PasswordField
            name="newPassphrase"
            label="New passphrase"
            description={PASSPHRASE_HINT}
            isInvalid={newProblem !== undefined}
            errorMessage={newProblem && passphraseMessage(newProblem)}
            isReadOnly={pending}
            {...(onEdit && { onChange: onEdit })}
          />
          <Checkbox
            label="Sign out other devices"
            description="Other browsers will need to sign in and unlock with the new passphrase."
            isSelected={signOutOthers}
            onChange={setSignOutOthers}
            isReadOnly={pending}
          />
          <DialogActions>
            <Button onPress={close} isDisabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isPending={pending}>
              Change passphrase
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}

export function NewRecoveryKeyDialog({
  isOpen,
  onOpenChange,
  step,
  recoveryKey,
  pending = false,
  signingIn = false,
  onSignInAgain,
  problem,
  onSubmit,
  onEdit,
  onSaved,
}: DialogState & {
  step: "sign-in" | "confirm" | "save";
  recoveryKey: string | null;
  problem?: "wrong" | "not-latin" | undefined;
  onSubmit?: (passphrase: string) => void;
  onSaved?: () => void;
}) {
  const close = () => onOpenChange?.(false);
  if (step === "save" && recoveryKey) {
    // No way to dismiss it by accident before the key is kept somewhere.
    return (
      <Dialog
        title="Save your new recovery key"
        role="alertdialog"
        isOpen={isOpen}
      >
        <p className="mt-2 text-base text-fg-muted">
          Your previous key no longer works. Keep this one offline or in a
          password manager.
        </p>
        <div className="mt-5">
          <RecoveryKeyPanel recoveryKey={recoveryKey} />
        </div>
        <DialogActions>
          <Button variant="primary" {...(onSaved && { onPress: onSaved })}>
            I&apos;ve saved it
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
  return (
    <Dialog
      title="Create a new recovery key"
      isOpen={isOpen}
      {...(onOpenChange && { onOpenChange })}
    >
      {step === "sign-in" ? (
        <SignInAgain
          action="create a new recovery key"
          signingIn={signingIn}
          onCancel={close}
          onSignIn={onSignInAgain}
        />
      ) : (
        <form
          className="mt-2 flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            onSubmit?.(formText(event.currentTarget, "passphrase"));
          }}
        >
          <p className="text-base text-fg-muted">
            Enter your passphrase. The new key replaces your current one, which
            stops working.
          </p>
          <PasswordField
            name="passphrase"
            label="Passphrase"
            autoFocus={hasFinePointer()}
            isInvalid={problem !== undefined}
            errorMessage={
              problem === "not-latin"
                ? messages.notLatin
                : messages.wrongPassphrase
            }
            isReadOnly={pending}
            {...(onEdit && { onChange: onEdit })}
          />
          <DialogActions>
            <Button onPress={close} isDisabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isPending={pending}>
              Create key
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
