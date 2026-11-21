import { useEffect, useRef } from "react";

/** Questions to start with, under an empty chat. */
export const STARTER_QUESTIONS = [
  "How did my portfolio do this month?",
  "Which coin moved the most this week?",
  "What's my biggest holding?",
  "Compare Bitcoin and Ethereum",
];

/** While an answer grows, keep its end in view, unless the reader scrolled up. */
export function useFollow(dependency: unknown) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const end = endRef.current;
    if (!end) return;
    const nearBottom =
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 160;
    if (nearBottom) end.scrollIntoView({ block: "end" });
  }, [dependency]);
  return endRef;
}
