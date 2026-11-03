import { Button, PasswordField } from "../../ui/index.ts";
import type { KeyProgress } from "./key-progress.ts";
import { KeyScreen } from "./KeyScreen.tsx";
import {
  PASSPHRASE_HINT,
  type PassphraseProblem,
  passphraseMessage,
} from "./messages.ts";
import { formText } from "./form-text.ts";

/** Onboarding, step 1: the first thing a new user sees after Google. */
export function CreatePassphraseScreen({
  email,
  problem,
  pending = false,
  progress,
  opened = false,
  onSubmit,
  onEdit,
  onSignOut,
  signingOut = false,
  defaultPassphrase,
}: {
  email: string;
  problem?: PassphraseProblem | undefined;
  pending?: boolean;
  /** Argon2's progress while pending, for the ring around the mark. */
  progress?: KeyProgress | undefined;
  /** The keys are made: the lock turns, just before the recovery key shows. */
  opened?: boolean;
  onSubmit?: (passphrase: string) => void;
  /** The field changed: a shown problem no longer applies. */
  onEdit?: () => void;
  onSignOut?: () => void;
  signingOut?: boolean;
  /** For the design page's error states. */
  defaultPassphrase?: string;
}) {
  return (
    <KeyScreen
      step="Step 1 of 2"
      title="Create a passphrase"
      description="Keyworth encrypts your portfolio on this device before anything is saved. Your passphrase unlocks it. We never see it and can't reset it."
      email={email}
      signingOut={signingOut}
      working={pending}
      opened={opened}
      progress={progress}
      {...(onSignOut && { onSignOut })}
    >
      <form
        className="mt-8 flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || opened) return;
          onSubmit?.(formText(event.currentTarget, "passphrase"));
        }}
      >
        <PasswordField
          name="passphrase"
          label="Passphrase"
          autoFocus
          description={PASSPHRASE_HINT}
          isInvalid={problem !== undefined}
          isReadOnly={pending || opened}
          errorMessage={problem && passphraseMessage(problem)}
          {...(onEdit && { onChange: onEdit })}
          {...(defaultPassphrase !== undefined && {
            defaultValue: defaultPassphrase,
          })}
        />
        <Button
          type="submit"
          variant="primary"
          isPending={pending || opened}
          spinner={false}
        >
          {pending || opened ? "Encrypting…" : "Continue"}
        </Button>
      </form>
    </KeyScreen>
  );
}
