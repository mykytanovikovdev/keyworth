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
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2>What it does not store</h2>
        <ul>
          <li>Your Google password, which Keyworth never sees.</li>
          <li>
            Google access tokens or your profile photo. Keyworth asks Google
            only who you are.
          </li>
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Your portfolio</h2>
        <p>
          Portfolio data will be encrypted in your browser, with a key that
          never leaves your device, before it is sent to the server. This part
          of Keyworth is still being built.
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
