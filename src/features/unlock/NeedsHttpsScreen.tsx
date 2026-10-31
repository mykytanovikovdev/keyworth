import { ButtonLink } from "../../ui/index.ts";
import { KeyScreen } from "./KeyScreen.tsx";

/** Browsers offer encryption only on secure pages; say so instead of failing later. */
export function NeedsHttpsScreen() {
  return (
    <KeyScreen
      title="Open Keyworth over HTTPS"
      description="Encryption only works on a secure connection, and this address isn't one. Open Keyworth at its usual address instead."
    >
      <ButtonLink
        href="https://keyworth.app"
        variant="primary"
        className="mt-8 w-full"
      >
        Go to keyworth.app
      </ButtonLink>
    </KeyScreen>
  );
}
