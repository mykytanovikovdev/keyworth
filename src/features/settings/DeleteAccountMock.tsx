import { Button } from "../../ui/index.ts";
import { Section } from "./Section.tsx";

/** The existing "Delete account" section, without its session-bound logic. */
export function DeleteAccountMock() {
  return (
    <Section
      title="Delete account"
      description="Removes your account and everything stored with it."
    >
      <Button>Delete account</Button>
    </Section>
  );
}
