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
import { authClient, sessionQuery, signInWithGoogle } from "../auth/client.ts";

type Step = "confirm" | "deleting" | "reauthenticate";

interface DeleteAccountProps {
  /** True after returning from a fresh sign-in: the dialog opens by itself. */
  reauthenticated: boolean;
}

/**
 * Deleting the account needs a sign-in from the last 10 minutes (enforced by
 * the server). If the session is older, the dialog asks for a fresh Google
 * sign-in and comes back here with the dialog open.
 */
export function DeleteAccount({ reauthenticated }: DeleteAccountProps) {
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
    showToast("Account deleted", { tone: "success" });
    await navigate({ to: "/sign-in" });
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
                    signInWithGoogle("/settings?reauthenticated=1").catch(
                      () => {
                        showToast("Couldn't reach Google", { tone: "error" });
                      },
                    );
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
                  variant="primary"
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
