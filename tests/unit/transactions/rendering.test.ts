import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Transaction } from "../../../shared/schemas/transaction.ts";
import { TransactionList } from "../../../src/features/transactions/TransactionList.tsx";

/*
 * What a user or a source wrote reaches the page as text, never as markup:
 * React escapes it, and nothing here builds HTML from data. Rendered to a
 * string in Node, so no browser is needed; the e2e tests add the real CSP.
 */

const MARKUP = `<img src=x onerror="alert(1)">`;
const ESCAPED = "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;";

const listOf = (fields: Partial<Transaction>, useLogos = false) =>
  renderToStaticMarkup(
    createElement(TransactionList, {
      transactions: [
        {
          id: "t1",
          symbol: "XSS",
          name: MARKUP,
          value: {
            type: "buy",
            assetId: "crypto:bitcoin",
            executedAt: "2025-12-20T12:00:00Z",
            quantity: "0.5",
            price: "60000",
            priceCurrency: "USD",
            source: "csv",
            note: MARKUP,
            ...fields,
          } as Transaction,
        },
      ],
      damaged: 0,
      useLogos,
    }),
  );

describe("hostile text in the list", () => {
  it("shows a note and a coin's name as the text they are", () => {
    const markup = listOf({});

    expect(markup).not.toContain("<img");
    // Inside a tag it would be an attribute; in text it is only words.
    expect(markup).not.toMatch(/<[^>]*\sonerror=/);
    expect(markup).toContain(ESCAPED);
  });

  it("puts an asset id into the logo's address only encoded", () => {
    const markup = listOf({ assetId: `crypto:a" onerror="alert(1)` }, true);

    const sources = [...markup.matchAll(/<img [^>]*src="([^"]*)"/g)].map(
      ([, src]) => src,
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src).toMatch(/^\/api\/assets\/crypto%3Aa%22%20onerror%3D/);
    }
    expect(markup).not.toMatch(/<[^>]*\sonerror=/);
  });
});
