import { LegalPage } from "./LegalPage.tsx";

export function TermsPage() {
  return (
    <LegalPage title="Terms">
      <section className="flex flex-col gap-2">
        <h2>A closed beta</h2>
        <p>
          Keyworth is a personal project, open by invitation. It is provided as
          is, without warranty, and may change or stop at any time.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Not financial advice</h2>
        <p>
          Keyworth explains numbers calculated from the data you enter. It does
          not recommend buying or selling anything and does not predict prices.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Your account</h2>
        <p>
          Sign in only with your own Google account. You can delete your account
          at any time in Settings.
        </p>
      </section>
    </LegalPage>
  );
}
