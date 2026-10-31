import { Button, PasswordField, TextLink } from "../../ui/index.ts";
import { KeyScreen } from "./KeyScreen.tsx";
import { messages, PASSPHRASE_HINT } from "./messages.ts";
import { RecoveryKeyField } from "./RecoveryKeyField.tsx";

/**
 * A forgotten passphrase: the recovery key opens the data and a new passphrase
 * replaces the old one. Replacing a key needs a recent Google sign-in, so that
 * comes first, before anything is typed.
 */
export function RecoveryScreen({
  email,
  needsSignIn = false,
  problem,
  pending = false,
}: {
  email: string;
  needsSignIn?: boolean;
  problem?: "typo" | "wrong" | "not-latin" | undefined;
  pending?: boolean;
}) {
  const back = (
    <p className="mt-5 text-sm text-fg-muted">
      Remembered it?{" "}
      <TextLink href="/design/encryption?screen=unlock">
        Back to unlock
      </TextLink>
    </p>
  );
  if (needsSignIn) {
    return (
      <KeyScreen
        title="Use your recovery key"
        description="For your security, sign in with Google again first. You'll come back here to enter your recovery key and choose a new passphrase."
        email={email}
      >
        <Button
          variant="primary"
          className="mt-8 w-full"
          icon={<img src="/google-g.svg" alt="" className="size-4" />}
        >
          Sign in again
        </Button>
        {back}
      </KeyScreen>
    );
  }
  const keyError =
    problem === "typo"
      ? messages.recoveryTypo
      : problem === "wrong"
        ? messages.recoveryWrong
        : messages.notLatin;
  return (
    <KeyScreen
      title="Use your recovery key"
      description="Enter the key you saved when you set up Keyworth, then choose a new passphrase. Your recovery key keeps working afterwards."
      email={email}
    >
      <form
        className="mt-8 flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <RecoveryKeyField
          errorMessage={problem && keyError}
          {...(problem && {
            defaultValue: "810M-4GT4-8N34-EJ29-995M-RKAE-9X85-2MJK-99VM",
          })}
        />
        <PasswordField
          label="New passphrase"
          autoComplete="new-password"
          description={PASSPHRASE_HINT}
        />
        <Button type="submit" variant="primary" isPending={pending}>
          {pending ? "Unlocking…" : "Set new passphrase"}
        </Button>
      </form>
      {back}
    </KeyScreen>
  );
}
