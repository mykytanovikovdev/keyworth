import { Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { checkPassphrase, CryptoError } from "../../crypto/index.ts";
import { showToast } from "../../ui/index.ts";
import { ApiError, vault } from "../../vault/index.ts";
import { useSignOut } from "../auth/useSignOut.ts";
import { DeleteAccount } from "../settings/DeleteAccount.tsx";
import { hasFreshSignIn, signInAgain } from "./fresh-sign-in.ts";
import { KeyProgress } from "./key-progress.ts";
import { KeysUnavailableScreen } from "./KeysUnavailableScreen.tsx";
import { failureMessage, type PassphraseProblem } from "./messages.ts";
import { NeedsHttpsScreen } from "./NeedsHttpsScreen.tsx";
import { type RecoveryKeyProblem, RecoveryScreen } from "./RecoveryScreen.tsx";
import { useFinale } from "./useFinale.ts";
import { useStartedVault } from "./useStartedVault.ts";

const keyProblems: Partial<Record<string, RecoveryKeyProblem>> = {
  "not-latin": "not-latin",
  mistyped: "typo",
  "invalid-input": "shape",
  "wrong-secret": "wrong",
};

function Recover({
  email,
  onSignOut,
  signingOut,
  opened,
  hold,
}: {
  email: string;
  onSignOut: () => void;
  signingOut: boolean;
  /** The data is open: the keyhole turns before the app. */
  opened: boolean;
  /** Keep this screen through the finale if the data opens. */
  hold: (holding: boolean) => void;
}) {
  const [fresh, setFresh] = useState<boolean>();
  const [problem, setProblem] = useState<RecoveryKeyProblem>();
  const [passphraseProblem, setPassphraseProblem] =
    useState<PassphraseProblem>();
  const [pending, setPending] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [progress] = useState(() => new KeyProgress());

  useEffect(() => {
    hasFreshSignIn().then(setFresh, () => {
      // Unknown: let the user type; the server still decides.
      setFresh(true);
    });
  }, []);

  if (fresh === undefined) return <div className="min-h-dvh" />;
  return (
    <RecoveryScreen
      email={email}
      onSignOut={onSignOut}
      needsSignIn={!fresh}
      problem={problem}
      passphraseProblem={passphraseProblem}
      pending={pending}
      progress={progress}
      opened={opened}
      signingIn={signingIn}
      signingOut={signingOut}
      onEdit={() => {
        setProblem(undefined);
        setPassphraseProblem(undefined);
      }}
      // Shown once the sign-in is fresh, which deleting needs as well.
      deleteAccount={
        <DeleteAccount reauthenticated={false} returnTo="/recover" />
      }
      onSignInAgain={() => {
        setSigningIn(true);
        signInAgain("/recover").catch(() => {
          setSigningIn(false);
          showToast("Couldn't reach Google", { tone: "error" });
        });
      }}
      onSubmit={({ recoveryKey, newPassphrase }) => {
        // Checked first, so a refusal from resetPassphrase is about the key.
        const found = checkPassphrase(newPassphrase);
        if (found) {
          setPassphraseProblem(found);
          return;
        }
        setPending(true);
        hold(true);
        vault.resetPassphrase(recoveryKey, newPassphrase, progress.report).then(
          () => {
            showToast("New passphrase set", { tone: "success" });
          },
          (error: unknown) => {
            setPending(false);
            hold(false);
            if (error instanceof CryptoError) {
              setProblem(keyProblems[error.code] ?? "wrong");
              return;
            }
            if (
              error instanceof ApiError &&
              error.code === "session_not_fresh"
            ) {
              setFresh(false);
              return;
            }
            const { title, description } = failureMessage(error);
            showToast(title, { tone: "error", description });
          },
        );
      }}
    />
  );
}

/**
 * `/recover`: a forgotten passphrase. Outside the key gate, since the user is
 * locked out; once the reset unlocks the data, on to the app.
 */
export function RecoverPage() {
  const { state, email } = useStartedVault();
  const { signOut, pending } = useSignOut();
  const { opening, hold } = useFinale<true>(state.status === "unlocked");
  const recover = (opened: boolean) => (
    <Recover
      email={email}
      onSignOut={() => void signOut()}
      signingOut={pending}
      opened={opened}
      hold={(holding) => {
        hold(holding || null);
      }}
    />
  );
  switch (state.status) {
    case "starting":
      return <div className="min-h-dvh" />;
    case "insecure":
      return <NeedsHttpsScreen />;
    case "failed":
      return (
        <KeysUnavailableScreen
          email={email}
          onRetry={() => void vault.retry()}
          onSignOut={() => void signOut()}
          signingOut={pending}
        />
      );
    case "no-keys":
      return <Navigate to="/" replace />;
    case "unlocked":
      // The same element as when locked, kept up while its keyhole turns.
      return opening ? recover(true) : <Navigate to="/" replace />;
    case "locked":
      return recover(false);
  }
}
