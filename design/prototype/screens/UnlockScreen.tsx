import { Eye, EyeOff } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "../components/Button.tsx";
import { KeyworthMark } from "../components/KeyworthMark.tsx";
import { revealInSequence } from "../motion.ts";

/** After Google sign-in: the passphrase decrypts the data key on this device. */
export function UnlockScreen() {
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    return revealInSequence(Array.from(rootRef.current?.children ?? []));
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10 text-fg">
      <div ref={rootRef} className="w-full max-w-sm">
        <KeyworthMark className="size-10" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          Unlock your portfolio
        </h1>
        <p className="mt-2 text-fg-muted">
          Your data is encrypted. Enter your passphrase to decrypt it on this
          device.
        </p>

        <form
          className="mt-8 flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <div>
            <label htmlFor="passphrase" className="text-sm font-medium">
              Passphrase
            </label>
            <div className="relative mt-1.5">
              <input
                id="passphrase"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                className="h-11 w-full rounded-md border border-line-strong bg-raised px-3 pr-11 text-[15px] text-fg transition-colors duration-150 outline-none focus:border-focus"
              />
              <button
                type="button"
                aria-label={visible ? "Hide passphrase" : "Show passphrase"}
                title={visible ? "Hide passphrase" : "Show passphrase"}
                onClick={() => {
                  setVisible(!visible);
                }}
                className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted hover:text-fg"
              >
                {visible ? (
                  <EyeOff size={18} strokeWidth={1.75} />
                ) : (
                  <Eye size={18} strokeWidth={1.75} />
                )}
              </button>
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-accent" />
            <span>
              Remember this device for 7 days
              <span className="block text-fg-muted">
                Only on a device you don&apos;t share.
              </span>
            </span>
          </label>

          <Button
            type="submit"
            variant="primary"
            className="h-11 w-full text-[15px]"
          >
            Unlock
          </Button>
        </form>

        <a
          href="#"
          className="mt-5 inline-block text-sm text-fg underline underline-offset-4 hover:text-accent"
        >
          Use your recovery key instead
        </a>

        <p className="mt-10 border-t border-line pt-4 text-sm text-fg-muted">
          Signed in with Google as alex@example.com.{" "}
          <a href="#" className="text-fg underline underline-offset-4">
            Sign out
          </a>
        </p>
      </div>
    </main>
  );
}
