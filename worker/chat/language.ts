/*
 * The language of the user's latest message, for one line the server adds at
 * the end of the model's request: the development model otherwise slips into
 * the conversation's earlier language, or asks which one to use. Only a name
 * from the lists below ever reaches that line, never the message's own words.
 */

/** Words in a writing system that says the language, or nearly. */
const SCRIPTS: readonly (readonly [RegExp, string])[] = [
  [/\p{Script=Cyrillic}+/gu, "Russian"],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]+/gu, "Japanese"],
  [/\p{Script=Georgian}+/gu, "Georgian"],
  [/\p{Script=Hangul}+/gu, "Korean"],
];

const LATIN = /\p{Script=Latin}+/gu;

/** Letters only these languages of the Cyrillic script have. */
const CYRILLIC: readonly (readonly [RegExp, string])[] = [
  [/[іїєґ]/iu, "Ukrainian"],
  [/ў/iu, "Belarusian"],
];

/** Short words that a message in the language is hard to write without. */
const WORDS: readonly (readonly [string, string])[] = [
  [
    "English",
    "the my is are was did do does how what which who why when where much many of and in on it can should will i you me give tell show compare",
  ],
  [
    "Romanian",
    "cum ce este sunt meu mea mele cât câte care unde când pentru din luna am ai portofoliul și",
  ],
];

const count = (text: string, words: RegExp) => text.match(words)?.length ?? 0;

function latinLanguage(text: string): string | null {
  const words = new Set(text.toLowerCase().match(/\p{L}+/gu) ?? []);
  const scores = WORDS.map(([language, list]) => ({
    language,
    score: list.split(" ").filter((word) => words.has(word)).length,
  })).sort((a, b) => b.score - a.score);
  const [best, next] = scores;
  return best && best.score > (next?.score ?? 0) ? best.language : null;
}

/** The message's language, when it is clear; null when it is not. */
export function languageOf(text: string): string | null {
  const latin = count(text, LATIN);
  const [script] = SCRIPTS.map(([words, language]) => ({
    language,
    words: count(text, words),
  })).sort((a, b) => b.words - a.words);
  if (script && script.words > 0 && script.words >= latin) {
    if (script.language !== "Russian") return script.language;
    return CYRILLIC.find(([letters]) => letters.test(text))?.[1] ?? "Russian";
  }
  return latin > 0 ? latinLanguage(text) : null;
}

/** The last line of the model's request. */
export function languageLine(text: string): string {
  const language = languageOf(text);
  return language
    ? `Reply in ${language} only. Earlier messages in another language do not change that.`
    : "Write the whole answer in the language of the user's latest message, whatever language earlier messages are in.";
}
