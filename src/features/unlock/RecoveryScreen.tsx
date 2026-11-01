import type { ReactNode } from "react";
import { Button, PasswordField, TextLink } from "../../ui/index.ts";
import { KeyScreen } from "./KeyScreen.tsx";
import {
  messages,
  PASSPHRASE_HINT,
  type PassphraseProblem,
  passphraseMessage,
} from "./messages.ts";
import { RecoveryKeyField } from "./RecoveryKeyField.tsx";
import { formText } from "./form-text.ts";

export type RecoveryKeyProblem = "typo" | "wrong" | "not-latin" | "shape";

const keyMessages: Record<RecoveryKeyProblem, string> = {
  typo: messages.recoveryTypo,
  wrong: messages.recoveryWrong,
  "not-latin": messages.notLatin,
  shape: messages.recoveryShape,
};

/**
 * A forgotten passphrase: the recovery key opens the data and a new passphrase
 * replaces the old one. Replacing a key needs a recent Google sign-in, so that
 * comes first, before anything is typed.
 */
export function RecoveryScreen({
  email,
  needsSignIn = false,
  problem,
  passphraseProblem,
  pending = false,
  signingIn = false,
  onSubmit,
  onEdit,
  onSignInAgain,
  onSignOut,
  signingOut = false,
  backHref = "/",
  defaultRecoveryKey,
  deleteAccount,
}: {
  email: string;
  needsSignIn?: boolean;
  /** What is wrong with the recovery key. */
  problem?: RecoveryKeyProblem | undefined;
  /** What is wrong with the new passphrase. */
  passphraseProblem?: PassphraseProblem | undefined;
  pending?: boolean;
  signingIn?: boolean;
  onSubmit?: (reset: { recoveryKey: string; newPassphrase: string }) => void;
  /** A field changed: shown problems no longer apply. */
  onEdit?: () => void;
  onSignInAgain?: () => void;
  onSignOut?: () => void;
  signingOut?: boolean;
  backHref?: string;
  /** For the design page's error states. */
  defaultRecoveryKey?: string;
  /** The way out for someone who lost the recovery key too: a delete button. */
  deleteAccount?: ReactNode;
}) {
  const back = (
    <p className="mt-5 text-sm text-fg-muted">
      Remembered it? <TextLink href={backHref}>Back to unlock</TextLink>
    </p>
  );
  if (needsSignIn) {
    return (
      <KeyScreen
        title="Use your recovery key"
        description="For your security, sign in with Google again first. You'll come back here to enter your recovery key and choose a new passphrase."
        email={email}
        signingOut={signingOut}
        {...(onSignOut && { onSignOut })}
      >
        <Button
          variant="primary"
          className="mt-8 w-full"
          isPending={signingIn}
          icon={<img src="/google-g.svg" alt="" className="size-4" />}
          {...(onSignInAgain && { onPress: onSignInAgain })}
        >
          Sign in again
        </Button>
        {back}
      </KeyScreen>
    );
  }
  return (
    <KeyScreen
      title="Use your recovery key"
      description="Enter the key you saved when you set up Keyworth, then choose a new passphrase. Your recovery key keeps working afterwards."
      email={email}
      signingOut={signingOut}
      {...(onSignOut && { onSignOut })}
    >
      <form
        className="mt-8 flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          onSubmit?.({
            recoveryKey: formText(event.currentTarget, "recoveryKey"),
            newPassphrase: formText(event.currentTarget, "newPassphrase"),
          });
        }}
      >
        <RecoveryKeyField
          name="recoveryKey"
          errorMessage={problem && keyMessages[problem]}
          isReadOnly={pending}
          {...(onEdit && { onChange: onEdit })}
          {...(defaultRecoveryKey !== undefined && {
            defaultValue: defaultRecoveryKey,
          })}
        />
        <PasswordField
          name="newPassphrase"
          label="New passphrase"
          description={PASSPHRASE_HINT}
          isInvalid={passphraseProblem !== undefined}
          errorMessage={
            passphraseProblem && passphraseMessage(passphraseProblem)
          }
          isReadOnly={pending}
          {...(onEdit && { onChange: onEdit })}
        />
        <Button type="submit" variant="primary" isPending={pending}>
          {pending ? "Unlocking…" : "Set new passphrase"}
        </Button>
      </form>
      {back}
      {deleteAccount && (
        <div className="mt-8 flex flex-col items-start gap-3">
          <p className="text-sm text-fg-muted">
            Lost your recovery key too? Nobody can open your data, Keyworth
            included. You can delete your account and start over.
          </p>
          {deleteAccount}
        </div>
      )}
    </KeyScreen>
  );
}
