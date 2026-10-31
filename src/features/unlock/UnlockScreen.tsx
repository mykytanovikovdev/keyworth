import { useState } from "react";
import {
  Button,
  Checkbox,
  Notice,
  PasswordField,
  TextLink,
} from "../../ui/index.ts";
import { KeyScreen } from "./KeyScreen.tsx";
import { messages } from "./messages.ts";
import { formText } from "./form-text.ts";

/** A returning user whose data is locked: every new browser session, and after Lock. */
export function UnlockScreen({
  email,
  problem,
  pending = false,
  autoLocked = false,
  onSubmit,
  onEdit,
  onSignOut,
  signingOut = false,
  recoveryHref = "/recover",
  defaultPassphrase,
}: {
  email: string;
  problem?: "wrong" | "not-latin" | undefined;
  pending?: boolean;
  /** Locked after 15 minutes without activity, rather than opened fresh. */
  autoLocked?: boolean;
  onSubmit?: (unlock: { passphrase: string; remember: boolean }) => void;
  /** The field changed: a shown problem no longer applies. */
  onEdit?: () => void;
  onSignOut?: () => void;
  signingOut?: boolean;
  recoveryHref?: string;
  /** For the design page's error states. */
  defaultPassphrase?: string;
}) {
  const [remember, setRemember] = useState(false);
  return (
    <KeyScreen
      title="Unlock Keyworth"
      description="Enter your passphrase to decrypt your portfolio on this device."
      email={email}
      signingOut={signingOut}
      {...(onSignOut && { onSignOut })}
    >
      {autoLocked && (
        <Notice tone="info" className="mt-6">
          Locked after 15 minutes without activity.
        </Notice>
      )}
      <form
        className="mt-8 flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          onSubmit?.({
            passphrase: formText(event.currentTarget, "passphrase"),
            remember,
          });
        }}
      >
        <PasswordField
          name="passphrase"
          label="Passphrase"
          autoComplete="current-password"
          autoFocus
          isInvalid={problem !== undefined}
          isReadOnly={pending}
          errorMessage={
            problem === "not-latin"
              ? messages.notLatin
              : messages.wrongPassphrase
          }
          {...(onEdit && { onChange: onEdit })}
          {...(defaultPassphrase !== undefined && {
            defaultValue: defaultPassphrase,
          })}
        />
        <Checkbox
          label="Remember this device"
          description="Stay unlocked in this browser until you close it, lock Keyworth or sign out, for up to 14 days. Browsers that reopen your tabs keep it after a restart. Only on a device you don't share."
          isSelected={remember}
          onChange={setRemember}
          isReadOnly={pending}
        />
        <Button type="submit" variant="primary" isPending={pending}>
          {pending ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
      <p className="mt-5 text-sm text-fg-muted">
        Forgot your passphrase?{" "}
        <TextLink href={recoveryHref}>Use your recovery key</TextLink>
      </p>
    </KeyScreen>
  );
}
