import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogTrigger,
  showToast,
} from "../../ui/index.ts";
import { vault } from "../../vault/index.ts";
import { authClient, sessionQuery } from "../auth/client.ts";
import { signInAgain } from "../unlock/fresh-sign-in.ts";

type Step = "confirm" | "deleting" | "reauthenticate";

interface DeleteAccountProps {
  /** True after returning from a fresh sign-in: the dialog opens by itself. */
  reauthenticated: boolean;
  /** Where the fresh Google sign-in comes back to. */
  returnTo?: string;
}

/**
 * Deleting the account needs a sign-in from the last 10 minutes (enforced by
 * the server), not the passphrase: someone who lost both the passphrase and
 * the recovery key can still delete it, from the recovery screen. If the
 * session is older, the dialog asks for a fresh Google sign-in and comes back
 * to `returnTo` (Settings: after unlocking, with the dialog open).
 */
export function DeleteAccount({
  reauthenticated,
  returnTo = "/settings?then=delete-account",
}: DeleteAccountProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("confirm");

  async function deleteAccount() {
    setStep("deleting");
    const { error } = await authClient.deleteUser();
    if (error?.code === "SESSION_EXPIRED") {
      setStep("reauthenticate");
      return;
    }
    if (error) {
      setStep("confirm");
      showToast("Couldn't delete the account", {
        tone: "error",
        description: "Try again in a moment.",
      });
      return;
    }
    queryClient.setQueryData(sessionQuery.queryKey, null);
    queryClient.removeQueries({ queryKey: ["vault"] });
    showToast("Account deleted", { tone: "success" });
    await navigate({ to: "/sign-in" });
    // Every tab of this browser, and the device key, go too.
    await vault.lock("sign-out");
  }

  return (
    <DialogTrigger
      defaultOpen={reauthenticated}
      onOpenChange={(isOpen) => {
        if (!isOpen) setStep("confirm");
      }}
    >
      <Button>Delete account</Button>
      <Dialog title="Delete your account?" role="alertdialog">
        {(close) =>
          step === "reauthenticate" ? (
            <>
              <p className="mt-2 text-base text-fg-muted">
                For your security, sign in with Google again, then confirm the
                deletion. You&apos;ll come back to this step.
              </p>
              <DialogActions>
                <Button onPress={close}>Cancel</Button>
                <Button
                  variant="primary"
                  onPress={() => {
                    signInAgain(returnTo).catch(() => {
                      showToast("Couldn't reach Google", { tone: "error" });
                    });
                  }}
                >
                  Sign in again
                </Button>
              </DialogActions>
            </>
          ) : (
            <>
              <p className="mt-2 text-base text-fg-muted">
                This permanently deletes your account and everything stored with
                it. It can&apos;t be undone.
              </p>
              <DialogActions>
                <Button onPress={close} isDisabled={step === "deleting"}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  isPending={step === "deleting"}
                  onPress={() => void deleteAccount()}
                >
                  Delete account
                </Button>
              </DialogActions>
            </>
          )
        }
      </Dialog>
    </DialogTrigger>
  );
}
