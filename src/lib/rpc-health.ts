/**
 * RPC health instrumentation.
 *
 * Wraps viem's http transport so every JSON-RPC call made by the console is
 * timed and its outcome recorded. Samples live in a small ring buffer per
 * chain and are exposed to the UI through a subscribe/snapshot pair.
 */
import { http, type Transport } from "viem";
import type { ChainId } from "./hunter-engine";

export type RpcSample = {
  method: string;
  ms: number;
  ok: boolean;
  ts: number;
  error?: string;
};

export type RpcHealth = {
  endpoint: string;
  total: number;
  errors: number;
  errorRatePct: number;
  lastMs: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  lastError: string | null;
  lastAt: number | null;
  samples: RpcSample[];
};

const MAX_SAMPLES = 60;

const buffers = new Map<ChainId, RpcSample[]>();
const endpoints = new Map<ChainId, string>();
const listeners = new Set<() => void>();

let snapshot: Record<string, RpcHealth> = {};

const emptyHealth = (endpoint: string): RpcHealth => ({
  endpoint,
  total: 0,
  errors: 0,
  errorRatePct: 0,
  lastMs: null,
  avgMs: null,
  p95Ms: null,
  lastError: null,
  lastAt: null,
  samples: [],
});

function compute(chain: ChainId): RpcHealth {
  const endpoint = endpoints.get(chain) ?? "";
  const samples = buffers.get(chain) ?? [];
  if (samples.length === 0) return emptyHealth(endpoint);

  const ok = samples.filter((s) => s.ok);
  const errors = samples.length - ok.length;
  const durations = ok.map((s) => s.ms).sort((a, b) => a - b);
  const last = samples[samples.length - 1]!;
  const lastFail = [...samples].reverse().find((s) => !s.ok);

  return {
    endpoint,
    total: samples.length,
    errors,
    errorRatePct: (errors / samples.length) * 100,
    lastMs: last.ok ? last.ms : null,
    avgMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    p95Ms: durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]! : null,
    lastError: lastFail?.error ?? null,
    lastAt: last.ts,
    samples: samples.slice(-24),
  };
}

function rebuild() {
  const next: Record<string, RpcHealth> = {};
  for (const chain of endpoints.keys()) next[chain] = compute(chain);
  snapshot = next;
  for (const l of listeners) l();
}

function record(chain: ChainId, sample: RpcSample) {
  const buf = buffers.get(chain) ?? [];
  buf.push(sample);
  if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES);
  buffers.set(chain, buf);
  rebuild();
}

export function resetRpcHealth(chain?: ChainId) {
  if (chain) buffers.delete(chain);
  else buffers.clear();
  rebuild();
}

export function subscribeRpcHealth(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getRpcHealthSnapshot = () => snapshot;
export const getRpcHealthServerSnapshot = () => snapshot;

/** viem http transport that records latency + errors for the given chain. */
export function trackedHttp(chain: ChainId, url?: string): Transport {
  if (url) {
    if (endpoints.get(chain) !== url) {
      endpoints.set(chain, url);
      rebuild();
    }
  } else if (!endpoints.has(chain)) {
    endpoints.set(chain, "chain default");
    rebuild();
  }

  const inner = http(url || undefined);
  return ((opts) => {
    const transport = inner(opts);
    const original = transport.request;
    return {
      ...transport,
      request: async (args: Parameters<typeof original>[0]) => {
        const started = Date.now();
        const method = (args as { method?: string }).method ?? "rpc";
        try {
          const result = await original(args);
          record(chain, { method, ms: Date.now() - started, ok: true, ts: Date.now() });
          return result;
        } catch (e) {
          record(chain, {
            method,
            ms: Date.now() - started,
            ok: false,
            ts: Date.now(),
            error: (e as Error).message.split("\n")[0]!.slice(0, 160),
          });
          throw e;
        }
      },
    };
  }) as Transport;
}
