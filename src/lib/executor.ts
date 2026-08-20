/**
 * Live execution layer.
 *
 * The console never custodies keys: every state-changing call is built here
 * and handed to the operator's injected wallet for signing. The target is an
 * operator-deployed executor contract that owns the flashloan + swap logic;
 * we only encode the intent and enforce the notional cap client-side.
 */
import { base, polygon, scroll } from "viem/chains";
import type { Chain } from "viem";
import type { ChainId } from "./hunter-engine";

export const VIEM_CHAINS: Record<ChainId, Chain> = { base, scroll, polygon };

export const CHAIN_IDS: Record<ChainId, number> = {
  base: base.id,
  scroll: scroll.id,
  polygon: polygon.id,
};

export const chainIdToKey = (id: number): ChainId | undefined =>
  (Object.keys(CHAIN_IDS) as ChainId[]).find((k) => CHAIN_IDS[k] === id);

export const EXPLORER: Record<ChainId, string> = {
  base: "https://basescan.org",
  scroll: "https://scrollscan.com",
  polygon: "https://polygonscan.com",
};

export const NATIVE: Record<ChainId, string> = { base: "ETH", scroll: "ETH", polygon: "POL" };

/** Canonical USDC (6dp) — the default flashloan asset per chain. */
export const LOAN_ASSET: Record<ChainId, { address: `0x${string}`; symbol: string; decimals: number }> = {
  base: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6 },
  scroll: { address: "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4", symbol: "USDC", decimals: 6 },
  polygon: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", decimals: 6 },
};

/** Canonical WETH per chain — quote asset for longtail pairs. */
export const QUOTE_ASSET: Record<ChainId, { address: `0x${string}`; symbol: string; decimals: number }> = {
  base: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
  scroll: { address: "0x5300000000000000000000000000000000000004", symbol: "WETH", decimals: 18 },
  polygon: { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", symbol: "WETH", decimals: 18 },
};

/**
 * Minimal executor interface the operator's contract must expose.
 * Both entrypoints are expected to be onlyOwner and to revert on net loss.
 */
export const EXECUTOR_ABI = [
  {
    type: "function",
    name: "executeArb",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "minProfit", type: "uint256" },
      { name: "params", type: "bytes" },
    ],
    outputs: [{ name: "profit", type: "uint256" }],
  },
  {
    type: "function",
    name: "backstepLiquidate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "debtAsset", type: "address" },
      { name: "borrower", type: "address" },
      { name: "repayAmount", type: "uint256" },
      { name: "steps", type: "uint256" },
      { name: "minProfit", type: "uint256" },
    ],
    outputs: [{ name: "recovered", type: "uint256" }],
  },
  {
    // Profits are pushed here on every successful hunt, so the signing
    // wallet is topped up for the next round of gas.
    type: "function",
    name: "setProfitRecipient",
    stateMutability: "nonpayable",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "profitRecipient",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    // Manual drain of any residual profit sitting in the executor.
    type: "function",
    name: "sweep",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
] as const;

export const isAddress = (v: string): v is `0x${string}` => /^0x[a-fA-F0-9]{40}$/.test(v.trim());

/** USD notional → integer units of the loan asset. */
export function toUnits(usdAmount: number, decimals: number): bigint {
  const clamped = Math.max(0, usdAmount);
  return BigInt(Math.round(clamped * 10 ** decimals));
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
