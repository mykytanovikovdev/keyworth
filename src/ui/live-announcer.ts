/**
 * React Aria announces changes to screen readers through a hidden element it
 * adds to <body> (`[data-live-announcer]`, holding two `role="log"` regions).
 * Before announcing a spin button's new value (a date segment, a number
 * field), it clears the old announcement with `log.innerHTML = ''`. Keyworth's
 * CSP requires Trusted Types and allows no policy, so that assignment throws
 * and the field stops working.
 *
 * Clearing needs no HTML at all, so each log region gets its own `innerHTML`
 * setter: an empty string removes the children with `replaceChildren()`;
 * anything else goes to the browser's setter, where Trusted Types still
 * refuses a string. Nothing is loosened in the CSP.
 *
 * This relies on React Aria's internals (the data attribute and the role), so
 * the e2e suites type a date under the real CSP: an update that changes them
 * fails there.
 */

const ANNOUNCER = "[data-live-announcer]";
const LOG = ':scope > [role="log"]';

function guard(announcer: Element) {
  // Looked up here, not on import: the module also loads in Node (unit tests).
  const browserInnerHtml = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "innerHTML",
  );
  for (const log of announcer.querySelectorAll(LOG)) {
    Object.defineProperty(log, "innerHTML", {
      configurable: true,
      get(this: Element): string {
        return String(browserInnerHtml?.get?.call(this) ?? "");
      },
      set(this: Element, value: unknown) {
        if (value === "") this.replaceChildren();
        else browserInnerHtml?.set?.call(this, value);
      },
    });
  }
}

/**
 * Guards the announcer now and whenever React Aria adds one. Call once, before
 * the app renders. React Aria clears only after it has announced once, so the
 * observer (which runs right after the element is added) is always in time.
 */
export function guardLiveAnnouncer(root: Document = document): () => void {
  for (const announcer of root.querySelectorAll(ANNOUNCER)) guard(announcer);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element && node.matches(ANNOUNCER)) guard(node);
      }
    }
  });
  observer.observe(root.body, { childList: true });
  return () => {
    observer.disconnect();
  };
}
