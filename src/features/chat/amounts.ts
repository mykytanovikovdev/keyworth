/*
 * Whether a question asks for amounts: money values or quantities. The tools
 * send them only then (CLAUDE.md, rule 5), whatever the model asks for: told to
 * leave amounts out unless asked, the development model still asked for them on
 * "How did my portfolio do this month?" (2026-11-25). Missing a question costs
 * the person one more ("in dollars"); letting one through sends what was not
 * asked. So: words that can hardly mean anything else, in the languages people
 * here write in, and the signs and codes of currencies, which every language
 * uses.
 */

const CURRENCY =
  /[$€£¥₽₴₾]|(?<![a-z])(usd|usdt|usdc|eur|gbp|rub|jpy|ron|gel|uah|chf)(?![a-z])/i;

const PHRASES: readonly RegExp[] = [
  // English
  /\bhow (much|many)\b/i,
  /\b(amounts?|worth|money|cash|dollars?|euros?|pounds?|quantit(y|ies)|units?|profits?|p&l|pnl|earnings|balance|fees?|value|invested|spent|paid|cost)\b/i,
  /\bmy (gains?|loss(es)?|total)\b/i,
  // Russian and Ukrainian, at the start of a word: "насколько" (how) and
  // "состоит" (consists) do not ask. Nor does "стоит ли": "should I".
  /(?<!\p{L})(сколько|скільки|сумм|сума|стоимост|вартіст|стоит(?! ли)|доллар|долар|бакс|рубл|гривн|евро|євро|деньг|денег|грош|количеств|кількіст|штук|прибыл|прибут|убыт|збит|заработал|заробив|потерял|вложил|потратил|баланс|комисси|комісі)/iu,
  // Romanian
  /(?<!\p{L})(cât|câți|câte|câtă|suma|sumă|valoarea?|valorează|bani|dolari|profitul?|pierderea?|cantitatea?)(?!\p{L})/iu,
  // Japanese, Georgian
  /いくら|金額|総額|価値|ドル|数量|何枚|利益|損益|残高|რამდენ|ღირს|დოლარ|ლარ/,
];

/** A short follow-up that goes on with the question before it: "And Bitcoin?" */
const FOLLOW_UP =
  /^\s*(and|what about|а|и|а что|і|та|și|dar)(?!\p{L})|^\s*(ещё|еще|also)(?!\p{L})/iu;

export function asksForAmounts(question: string, before?: string): boolean {
  if (
    CURRENCY.test(question) ||
    PHRASES.some((words) => words.test(question))
  ) {
    return true;
  }
  return (
    before !== undefined && FOLLOW_UP.test(question) && asksForAmounts(before)
  );
}
