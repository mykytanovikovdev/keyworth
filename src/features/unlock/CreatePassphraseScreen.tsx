import { Button, PasswordField } from "../../ui/index.ts";
import { KeyScreen } from "./KeyScreen.tsx";
import { messages, PASSPHRASE_HINT } from "./messages.ts";

/** Onboarding, step 1: the first thing a new user sees after Google. */
export function CreatePassphraseScreen({
  email,
  problem,
  pending = false,
}: {
  email: string;
  problem?: "not-latin" | "too-short" | undefined;
  pending?: boolean;
}) {
  return (
    <KeyScreen
      step="Step 1 of 2"
      title="Create a passphrase"
      description="Keyworth encrypts your portfolio on this device before anything is saved. Your passphrase unlocks it. We never see it and can't reset it."
      email={email}
    >
      <form
        className="mt-8 flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <PasswordField
          label="Passphrase"
          autoComplete="new-password"
          description={PASSPHRASE_HINT}
          isInvalid={problem !== undefined}
          errorMessage={
            problem === "not-latin" ? messages.notLatin : messages.tooShort
          }
          {...(problem && {
            defaultValue:
              problem === "not-latin" ? "фиолетовый слон" : "purple",
          })}
        />
        <Button type="submit" variant="primary" isPending={pending}>
          {pending ? "Encrypting…" : "Continue"}
        </Button>
      </form>
    </KeyScreen>
  );
}
