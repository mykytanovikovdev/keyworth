import { LegalPage } from "./LegalPage.tsx";

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <section className="flex flex-col gap-2">
        <h2>What Keyworth stores</h2>
        <ul>
          <li>Your name and email address, from your Google account.</li>
          <li>
            Your sign-in sessions: when they were created, the IP address and
            the browser they came from.
          </li>
          <li>Your portfolio data and settings, encrypted (see below).</li>
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2>What it does not store</h2>
        <ul>
          <li>Your Google password, which Keyworth never sees.</li>
          <li>
            Your passphrase and your recovery key: Keyworth never receives them.
          </li>
          <li>
            Google access tokens or your profile photo. Keyworth asks Google
            only who you are.
          </li>
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Your portfolio</h2>
        <p>
          Your portfolio data and settings are encrypted in your browser before
          they are sent, and the server keeps only the encrypted copy. The key
          that opens it is stored only locked: once with your passphrase, once
          with your recovery key. Keyworth can see how many records you have,
          roughly how large they are and when they were saved, but not what they
          contain.
        </p>
        <p>
          If you lose both your passphrase and your recovery key, nobody can
          open your data, Keyworth included.
        </p>
        <p>
          With Remember this device, your browser keeps one half of a key and
          the server the other, for at most 14 days. Lock, signing out or
          closing the browser ends it.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Who processes data</h2>
        <ul>
          <li>Cloudflare hosts the app.</li>
          <li>Neon stores the database, in Frankfurt.</li>
          <li>Google handles sign-in.</li>
        </ul>
        <p>There are no ads, no analytics and no third-party trackers.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Deleting your data</h2>
        <p>
          Settings → Delete account removes your account and everything stored
          with it, immediately.
        </p>
      </section>
    </LegalPage>
  );
}
