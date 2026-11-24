import { useSuspenseQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { Button, TextLink, ThemeToggle } from "../../ui/index.ts";
import { useVaultState } from "../../vault/index.ts";
import { sessionQuery } from "../auth/client.ts";
import { useSignOut } from "../auth/useSignOut.ts";
import { DeleteAllChats } from "../chat/DeleteAllChats.tsx";
import { DeleteAccount } from "./DeleteAccount.tsx";
import { SignOutEverywhereSection } from "./EncryptionSettings.tsx";
import {
  BaseCurrency,
  ChangePassphrase,
  LockNow,
  NewRecoveryKey,
} from "./ManageKeys.tsx";
import { Section } from "./Section.tsx";

/** What to open on arrival, after a fresh Google sign-in for it. */
export type SettingsAction =
  "delete-account" | "change-passphrase" | "new-recovery-key";

export function SettingsPage({ then }: { then?: SettingsAction | undefined }) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const state = useVaultState();
  const signOut = useSignOut();
  const everywhere = useSignOut();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <Section
        title="Account"
        description={`Signed in with Google as ${session?.user.email ?? ""}.`}
      >
        <Button
          icon={<LogOut aria-hidden="true" />}
          isPending={signOut.pending}
          onPress={() => void signOut.signOut()}
        >
          Sign out
        </Button>
      </Section>
      <SignOutEverywhereSection
        pending={everywhere.pending}
        onPress={() => void everywhere.signOut({ everywhere: true })}
      />
      <ChangePassphrase openAtStart={then === "change-passphrase"} />
      <NewRecoveryKey openAtStart={then === "new-recovery-key"} />
      <LockNow remembered={state.status === "unlocked" && state.remembered} />
      {session && <BaseCurrency userId={session.user.id} />}
      <Section title="Theme" description="Saved on this device.">
        <ThemeToggle showLabels />
      </Section>
      {session && (
        <Section
          title="Chats"
          description="Kept encrypted, so only you can read them. They stay until you delete them."
        >
          <DeleteAllChats userId={session.user.id} />
        </Section>
      )}
      <Section
        title="Delete account"
        description="Removes your account and everything stored with it."
      >
        <DeleteAccount reauthenticated={then === "delete-account"} />
      </Section>
      <p className="flex gap-4 text-sm">
        <TextLink href="/privacy">Privacy policy</TextLink>
        <TextLink href="/terms">Terms</TextLink>
      </p>
    </div>
  );
}
