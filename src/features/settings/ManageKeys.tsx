import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DEFAULT_BASE_CURRENCY } from "../../../shared/schemas/settings.ts";
import { checkPassphrase, CryptoError } from "../../crypto/index.ts";
import { showToast } from "../../ui/index.ts";
import { ApiError, vault } from "../../vault/index.ts";
import { authClient } from "../auth/client.ts";
import { hasFreshSignIn, signInAgain } from "../unlock/fresh-sign-in.ts";
import { failureMessage, type PassphraseProblem } from "../unlock/messages.ts";
import {
  BaseCurrencySection,
  ChangePassphraseDialog,
  LockSection,
  NewRecoveryKeyDialog,
  PassphraseSection,
  RecoveryKeySection,
} from "./EncryptionSettings.tsx";
import { saveSettings, settingsQuery } from "./settings-record.ts";

/*
 * The encryption sections of Settings, wired to the vault. Changing the
 * passphrase or creating a recovery key asks the server first whether the
 * sign-in is recent enough, so a fresh Google sign-in comes before anything
 * secret is typed.
 */

function toast(error: unknown) {
  const { title, description } = failureMessage(error);
  showToast(title, { tone: "error", description });
}

/** "wrong" for a passphrase that cannot be right, without running Argon2. */
function currentPassphraseProblem(passphrase: string) {
  const problem = checkPassphrase(passphrase);
  if (problem === "not-latin") return "not-latin";
  return problem ? "wrong" : undefined;
}

/** Opens a dialog after asking whether a fresh sign-in comes first. */
function useFreshDialog(openAtStart: boolean) {
  const [isOpen, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  async function open() {
    setChecking(true);
    // Unknown (offline): let the user type; the server still decides.
    const fresh = await hasFreshSignIn().catch(() => true);
    setChecking(false);
    setNeedsSignIn(!fresh);
    setOpen(true);
  }

  // Back from the fresh sign-in this dialog asked for: open it again.
  useEffect(() => {
    if (!openAtStart) return;
    let current = true;
    void hasFreshSignIn()
      .catch(() => true)
      .then((fresh) => {
        if (!current) return;
        setNeedsSignIn(!fresh);
        setOpen(true);
      });
    return () => {
      current = false;
    };
  }, [openAtStart]);

  return {
    isOpen,
    setOpen,
    checking,
    needsSignIn,
    setNeedsSignIn,
    signingIn,
    open: () => void open(),
    signInAgain(returnTo: string) {
      setSigningIn(true);
      signInAgain(returnTo).catch(() => {
        setSigningIn(false);
        showToast("Couldn't reach Google", { tone: "error" });
      });
    },
  };
}

export function ChangePassphrase({ openAtStart }: { openAtStart: boolean }) {
  const dialog = useFreshDialog(openAtStart);
  const [pending, setPending] = useState(false);
  const [currentProblem, setCurrentProblem] = useState<"wrong" | "not-latin">();
  const [newProblem, setNewProblem] = useState<PassphraseProblem>();

  async function change(
    currentPassphrase: string,
    newPassphrase: string,
    signOutOthers: boolean,
  ) {
    setPending(true);
    try {
      await vault.changePassphrase(currentPassphrase, newPassphrase);
    } catch (error) {
      setPending(false);
      if (error instanceof CryptoError) setCurrentProblem("wrong");
      else if (
        error instanceof ApiError &&
        error.code === "session_not_fresh"
      ) {
        dialog.setNeedsSignIn(true);
      } else toast(error);
      return;
    }
    if (signOutOthers) {
      const { error } = await authClient.revokeOtherSessions();
      if (error) {
        showToast("Other devices are still signed in", {
          tone: "error",
          description:
            "The passphrase changed. Use Sign out everywhere to end the other sessions.",
        });
      }
    }
    setPending(false);
    dialog.setOpen(false);
    showToast("Passphrase changed", { tone: "success" });
  }

  return (
    <>
      <PassphraseSection pending={dialog.checking} onPress={dialog.open} />
      <ChangePassphraseDialog
        isOpen={dialog.isOpen}
        onOpenChange={(isOpen) => {
          if (pending) return;
          dialog.setOpen(isOpen);
          setCurrentProblem(undefined);
          setNewProblem(undefined);
        }}
        needsSignIn={dialog.needsSignIn}
        signingIn={dialog.signingIn}
        onSignInAgain={() => {
          dialog.signInAgain("/settings?then=change-passphrase");
        }}
        pending={pending}
        currentProblem={currentProblem}
        newProblem={newProblem}
        onEdit={() => {
          setCurrentProblem(undefined);
          setNewProblem(undefined);
        }}
        onSubmit={({ currentPassphrase, newPassphrase, signOutOthers }) => {
          const current = currentPassphraseProblem(currentPassphrase);
          const next = checkPassphrase(newPassphrase) ?? undefined;
          setCurrentProblem(current);
          setNewProblem(next);
          if (current || next) return;
          void change(currentPassphrase, newPassphrase, signOutOthers);
        }}
      />
    </>
  );
}

export function NewRecoveryKey({ openAtStart }: { openAtStart: boolean }) {
  const dialog = useFreshDialog(openAtStart);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<"wrong" | "not-latin">();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  async function create(passphrase: string) {
    setPending(true);
    try {
      setRecoveryKey(await vault.createRecoveryKey(passphrase));
    } catch (error) {
      if (error instanceof CryptoError) setProblem("wrong");
      else if (
        error instanceof ApiError &&
        error.code === "session_not_fresh"
      ) {
        dialog.setNeedsSignIn(true);
      } else toast(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <RecoveryKeySection pending={dialog.checking} onPress={dialog.open} />
      <NewRecoveryKeyDialog
        isOpen={dialog.isOpen}
        onOpenChange={(isOpen) => {
          if (pending) return;
          dialog.setOpen(isOpen);
          setProblem(undefined);
        }}
        step={recoveryKey ? "save" : dialog.needsSignIn ? "sign-in" : "confirm"}
        recoveryKey={recoveryKey}
        signingIn={dialog.signingIn}
        onSignInAgain={() => {
          dialog.signInAgain("/settings?then=new-recovery-key");
        }}
        pending={pending}
        problem={problem}
        onEdit={() => {
          setProblem(undefined);
        }}
        onSubmit={(passphrase) => {
          const found = currentPassphraseProblem(passphrase);
          setProblem(found);
          if (!found) void create(passphrase);
        }}
        onSaved={() => {
          dialog.setOpen(false);
          setRecoveryKey(null);
        }}
      />
    </>
  );
}

export function LockNow({ remembered }: { remembered: boolean }) {
  const [pending, setPending] = useState(false);
  return (
    <LockSection
      remembered={remembered}
      pending={pending}
      onLock={() => {
        setPending(true);
        // The page reloads once every tab has forgotten the key.
        void vault.lock("lock");
      }}
    />
  );
}

export function BaseCurrency({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(settingsQuery(userId));
  const save = useMutation({
    mutationFn: (baseCurrency: string) =>
      saveSettings(userId, query.data ?? null, { baseCurrency }),
    onSuccess: (record) => {
      queryClient.setQueryData(settingsQuery(userId).queryKey, record);
    },
    onError: toast,
  });
  const stored = query.data?.value?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  return (
    <BaseCurrencySection
      value={save.isPending ? save.variables : stored}
      isDisabled={query.isPending || save.isPending}
      onChange={(currency) => {
        if (currency !== stored) save.mutate(currency);
      }}
    />
  );
}
