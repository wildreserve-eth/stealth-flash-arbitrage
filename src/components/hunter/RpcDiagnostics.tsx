import { useEffect, useSyncExternalStore } from "react";
import { createPublicClient } from "viem";
import { VIEM_CHAINS } from "@/lib/executor";
import { CHAINS, type ChainId } from "@/lib/hunter-engine";
import {
  getRpcHealthServerSnapshot,
  getRpcHealthSnapshot,
  resetRpcHealth,
  subscribeRpcHealth,
  trackedHttp,
  type RpcHealth,
} from "@/lib/rpc-health";
import { cn } from "@/lib/utils";

const PROBE_MS = 10_000;

export function RpcDiagnostics({
  rpc,
  enabled,
}: {
  rpc: Record<ChainId, string>;
  enabled: Record<ChainId, boolean>;
}) {
  const health = useSyncExternalStore(
    subscribeRpcHealth,
    getRpcHealthSnapshot,
    getRpcHealthServerSnapshot,
  );

  // Active liveness probe so the panel reflects endpoint health even when no
  // wallet is connected. eth_blockNumber is the cheapest read on every chain.
  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      for (const c of CHAINS) {
        if (!enabled[c.id]) continue;
        const client = createPublicClient({
          chain: VIEM_CHAINS[c.id],
          transport: trackedHttp(c.id, rpc[c.id]),
        });
        void client.getBlockNumber().catch(() => undefined);
      }
    };
    probe();
    const t = setInterval(() => {
      if (!cancelled) probe();
    }, PROBE_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [rpc, enabled]);

  return (
    <section className="panel mb-4 px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-mono text-[11px] tracking-[0.16em] uppercase">rpc diagnostics</h2>
          <p className="label-xs mt-0.5">live latency · error rate · active endpoint</p>
        </div>
        <button
          type="button"
          onClick={() => resetRpcHealth()}
          className="rounded-sm border border-border px-2.5 py-1 font-mono text-[10px] uppercase text-muted-foreground transition-colors hover:text-foreground"
        >
          reset stats
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {CHAINS.map((c) => (
          <Card
            key={c.id}
            name={c.name}
            enabled={enabled[c.id]}
            h={health[c.id]}
            endpoint={rpc[c.id]}
          />
        ))}
      </div>
    </section>
  );
}

function Card({
  name,
  enabled,
  h,
  endpoint,
}: {
  name: string;
  enabled: boolean;
  h: RpcHealth | undefined;
  endpoint: string;
}) {
  const total = h?.total ?? 0;
  const errRate = h?.errorRatePct ?? 0;
  const status = !enabled ? "paused" : total === 0 ? "probing" : errRate > 25 ? "degraded" : "ok";
  const statusTone =
    status === "ok"
      ? "text-signal"
      : status === "degraded"
        ? "text-danger"
        : "text-muted-foreground";

  return (
    <div
      className={cn(
        "rounded-sm border border-border bg-surface-raised/40 p-3",
        !enabled && "opacity-50",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs font-semibold tracking-wide">{name}</span>
        <span className={cn("font-mono text-[10px] uppercase", statusTone)}>{status}</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        <Stat label="last" value={h?.lastMs != null ? `${h.lastMs}ms` : "—"} />
        <Stat label="avg" value={h?.avgMs != null ? `${Math.round(h.avgMs)}ms` : "—"} />
        <Stat label="p95" value={h?.p95Ms != null ? `${Math.round(h.p95Ms)}ms` : "—"} />
        <Stat
          label="error rate"
          value={total ? `${errRate.toFixed(1)}%` : "—"}
          tone={errRate > 0 ? "bad" : undefined}
        />
        <Stat label="calls" value={total ? String(total) : "—"} />
        <Stat label="failed" value={h?.errors ? String(h.errors) : "0"} tone={h?.errors ? "bad" : undefined} />
      </div>

      <Spark samples={h?.samples ?? []} />

      <div className="mt-2 truncate border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
        {endpoint || "chain default"}
      </div>
      {h?.lastError && (
        <div className="mt-1 break-all font-mono text-[10px] text-danger">{h.lastError}</div>
      )}
    </div>
  );
}

function Spark({ samples }: { samples: { ms: number; ok: boolean }[] }) {
  if (samples.length === 0) return null;
  const max = Math.max(...samples.map((s) => s.ms), 1);
  return (
    <div className="mt-2 flex h-6 items-end gap-[2px]">
      {samples.map((s, i) => (
        <div
          key={i}
          title={`${s.ms}ms${s.ok ? "" : " · failed"}`}
          className={cn("w-full rounded-[1px]", s.ok ? "bg-signal/60" : "bg-danger")}
          style={{ height: `${Math.max(8, (s.ms / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | undefined }) {
  return (
    <div>
      <div className="label-xs">{label}</div>
      <div
        className={cn(
          "font-mono text-xs tabular-nums",
          tone === "bad" ? "text-danger" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
