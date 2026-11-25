import { useEffect, useRef, useState } from "react";

/** Questions to start with, under an empty chat. */
export const STARTER_QUESTIONS = [
  "How did my portfolio do this month?",
  "Which coin moved the most this week?",
  "What's my biggest holding?",
  "Compare Bitcoin and Ethereum",
];

/** Scrolled down to within this of the end, the reader is following again. */
const NEAR_END = 48;

const fromEnd = () =>
  document.documentElement.scrollHeight - window.innerHeight - window.scrollY;

const toEnd = () => {
  // The page's end, not the last line: the question box is part of the page
  // (sticky), and stopping at the line above it left the page short of its end,
  // pulling a reader who scrolled on back up at every piece of the answer.
  window.scrollTo({ top: document.documentElement.scrollHeight });
};

/**
 * Keeps the end of the conversation in view while an answer is being written,
 * until the reader scrolls up; scrolling back down to the end follows again,
 * and so does a new question (`questionId`). Not while nothing is written: a
 * reader who opens the steps of an answer keeps their place. Returns the ref of
 * an element at the end of the column.
 */
export function useFollow(
  questionId: string | number | undefined,
  answering: boolean,
) {
  const [end, setEnd] = useState<HTMLDivElement | null>(null);
  const following = useRef(true);

  useEffect(() => {
    if (!end) return;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      // Up, by the reader: the page also moves up when it gets shorter, but
      // then it is still at its end.
      if (y < lastY && fromEnd() > 2) following.current = false;
      else if (fromEnd() <= NEAR_END) following.current = true;
      lastY = y;
    };
    // Before the scroll it causes, so that a piece of the answer arriving in
    // between does not pull the page back.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && window.scrollY > 0) following.current = false;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
    };
  }, [end]);

  useEffect(() => {
    const column = end?.parentElement;
    if (!column) return;
    // Its last change too: what ends an answer (stopped, failed) is drawn as it
    // ends.
    if (following.current) toEnd();
    if (!answering) return;
    const observer = new ResizeObserver(() => {
      if (following.current) toEnd();
    });
    observer.observe(column);
    return () => {
      observer.disconnect();
    };
  }, [end, answering]);

  useEffect(() => {
    if (!end || questionId === undefined) return;
    following.current = true;
    toEnd();
  }, [end, questionId]);

  return setEnd;
}
