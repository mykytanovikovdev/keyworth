import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, Card, showToast, ThemeToggle } from "../../ui/index.ts";
import { authClient, sessionQuery } from "../auth/client.ts";
import { DeleteAccount } from "./DeleteAccount.tsx";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </Card>
  );
}

export function SettingsPage({
  reauthenticated,
}: {
  reauthenticated: boolean;
}) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    const { error } = await authClient.signOut();
    if (error) {
      setSigningOut(false);
      showToast("Couldn't sign out", { tone: "error" });
      return;
    }
    queryClient.setQueryData(sessionQuery.queryKey, null);
    await navigate({ to: "/sign-in" });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <Section
        title="Account"
        description={`Signed in with Google as ${session?.user.email ?? ""}.`}
      >
        <Button
          icon={<LogOut aria-hidden="true" />}
          isPending={signingOut}
          onPress={() => void signOut()}
        >
          Sign out
        </Button>
      </Section>
      <Section title="Theme" description="Saved on this device.">
        <ThemeToggle showLabels />
      </Section>
      <Section
        title="Delete account"
        description="Removes your account and everything stored with it."
      >
        <DeleteAccount reauthenticated={reauthenticated} />
      </Section>
    </div>
  );
}
