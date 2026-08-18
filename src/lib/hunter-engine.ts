/**
 * Simulated hunt engine.
 *
 * Pure, deterministic-ish generators for the console. No funds, no signing,
 * no chain writes — this models what the strategy would surface so the
 * operator can tune parameters before wiring a real executor.
 */

export type ChainId = "base" | "scroll" | "polygon";

export type Chain = {
  id: ChainId;
  name: string;
  short: string;
  defaultRpc: string;
  blockTimeMs: number;
  gasUnit: string;
};

export const CHAINS: Chain[] = [
  {
    id: "base",
    name: "Base",
    short: "BASE",
    defaultRpc: "https://mainnet.base.org",
    blockTimeMs: 2000,
    gasUnit: "gwei",
  },
  {
    id: "scroll",
    name: "Scroll",
    short: "SCRL",
    defaultRpc: "https://rpc.scroll.io",
    blockTimeMs: 3000,
    gasUnit: "gwei",
  },
  {
    id: "polygon",
    name: "Polygon",
    short: "POLY",
    defaultRpc: "https://polygon-rpc.com",
    blockTimeMs: 2100,
    gasUnit: "gwei",
  },
];

export const VENUES: Record<ChainId, string[]> = {
  base: ["Aerodrome", "Uniswap v3", "SushiSwap", "BaseSwap", "Alien Base"],
  scroll: ["Nuri", "Uniswap v3", "SyncSwap", "Ambient", "Zebra"],
  polygon: ["Quickswap", "Uniswap v3", "Balancer", "Retro", "Dfyn"],
};

const LONGTAIL: Record<ChainId, string[]> = {
  base: ["TOSHI", "DEGEN", "BRETT", "AERO", "KEYCAT", "MIGGLES", "NORMIE", "BSWAP"],
  scroll: ["SCR", "NURI", "WRSETH", "PUNK", "ZEBRA", "SOLV", "RSETH", "STONE"],
  polygon: ["GHST", "QUICK", "GNS", "SAND", "RETRO", "DFYN", "TEL", "STMATIC"],
};

const LENDERS: Record<ChainId, string[]> = {
  base: ["Aave v3", "Moonwell", "Seamless", "Morpho Blue"],
  scroll: ["Aave v3", "LayerBank", "Rho Markets"],
  polygon: ["Aave v3", "Compound v3", "0vix", "Morpho"],
};

export type ArbLeg = { venue: string; side: "buy" | "sell"; price: number };

export type Opportunity = {
  id: string;
  kind: "arb";
  chain: ChainId;
  token: string;
  pair: string;
  legs: [ArbLeg, ArbLeg];
  spreadPct: number;
  loanUsd: number;
  grossUsd: number;
  gasUsd: number;
  bribeUsd: number;
  netUsd: number;
  liquidityUsd: number;
  slipPct: number;
  confidence: number;
  blocksLeft: number;
  ts: number;
  status: "scanning" | "armed" | "capped" | "thin" | "executed" | "missed";
};

export type Liquidation = {
  id: string;
  kind: "liq";
  chain: ChainId;
  lender: string;
  collateral: string;
  debt: string;
  positionUsd: number;
  healthFactor: number;
  bonusPct: number;
  steps: number;
  stepSizeUsd: number;
  recoveredUsd: number;
  netUsd: number;
  ts: number;
  status: "watching" | "backstepping" | "closed" | "healed";
};

export type HunterSettings = {
  capPct: number;
  minNetUsd: number;
  maxGasUsd: number;
  bankrollUsd: number;
  autoArm: boolean;
  hfTrigger: number;
  chains: Record<ChainId, boolean>;
  rpc: Record<ChainId, string>;
  /** Operator-deployed executor contract per chain (live signing target). */
  executor: Record<ChainId, string>;
  /** Live mode enables real transaction signing from the feeds. */
  liveMode: boolean;
};

export const DEFAULT_SETTINGS: HunterSettings = {
  capPct: 6,
  minNetUsd: 45,
  maxGasUsd: 30,
  bankrollUsd: 250_000,
  autoArm: true,
  hfTrigger: 1.02,
  chains: { base: true, scroll: true, polygon: true },
  rpc: {
    base: CHAINS[0]!.defaultRpc,
    scroll: CHAINS[1]!.defaultRpc,
    polygon: CHAINS[2]!.defaultRpc,
  },
  executor: { base: "", scroll: "", polygon: "" },
  liveMode: false,
};

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const rnd = (min: number, max: number) => min + Math.random() * (max - min);

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Flashloan notional is hard-capped at capPct of bankroll. */
export function cappedLoan(bankrollUsd: number, capPct: number, wanted: number) {
  const cap = bankrollUsd * (capPct / 100);
  return { size: Math.min(wanted, cap), cap, wasCapped: wanted > cap };
}

export function makeOpportunity(chain: ChainId, s: HunterSettings): Opportunity {
  const token = pick(LONGTAIL[chain]);
  const venues = VENUES[chain];
  const a = pick(venues);
  let b = pick(venues);
  while (b === a) b = pick(venues);

  const base = rnd(0.0004, 3.2);
  const spreadPct = rnd(0.35, 4.6);
  const priceLo = base;
  const priceHi = base * (1 + spreadPct / 100);

  const liquidityUsd = rnd(18_000, 940_000);
  const wanted = liquidityUsd * rnd(0.04, 0.22);
  const { size, wasCapped } = cappedLoan(s.bankrollUsd, s.capPct, wanted);

  const slipPct = Math.min(4.5, (size / liquidityUsd) * rnd(6, 14));
  const grossUsd = size * (spreadPct / 100);
  const gasUsd = rnd(0.4, 18) * (chain === "polygon" ? 0.35 : 1);
  const bribeUsd = grossUsd * rnd(0.05, 0.32);
  const slipCost = size * (slipPct / 100);
  const netUsd = grossUsd - gasUsd - bribeUsd - slipCost;

  const confidence = Math.max(
    4,
    Math.min(99, 100 - slipPct * 12 - (liquidityUsd < 60_000 ? 22 : 0) + rnd(-8, 8)),
  );

  let status: Opportunity["status"] = "scanning";
  if (liquidityUsd < 35_000 || slipPct > 3) status = "thin";
  else if (wasCapped) status = "capped";
  else if (netUsd >= s.minNetUsd && gasUsd <= s.maxGasUsd && s.autoArm) status = "armed";

  return {
    id: nextId("arb"),
    kind: "arb",
    chain,
    token,
    pair: `${token}/WETH`,
    legs: [
      { venue: a, side: "buy", price: priceLo },
      { venue: b, side: "sell", price: priceHi },
    ],
    spreadPct,
    loanUsd: size,
    grossUsd,
    gasUsd,
    bribeUsd,
    netUsd,
    liquidityUsd,
    slipPct,
    confidence,
    blocksLeft: Math.ceil(rnd(1, 5)),
    ts: Date.now(),
    status,
  };
}

/**
 * Backstepping liquidation: instead of one atomic close, the position is
 * unwound in descending slices so each step re-prices the thin longtail
 * collateral and the next slice is resized against realized impact.
 */
export function makeLiquidation(chain: ChainId, s: HunterSettings): Liquidation {
  const collateral = pick(LONGTAIL[chain]);
  const positionUsd = rnd(4_000, 320_000);
  const healthFactor = rnd(0.86, 1.14);
  const bonusPct = rnd(4.5, 12.5);
  const steps = Math.max(2, Math.round(rnd(2, 7)));

  const { size } = cappedLoan(s.bankrollUsd, s.capPct, positionUsd * 0.5);
  const stepSizeUsd = size / steps;

  // Each successive step recovers less as impact accumulates.
  let recoveredUsd = 0;
  for (let i = 0; i < steps; i++) recoveredUsd += stepSizeUsd * (bonusPct / 100) * (1 - i * 0.09);

  const netUsd = recoveredUsd - rnd(2, 26);

  const status: Liquidation["status"] =
    healthFactor < s.hfTrigger ? (Math.random() > 0.55 ? "backstepping" : "closed") : "watching";

  return {
    id: nextId("liq"),
    kind: "liq",
    chain,
    lender: pick(LENDERS[chain]),
    collateral,
    debt: pick(["USDC", "USDT", "WETH", "DAI"]),
    positionUsd,
    healthFactor,
    bonusPct,
    steps,
    stepSizeUsd,
    recoveredUsd,
    netUsd,
    ts: Date.now(),
    status,
  };
}

export const usd = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1000
      ? `$${(n / 1000).toFixed(1)}k`
      : `$${n.toFixed(2)}`;

export const pct = (n: number) => `${n.toFixed(2)}%`;

export const price = (n: number) => (n < 0.01 ? n.toFixed(6) : n.toFixed(4));
