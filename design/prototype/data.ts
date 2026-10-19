// Mock data for the prototype. Numbers are internally consistent (shares add up
// to 100%, P&L matches cost basis) so the screens read like a real portfolio.

export type SeriesSlot = 1 | 2 | 3 | 4 | 5;

export interface Holding {
  symbol: string;
  name: string;
  quantity: string;
  price: number;
  value: number;
  share: number;
  pnl: number;
  pnlPercent: number;
  slot: SeriesSlot;
}

export const holdings: Holding[] = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    quantity: "0.25",
    price: 92540,
    value: 23135,
    share: 48,
    pnl: 4210.3,
    pnlPercent: 22.2,
    slot: 1,
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    quantity: "4.1",
    price: 3175.6,
    value: 13019.96,
    share: 27,
    pnl: -412.8,
    pnlPercent: -3.1,
    slot: 2,
  },
  {
    symbol: "SOL",
    name: "Solana",
    quantity: "32",
    price: 180.9,
    value: 5788.8,
    share: 12,
    pnl: 1020.15,
    pnlPercent: 21.4,
    slot: 3,
  },
  {
    symbol: "LTC",
    name: "Litecoin",
    quantity: "45",
    price: 85.7,
    value: 3856.5,
    share: 8,
    pnl: 560.9,
    pnlPercent: 17,
    slot: 4,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    quantity: "2,410.29",
    price: 1,
    value: 2410.29,
    share: 5,
    pnl: 0,
    pnlPercent: 0,
    slot: 5,
  },
];

export const portfolio = {
  total: 48210.55,
  change: 1943.1,
  changePercent: 4.2,
};

/** Portfolio change in percent, October 1 to 19. */
export const octoberChange = [
  0, 0.4, 0.9, 0.6, 1.2, 1.9, 1.5, 2.2, 2.8, 2.4, 3.1, 3.6, 3.3, 3.0, 3.5, 3.9,
  3.7, 4.0, 4.2,
];

export const octoberLabels = octoberChange.map(
  (_, index) => `Oct ${String(index + 1)}`,
);

/** Portfolio value in US dollars over the same days. */
export const octoberValue = octoberChange.map(
  (change) => Math.round(46267.45 * (1 + change / 100) * 100) / 100,
);

export const periods = ["1D", "1W", "1M", "1Y", "All"] as const;

export const conversations = {
  today: ["October performance", "Litecoin purchase"],
  earlier: [
    "BTC vs ETH over 90 days",
    "Rebalancing to 60/40",
    "Staking income in September",
  ],
};

export const suggestions = [
  "How did my portfolio do this month?",
  "Which asset moved the most this week?",
  "Record a trade",
  "Compare BTC and ETH over 90 days",
];

export const script = {
  firstQuestion: "Как изменился мой портфель за октябрь?",
  firstSteps: [
    { label: "Read portfolio", detail: "5 assets, 23 trades" },
    {
      label: "Calculated performance",
      detail: "October 1 to October 19, 2026",
    },
  ],
  firstSummary: "Read portfolio, calculated performance",
  firstAnswer:
    "С 1 по 19 октября портфель вырос на 4,2 %. Основной вклад дал BTC: +6,8 % при доле 48 %. " +
    "ETH снизился на 1,3 %, но его доля 27 %, поэтому на общий результат это повлияло слабо. " +
    "USDC держит стоимость и сглаживает колебания.",
  secondQuestion: "Купил 5 LTC 20.12.25 по 60.03$",
  secondSteps: [
    { label: "Found the asset", detail: "Litecoin (LTC)" },
    {
      label: "Checked the price",
      detail: "Within the day's range: $58.10 to $61.40",
    },
  ],
  secondSummary: "Found the asset, checked the price",
  secondAnswer: "Проверьте сделку перед записью:",
  trade: {
    type: "Buy",
    asset: "Litecoin (LTC)",
    date: "December 20, 2025",
    quantity: "5 LTC",
    price: 60.03,
    total: 300.15,
  },
};
