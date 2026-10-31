import {
  Button,
  Checkbox,
  Notice,
  PasswordField,
  TextLink,
} from "../../ui/index.ts";
import { KeyScreen } from "./KeyScreen.tsx";
import { messages } from "./messages.ts";

/** A returning user whose data is locked: every new browser session, and after Lock. */
export function UnlockScreen({
  email,
  problem,
  pending = false,
  autoLocked = false,
}: {
  email: string;
  problem?: "wrong" | "not-latin" | undefined;
  pending?: boolean;
  /** Locked after 15 minutes without activity, rather than opened fresh. */
  autoLocked?: boolean;
}) {
  return (
    <KeyScreen
      title="Unlock Keyworth"
      description="Enter your passphrase to decrypt your portfolio on this device."
      email={email}
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
        }}
      >
        <PasswordField
          label="Passphrase"
          autoComplete="current-password"
          isInvalid={problem !== undefined}
          errorMessage={
            problem === "not-latin"
              ? messages.notLatin
              : messages.wrongPassphrase
          }
          {...(problem && {
            defaultValue:
              problem === "not-latin"
                ? "фиолетовый слон танцует"
                : "purple elephant",
          })}
        />
        <Checkbox
          label="Remember this device"
          description="Stay unlocked in this browser until you lock Keyworth, sign out or close the browser. Browsers that reopen your tabs may keep it longer. Only on a device you don't share."
        />
        <Button type="submit" variant="primary" isPending={pending}>
          {pending ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
      <p className="mt-5 text-sm text-fg-muted">
        Forgot your passphrase?{" "}
        <TextLink href="/design/encryption?screen=recovery">
          Use your recovery key
        </TextLink>
      </p>
    </KeyScreen>
  );
}
