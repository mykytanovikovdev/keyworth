import { useEffect, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  hasFinePointer,
  Notice,
  PasswordField,
  TextLink,
} from "../../ui/index.ts";
import type { KeyProgress } from "./key-progress.ts";
import { KeyScreen } from "./KeyScreen.tsx";
import { messages } from "./messages.ts";
import { formText } from "./form-text.ts";

/** A returning user whose data is locked: every new browser session, and after Lock. */
export function UnlockScreen({
  email,
  problem,
  pending = false,
  progress,
  opened = false,
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
  /** Argon2's progress while pending, for the ring around the mark. */
  progress?: KeyProgress | undefined;
  /** The passphrase opened the data: the lock turns, just before the app shows. */
  opened?: boolean;
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
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // Refused: straight back to typing, where a keyboard does not need to open.
    if (!problem || !hasFinePointer()) return;
    const field = form.current?.elements.namedItem("passphrase");
    if (field instanceof HTMLInputElement) field.focus();
  }, [problem]);
  return (
    <KeyScreen
      title="Unlock Keyworth"
      description="Enter your passphrase to decrypt your portfolio on this device."
      email={email}
      signingOut={signingOut}
      working={pending}
      opened={opened}
      refused={problem !== undefined}
      progress={progress}
      {...(onSignOut && { onSignOut })}
    >
      {autoLocked && (
        <Notice tone="info" className="mt-6">
          Locked after 15 minutes without activity.
        </Notice>
      )}
      <form
        ref={form}
        className="mt-8 flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || opened) return;
          onSubmit?.({
            passphrase: formText(event.currentTarget, "passphrase"),
            remember,
          });
        }}
      >
        <PasswordField
          name="passphrase"
          label="Passphrase"
          autoFocus
          isInvalid={problem !== undefined}
          isReadOnly={pending || opened}
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
          isReadOnly={pending || opened}
        />
        <Button
          type="submit"
          variant="primary"
          isPending={pending || opened}
          spinner={false}
        >
          {pending || opened ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
      <p className="mt-5 text-sm text-fg-muted">
        Forgot your passphrase?{" "}
        <TextLink href={recoveryHref}>Use your recovery key</TextLink>
      </p>
    </KeyScreen>
  );
}
