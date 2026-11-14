/*
 * How an answer's formatting looks: paragraphs, lists, bold, tables, inline
 * code. The answer arrives as markdown and becomes plain React elements (no
 * HTML from the model is ever rendered), styled by this one class on the
 * container, so the mockups and the real renderer look the same.
 */
export const answerClassName = [
  "text-base text-fg break-words",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_p]:my-3",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-1 [&_li]:pl-1 [&_li::marker]:text-fg-muted",
  "[&_strong]:font-semibold",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:tabular-nums",
  "[&_th]:border-b [&_th]:border-line-strong [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-medium [&_th]:text-fg-muted",
  "[&_td]:border-b [&_td]:border-line [&_td]:py-2 [&_td]:pr-4",
  "[&_code]:rounded-sm [&_code]:bg-surface [&_code]:px-1 [&_code]:text-sm",
].join(" ");
