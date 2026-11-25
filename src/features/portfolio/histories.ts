import {
  type HistoriesJson,
  type HistoriesRequest,
  type HistoryJson,
  historyRequestSchema,
  MARKET_LIMITS,
} from "../../../shared/schemas/market.ts";
import { getJson, postJson } from "../transactions/market.ts";

/*
 * Coins' histories, asked for one coin at a time (each has its own place in
 * the query cache) and sent together: those asked for in the same moment, such
 * as a portfolio's, go in one request. What the server does not have ready is
 * then asked for alone, so a coin it must load first holds up no other.
 */

interface Asked {
  asset: string;
  from: string;
  resolve: (history: HistoryJson) => void;
  reject: (error: unknown) => void;
}

/** Asked for in this moment, not sent yet. */
let waiting: Asked[] = [];

/** A coin's daily closes in US dollars from a day. */
export function askHistory(asset: string, from: string): Promise<HistoryJson> {
  // One coin the server refuses would refuse the others with it.
  if (!historyRequestSchema.safeParse({ asset, from }).success) {
    return askAlone(asset, from);
  }
  return new Promise((resolve, reject) => {
    waiting.push({ asset, from, resolve, reject });
    if (waiting.length === 1) setTimeout(send, 0);
  });
}

const askAlone = (asset: string, from: string) =>
  getJson<HistoryJson>(
    `/api/market/history?asset=${encodeURIComponent(asset)}&from=${from}`,
  );

function send() {
  const asked = waiting;
  waiting = [];
  const size = MARKET_LIMITS.historiesPerRequest;
  for (let start = 0; start < asked.length; start += size) {
    void sendTogether(asked.slice(start, start + size));
  }
}

async function sendTogether(asked: readonly Asked[]) {
  let ready: HistoriesJson["histories"] = [];
  if (asked.length > 1) {
    const body: HistoriesRequest = {
      assets: asked.map(({ asset, from }) => ({ asset, from })),
    };
    try {
      const answer = await postJson<HistoriesJson>(
        "/api/market/histories",
        body,
      );
      ready = answer.histories;
    } catch (error) {
      for (const { reject } of asked) reject(error);
      return;
    }
  }
  asked.forEach(({ asset, from, resolve, reject }, index) => {
    const history = ready[index];
    if (history) resolve(history);
    else askAlone(asset, from).then(resolve, reject);
  });
}
