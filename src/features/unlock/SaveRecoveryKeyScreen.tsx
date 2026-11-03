import { Button } from "../../ui/index.ts";
import { KeyScreen } from "./KeyScreen.tsx";
import { RecoveryKeyPanel } from "./RecoveryKeyPanel.tsx";

/** Onboarding, step 3: shown only after the server stored the keys. */
export function SaveRecoveryKeyScreen({
  email,
  recoveryKey,
  onSaved,
  onSignOut,
  signingOut = false,
}: {
  email: string;
  recoveryKey: string;
  onSaved?: () => void;
  onSignOut?: () => void;
  signingOut?: boolean;
}) {
  return (
    <KeyScreen
      step="Step 3 of 3"
      title="Save your recovery key"
      description="If you forget your passphrase, this key is the only way back to your data. Nobody else can recover it, Keyworth included."
      email={email}
      signingOut={signingOut}
      {...(onSignOut && { onSignOut })}
    >
      <div className="mt-8 flex flex-col gap-6">
        <RecoveryKeyPanel recoveryKey={recoveryKey} />
        <p className="text-sm text-fg-muted">
          Keep it offline or in a password manager, not next to your passphrase.
          You can create a new one in Settings at any time.
        </p>
        <Button variant="primary" {...(onSaved && { onPress: onSaved })}>
          I&apos;ve saved it
        </Button>
      </div>
    </KeyScreen>
  );
}
