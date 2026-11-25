import { describe, expect, it } from "vitest";
import { asksForAmounts } from "../../../src/features/chat/amounts.ts";

/*
 * Which questions let the tools send amounts. The starter questions and any
 * other about change, risk or shares do not (CLAUDE.md, rule 5).
 */

describe("asksForAmounts", () => {
  it.each([
    // The starter questions.
    "How did my portfolio do this month?",
    "Which coin moved the most this week?",
    "What's my biggest holding?",
    "Compare Bitcoin and Ethereum",
    "How risky is my portfolio?",
    "What else can you say?",
    "Which coin gained the most?",
    "Should I sell my Bitcoin?",
    "Как мой портфель показал себя за этот месяц?",
    "Какая монета больше всего изменилась за неделю?",
    "Насколько рискованный у меня портфель?",
    "Стоит ли мне сейчас продать биткоин?",
    "Какая у меня самая большая позиция?",
    "Из чего состоит мой портфель?",
    "Покажи несколько моих монет",
    "Какая доходность у эфира?",
    "Насколько доходный у меня портфель?",
    "Яка дохідність у біткоїна?",
    "Дай более развернутый ответ",
    "Cum a mers portofoliul meu luna asta?",
    "今月のポートフォリオはどうでしたか？",
    "როგორ შეიცვალა ჩემი პორტფელი?",
  ])("no: %s", (question) => {
    expect(asksForAmounts(question)).toBe(false);
  });

  it.each([
    "How much is my portfolio worth?",
    "How many coins do I hold?",
    "What's my profit?",
    "What are my gains this year?",
    "Show it in dollars",
    "And in EUR?",
    "What did I pay: $500 or more?",
    "Сколько у меня всего денег в долларах?",
    "Какая у меня прибыль за год?",
    "Какой доход принес LTC за все время?",
    "Сколько дохода от стейкинга?",
    "Який дохід принесла Solana?",
    "What income did LTC bring?",
    "What did I earn on Solana?",
    "На какую сумму я купил эфир?",
    "Сколько стоит мой портфель?",
    "Покажи количество монет",
    "Скільки коштує мій портфель?",
    "Яка сума в мене в біткоїні?",
    "Cât valorează portofoliul meu?",
    "ポートフォリオの総額はいくらですか？",
    "რამდენი მაქვს ბიტკოინი?",
    "a kolik to je v USD?",
  ])("yes: %s", (question) => {
    expect(asksForAmounts(question)).toBe(true);
  });

  it("goes on with a question that asked, only as a follow-up", () => {
    const asked = "How much is my portfolio worth?";
    expect(asksForAmounts("And Bitcoin?", asked)).toBe(true);
    expect(asksForAmounts("А биткоин?", "Сколько у меня эфира?")).toBe(true);
    expect(asksForAmounts("What about Solana?", asked)).toBe(true);
    // Not a follow-up, or of a question that did not ask.
    expect(asksForAmounts("How risky is it?", asked)).toBe(false);
    expect(asksForAmounts("And Bitcoin?", "How did it do?")).toBe(false);
    // A word that only begins as one.
    expect(asksForAmounts("Анализ риска", asked)).toBe(false);
    expect(asksForAmounts("Andorra?", asked)).toBe(false);
  });

  it("is not fooled by codes inside words", () => {
    expect(asksForAmounts("Is Rubic risky?")).toBe(false);
    expect(asksForAmounts("Compare Euler and Gelato")).toBe(false);
  });
});
