import { PRIVACY_POLICY_VERSION } from "../../../shared/legal.ts";
import { TextLink } from "../../ui/index.ts";
import { LegalPage } from "./LegalPage.tsx";

const privacyEmail = (
  <TextLink href="mailto:privacy@keyworth.app">privacy@keyworth.app</TextLink>
);

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated={PRIVACY_POLICY_VERSION}>
      <section className="flex flex-col gap-2">
        <h2>Who is responsible for your data</h2>
        <p>
          Keyworth is run by Mykyta Novikov, an individual developer based in
          the country of Georgia ("we" in this policy). Under the GDPR and
          Georgia's Law on Personal Data Protection, we are the "controller" of
          your personal data: the one who decides how it is used and answers for
          it.
        </p>
        <p>Questions or requests about your data: {privacyEmail}.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>What we handle and why</h2>
        <ul>
          <li>
            <strong>Your account.</strong> Your name, email address and Google
            account ID, which Google gives us when you sign in, and which
            version of the Terms you accepted and when. We need these to give
            you an account. Legal basis: our contract with you (GDPR Art.
            6(1)(b)).
          </li>
          <li>
            <strong>Your portfolio.</strong> Your portfolio data and settings,
            encrypted, and the locked copies of the key that opens them, so you
            can reach them from your devices. Legal basis: our contract with
            you.
          </li>
          <li>
            <strong>Security.</strong> The IP address and browser of each
            sign-in session, request counters per IP address, and the invite and
            block lists (email addresses and, for a block, the reason). We use
            these to keep accounts safe, stop abuse and run the closed beta.
            Legal basis: our legitimate interest in doing so (GDPR Art.
            6(1)(f)).
          </li>
          <li>
            <strong>Your messages.</strong> If you write to us: your address and
            what you wrote, so we can answer. Legal basis: our legal duty to
            answer requests about your data (GDPR Art. 6(1)(c)), otherwise our
            legitimate interest in answering.
          </li>
        </ul>
        <p>
          You have to sign in with Google to use Keyworth: we can't give you an
          account without these details.
        </p>
        <p>
          We make no automated decisions about you with legal or similarly
          significant effects. There are no ads, no analytics and no third-party
          trackers, and we don't sell your data.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>Your portfolio is encrypted</h2>
        <p>
          Your portfolio data and settings are encrypted in your browser before
          they are sent, and the server keeps only the encrypted copy. The key
          that opens it is stored only locked: once with your passphrase, once
          with your recovery key. We can see how many records you have, roughly
          how large they are and when they were saved, but not what they
          contain.
        </p>
        <p>
          If you lose both your passphrase and your recovery key, nobody can
          open your data, not even us.
        </p>
        <p>
          With Remember this device, your browser keeps one half of a key and
          the server the other, for at most 14 days. Lock, signing out or
          closing the browser ends it, though browsers that reopen tabs may keep
          it going until that limit.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>What we don't keep</h2>
        <ul>
          <li>Your Google password, which we never see.</li>
          <li>Your passphrase and your recovery key: we never receive them.</li>
          <li>
            Google access tokens or your profile photo. We ask Google only who
            you are.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2>Who else handles your data</h2>
        <ul>
          <li>
            <strong>Cloudflare</strong> (USA) runs the app and its network, so
            every request passes through it, with your IP address. It also
            forwards messages sent to our privacy address.
          </li>
          <li>
            <strong>Neon</strong>, part of Databricks (USA), hosts the database,
            stored in Frankfurt, Germany.
          </li>
          <li>
            <strong>Google</strong> (USA) handles sign-in and hosts the mailbox
            that receives messages sent to our privacy address.
          </li>
        </ul>
        <p>
          These companies are based in the US. They protect personal data from
          the EU under the EU-US Data Privacy Framework or the EU's Standard
          Contractual Clauses. We run Keyworth from Georgia, so we can also
          reach account data from there; the EU has not issued an adequacy
          decision for Georgia. Your portfolio stays encrypted wherever it goes.
        </p>
        <p>We share your data with nobody else unless the law requires it.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>How long we keep it</h2>
        <ul>
          <li>
            <strong>Your account and portfolio:</strong> until you delete your
            account, when they are removed at once. The database's own history
            can hold deleted data for up to 7 more days.
          </li>
          <li>
            <strong>Sign-in sessions:</strong> a session ends when you sign out,
            or about 7 days after your last visit. Its record, with the IP
            address and browser, is deleted within 2 days after that.
          </li>
          <li>
            <strong>Request counters:</strong> deleted within 2 days.
          </li>
          <li>
            <strong>Invite list:</strong> your email address stays on it after
            you delete your account, so you can come back, until you ask us to
            remove it or we end your invitation.
          </li>
          <li>
            <strong>Block list:</strong> until we lift the block, even if the
            account is deleted.
          </li>
          <li>
            <strong>Your messages:</strong> as long as we need to answer you and
            to show what was asked and done.
          </li>
          <li>
            <strong>Error logs:</strong> up to 7 days. They record what failed,
            not who you are or what you sent.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2>Your rights</h2>
        <p>Under the GDPR and Georgian law, you can:</p>
        <ul>
          <li>see the personal data we hold about you and get a copy of it;</li>
          <li>have it corrected;</li>
          <li>have it deleted;</li>
          <li>take the data you gave us to another service;</li>
          <li>
            restrict how we use it, or object to uses based on our legitimate
            interest.
          </li>
        </ul>
        <p>
          Settings → Delete account deletes your account and everything stored
          with it, at once. For anything else, write to {privacyEmail}. We
          answer within 10 working days, or tell you if we need up to 10 more.
        </p>
        <p>
          Your portfolio is encrypted, so all we can hand over is the encrypted
          copy. Only you can open it.
        </p>
        <p>
          You can also complain to a data protection authority: in the EU,{" "}
          <TextLink href="https://www.edpb.europa.eu/about-edpb/about-edpb/members_en">
            the one in your country
          </TextLink>
          ; in Georgia,{" "}
          <TextLink href="https://www.sao.ge/en">
            the State Audit Office
          </TextLink>
          .
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>Storage on your device</h2>
        <p>
          Keyworth stores only what it needs to work. None of it tracks you
          across sites, so there is no cookie banner. Clearing your browser's
          data for this site removes all of it and signs you out.
        </p>
        <ul>
          <li>
            <strong>__Secure-better-auth.session_token</strong> (cookie): keeps
            you signed in, for about 7 days after your last visit.
          </li>
          <li>
            <strong>__Secure-better-auth.state</strong> (cookie): protects
            sign-in with Google while it is in progress, for 5 minutes.
          </li>
          <li>
            <strong>__Host-keyworth-device</strong> (cookie): only with Remember
            this device. Ties it to this browser until the browser closes.
          </li>
          <li>
            <strong>keyworth</strong> (IndexedDB database): only with Remember
            this device. Holds this browser's half of the key, until you Lock or
            sign out.
          </li>
          <li>
            <strong>keyworth-theme</strong> (local storage): the theme you
            chose.
          </li>
          <li>
            <strong>keyworth-lock-epoch</strong> (local storage): makes Lock
            apply to all your tabs.
          </li>
          <li>
            <strong>keyworth-last-activity</strong> (local storage): when you
            last did something, for locking after a period of inactivity.
          </li>
          <li>
            <strong>keyworth-forget-device</strong> (local storage): a Lock made
            offline that still has to reach the server. Removed once it does.
          </li>
          <li>
            <strong>keyworth-locked-idle</strong> (session storage): why the
            page reloaded locked. Removed once read.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2>Age</h2>
        <p>
          Keyworth is for people aged 18 and over. We don't knowingly collect
          data from anyone younger.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2>Changes to this policy</h2>
        <p>
          When this policy changes, we update the date at the top. If a change
          matters to you, we tell you before it applies.
        </p>
      </section>
    </LegalPage>
  );
}
