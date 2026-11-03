import { type ReactNode, useState } from "react";
import { CryptoError, checkPassphrase } from "../../crypto/index.ts";
import { showToast } from "../../ui/index.ts";
import { vault, VaultError } from "../../vault/index.ts";
import { useSignOut } from "../auth/useSignOut.ts";
import { CreatePassphraseScreen } from "./CreatePassphraseScreen.tsx";
import { KeyProgress } from "./key-progress.ts";
import { KeysUnavailableScreen } from "./KeysUnavailableScreen.tsx";
import { failureMessage, type PassphraseProblem } from "./messages.ts";
import { NeedsHttpsScreen } from "./NeedsHttpsScreen.tsx";
import { SaveRecoveryKeyScreen } from "./SaveRecoveryKeyScreen.tsx";
import { UnlockScreen } from "./UnlockScreen.tsx";
import { useFinale } from "./useFinale.ts";
import { useStartedVault } from "./useStartedVault.ts";

/*
 * Everything behind sign-in passes through here: no keys yet → onboarding,
 * locked → unlock, unlocked → the app (after the recovery key, right after
 * setup). The screens are in this folder; the state is src/vault.
 */

interface Account {
  email: string;
  onSignOut: () => void;
  signingOut: boolean;
}

/** A screen whose passphrase may open the data, and then shows the lock turning. */
interface Opening {
  /** The data is open: the keyhole turns before the next screen. */
  opened: boolean;
  /** Keep this screen through the finale if the data opens (true at submit, false on failure). */
  hold: (holding: boolean) => void;
}

function toast(error: unknown) {
  const { title, description } = failureMessage(error);
  showToast(title, { tone: "error", description });
}

function Onboarding({ opened, hold, ...account }: Account & Opening) {
  const [problem, setProblem] = useState<PassphraseProblem>();
  const [pending, setPending] = useState(false);
  const [progress] = useState(() => new KeyProgress());
  return (
    <CreatePassphraseScreen
      {...account}
      problem={problem}
      pending={pending}
      progress={progress}
      opened={opened}
      onEdit={() => {
        setProblem(undefined);
      }}
      onSubmit={(passphrase) => {
        const found = checkPassphrase(passphrase);
        if (found) {
          setProblem(found);
          return;
        }
        setPending(true);
        hold(true);
        vault
          .createKeys(passphrase, progress.report)
          .catch((error: unknown) => {
            setPending(false);
            hold(false);
            if (
              error instanceof VaultError &&
              error.code === "already-set-up"
            ) {
              showToast("Already set up", {
                description:
                  "Keyworth was set up in another tab or device. Unlock with that passphrase.",
              });
              return;
            }
            toast(error);
          });
      }}
    />
  );
}

function Unlock({
  idle,
  opened,
  hold,
  ...account
}: Account & Opening & { idle: boolean }) {
  const [problem, setProblem] = useState<"wrong" | "not-latin">();
  const [pending, setPending] = useState(false);
  const [progress] = useState(() => new KeyProgress());
  return (
    <UnlockScreen
      {...account}
      autoLocked={idle}
      problem={problem}
      pending={pending}
      progress={progress}
      opened={opened}
      onEdit={() => {
        setProblem(undefined);
      }}
      onSubmit={({ passphrase, remember }) => {
        setPending(true);
        hold(true);
        vault
          .unlock(passphrase, { remember, onProgress: progress.report })
          .then(
            ({ remembered }) => {
              if (remember && !remembered) {
                showToast("Couldn't remember this device", {
                  description:
                    "Keyworth is unlocked, and will ask for the passphrase next time.",
                });
              }
            },
            (error: unknown) => {
              setPending(false);
              hold(false);
              if (error instanceof CryptoError) {
                setProblem(error.code === "not-latin" ? "not-latin" : "wrong");
                return;
              }
              toast(error);
            },
          );
      }}
    />
  );
}

function KeysUnavailable(account: Account) {
  const [retrying, setRetrying] = useState(false);
  return (
    <KeysUnavailableScreen
      {...account}
      retrying={retrying}
      onRetry={() => {
        setRetrying(true);
        void vault.retry().finally(() => {
          setRetrying(false);
        });
      }}
    />
  );
}

/** The key screens for every state but unlocked; `children` once unlocked. */
export function VaultGate({ children }: { children: ReactNode }) {
  const { state, email } = useStartedVault();
  const { signOut, pending: signingOut } = useSignOut();
  // The screen that opened the data, kept up while its keyhole turns.
  const { opening, hold } = useFinale<
    { screen: "onboarding" } | { screen: "unlock"; idle: boolean }
  >(state.status === "unlocked");
  const account: Account = {
    email,
    signingOut,
    onSignOut: () => void signOut(),
  };
  const holdOnboarding = (holding: boolean) => {
    hold(holding ? { screen: "onboarding" } : null);
  };
  const holdUnlock = (idle: boolean) => (holding: boolean) => {
    hold(holding ? { screen: "unlock", idle } : null);
  };
  switch (state.status) {
    case "starting":
      // Usually a fraction of a second: an empty page rather than a flash.
      return <div className="min-h-dvh" />;
    case "insecure":
      return <NeedsHttpsScreen />;
    case "failed":
      return <KeysUnavailable {...account} />;
    case "no-keys":
      return <Onboarding {...account} opened={false} hold={holdOnboarding} />;
    case "locked":
      return (
        <Unlock
          {...account}
          idle={state.idle}
          opened={false}
          hold={holdUnlock(state.idle)}
        />
      );
    case "unlocked":
      // The same element types as above, so the screen stays mounted.
      if (opening?.screen === "onboarding") {
        return <Onboarding {...account} opened hold={holdOnboarding} />;
      }
      if (opening?.screen === "unlock") {
        return (
          <Unlock
            {...account}
            idle={opening.idle}
            opened
            hold={holdUnlock(opening.idle)}
          />
        );
      }
      return state.recoveryKey ? (
        <SaveRecoveryKeyScreen
          {...account}
          recoveryKey={state.recoveryKey}
          onSaved={() => {
            vault.recoveryKeySaved();
          }}
        />
      ) : (
        children
      );
  }
}
