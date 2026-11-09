/*
 * Saving text the page made as a file on this device: a Blob behind a
 * temporary link with `download`. Nothing goes over the network, and the
 * strict CSP and Trusted Types allow it (no markup is built from strings).
 */

/** Long enough for the slowest browser to have started reading the file. */
const KEEP_URL_MS = 60_000;

export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  // Some browsers download only from a link in the page.
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, KEEP_URL_MS);
}
