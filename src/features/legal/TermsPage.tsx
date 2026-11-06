import { TERMS_VERSION } from "../../../shared/legal.ts";
import { TextLink } from "../../ui/index.ts";
import { LegalPage } from "./LegalPage.tsx";

export function TermsPage() {
  return (
    <LegalPage title="Terms" updated={TERMS_VERSION}>
      <section className="flex flex-col gap-2">
        <h2>Who you are agreeing with</h2>
        <p>
          These terms are an agreement between you and Mykyta Novikov, who runs
          Keyworth ("we"). By continuing with Google on the sign-in page, you
          accept them. How we handle your data is in the{" "}
          <TextLink href="/privacy">Privacy policy</TextLink>.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>A closed beta</h2>
        <p>
          Keyworth is a personal project, open by invitation. It is provided as
          is, without warranty. It may have bugs, and it may change or stop at
          any time. Keep your own records of anything important.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>You must be 18 or older</h2>
        <p>Keyworth is only for people aged 18 and over.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>Not financial advice</h2>
        <p>
          Keyworth explains numbers calculated from the data you enter. It does
          not recommend buying or selling anything and does not predict prices.
          Nothing in it is financial, investment, tax or legal advice, and the
          decisions you make are your own.
        </p>
        <p>
          Its numbers and explanations can be wrong, including anything written
          by AI. Check anything important before you act on it.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>Your passphrase and recovery key</h2>
        <p>
          Your data is encrypted with keys that only you hold. If you lose both
          your passphrase and your recovery key, your data is gone: nobody can
          recover it, not even us. Keeping them safe is up to you.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>Your account</h2>
        <p>
          Sign in only with your own Google account. Don't try to break
          Keyworth, get around its limits or reach other people's data. We can
          end your access at any time, including your invitation. You can delete
          your account at any time in Settings.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>Limits on our liability</h2>
        <p>
          As far as the law allows, we are not liable for lost data, financial
          losses or decisions you make using Keyworth. Nothing here limits the
          rights the law doesn't let us limit, including your rights as a
          consumer where you live.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>Changes to these terms</h2>
        <p>
          When these terms change, we update the date at the top. If a change
          matters to you, we tell you before it applies.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>Contact</h2>
        <p>
          <TextLink href="mailto:privacy@keyworth.app">
            privacy@keyworth.app
          </TextLink>
        </p>
      </section>
    </LegalPage>
  );
}
