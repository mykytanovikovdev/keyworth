import { useEffect, useRef } from "react";
import { Composer } from "../components/Composer.tsx";
import { ConfirmationCard } from "../components/ConfirmationCard.tsx";
import { Change } from "../components/HoldingsTable.tsx";
import {
  AssistantMessage,
  StreamedText,
  UserMessage,
} from "../components/Messages.tsx";
import { StepTimeline } from "../components/StepTimeline.tsx";
import { ValueChart } from "../components/ValueChart.tsx";
import { octoberChange, octoberLabels, portfolio, script } from "../data.ts";
import { formatSignedPercent, formatTickPercent } from "../format.ts";
import { tokenize, useSequence } from "../hooks.ts";

// The scripted scene, phase by phase (milliseconds each phase lasts):
// question, step 1, step 2, streamed answer, chart, question, step 1, step 2, short answer.
const STREAM_MS = tokenize(script.firstAnswer).length * 28 + 300;
const SCENE = [500, 900, 900, STREAM_MS, 1400, 700, 900, 900, 700] as const;

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);

export function ConversationScreen() {
  const phase = useSequence(SCENE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const working = (phase >= 1 && phase < 4) || (phase >= 6 && phase < 9);

  // Follow the conversation as it grows, like a chat does.
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const observer = new ResizeObserver(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="kw-scroll-fade min-h-0 flex-1 overflow-y-auto"
        data-chat-scroll
      >
        <div
          ref={contentRef}
          className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-4 pb-10 md:px-6"
        >
          <UserMessage>{script.firstQuestion}</UserMessage>

          {phase >= 1 && (
            <AssistantMessage>
              <StepTimeline
                steps={script.firstSteps}
                completed={clamp(phase - 1, 2)}
                summary={script.firstSummary}
              />
              <StreamedText text={script.firstAnswer} active={phase >= 3} />
              {phase >= 4 && (
                <figure className="kw-enter rounded-lg border border-line p-4">
                  <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      Portfolio change, October 1 to 19
                    </span>
                    <Change percent={portfolio.changePercent} />
                  </figcaption>
                  <ValueChart
                    values={octoberChange}
                    labels={octoberLabels}
                    format={formatSignedPercent}
                    formatTick={formatTickPercent}
                    label="Portfolio change from October 1 to 19, rising from 0% to plus 4.2%"
                    height={190}
                  />
                </figure>
              )}
            </AssistantMessage>
          )}

          {phase >= 5 && <UserMessage>{script.secondQuestion}</UserMessage>}

          {phase >= 6 && (
            <AssistantMessage>
              <StepTimeline
                steps={script.secondSteps}
                completed={clamp(phase - 6, 2)}
                summary={script.secondSummary}
                openWhenDone
              />
              <StreamedText text={script.secondAnswer} active={phase >= 8} />
              {phase >= 9 && (
                <ConfirmationCard
                  trade={script.trade}
                  priceNote="The price is within the day's range for December 20, 2025."
                />
              )}
            </AssistantMessage>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 pb-4 md:px-6">
        <Composer layout="docked" streaming={working} />
      </div>
    </div>
  );
}
