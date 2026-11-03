import { Button } from "../../ui/index.ts";
import { EncryptionExplainer } from "./EncryptionExplainer.tsx";
import { KeyScreen } from "./KeyScreen.tsx";

/**
 * Onboarding, step 1: why only the user can read their portfolio, before
 * they choose a passphrase. They step through it at their own pace; Continue
 * works at once, nobody has to.
 */
export function ExplainerScreen({
  email,
  onContinue,
  onSignOut,
  signingOut = false,
  still,
}: {
  email: string;
  onContinue?: () => void;
  onSignOut?: () => void;
  signingOut?: boolean;
  /** No motion regardless of the user's setting (the design page). */
  still?: boolean;
}) {
  return (
    <KeyScreen
      step="Step 1 of 3"
      title="Only you can read your portfolio"
      description="Here's why, in six quick steps."
      email={email}
      signingOut={signingOut}
      {...(onSignOut && { onSignOut })}
    >
      <EncryptionExplainer
        className="mt-8"
        {...(still !== undefined && { still })}
      />
      <Button
        variant="primary"
        className="mt-8 w-full"
        {...(onContinue && { onPress: onContinue })}
      >
        Continue
      </Button>
    </KeyScreen>
  );
}
