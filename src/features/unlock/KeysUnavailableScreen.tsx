import { Button } from "../../ui/index.ts";
import { KeyScreen } from "./KeyScreen.tsx";

/** The keys could not be loaded: offline, or the server is down. Nothing is lost. */
export function KeysUnavailableScreen({
  email,
  retrying = false,
  onRetry,
  onSignOut,
  signingOut = false,
}: {
  email: string;
  retrying?: boolean;
  onRetry?: () => void;
  onSignOut?: () => void;
  signingOut?: boolean;
}) {
  return (
    <KeyScreen
      title="Couldn't load your keys"
      description="Keyworth needs a connection to open your data. Check it and try again."
      email={email}
      signingOut={signingOut}
      {...(onSignOut && { onSignOut })}
    >
      <Button
        variant="primary"
        className="mt-8 w-full"
        isPending={retrying}
        {...(onRetry && { onPress: onRetry })}
      >
        Try again
      </Button>
    </KeyScreen>
  );
}
