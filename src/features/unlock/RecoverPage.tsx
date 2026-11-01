import { Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { checkPassphrase, CryptoError } from "../../crypto/index.ts";
import { showToast } from "../../ui/index.ts";
import { ApiError, vault } from "../../vault/index.ts";
import { useSignOut } from "../auth/useSignOut.ts";
import { DeleteAccount } from "../settings/DeleteAccount.tsx";
import { hasFreshSignIn, signInAgain } from "./fresh-sign-in.ts";
import { KeysUnavailableScreen } from "./KeysUnavailableScreen.tsx";
import { failureMessage, type PassphraseProblem } from "./messages.ts";
import { NeedsHttpsScreen } from "./NeedsHttpsScreen.tsx";
import { type RecoveryKeyProblem, RecoveryScreen } from "./RecoveryScreen.tsx";
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
}: {
  email: string;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const [fresh, setFresh] = useState<boolean>();
  const [problem, setProblem] = useState<RecoveryKeyProblem>();
  const [passphraseProblem, setPassphraseProblem] =
    useState<PassphraseProblem>();
  const [pending, setPending] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

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
        vault.resetPassphrase(recoveryKey, newPassphrase).then(
          () => {
            showToast("New passphrase set", { tone: "success" });
          },
          (error: unknown) => {
            setPending(false);
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
    case "unlocked":
      return <Navigate to="/" replace />;
    case "locked":
      return (
        <Recover
          email={email}
          onSignOut={() => void signOut()}
          signingOut={pending}
        />
      );
  }
}
