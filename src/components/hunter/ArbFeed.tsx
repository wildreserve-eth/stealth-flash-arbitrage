import { pct, price, usd, type ChainId, type Opportunity } from "@/lib/hunter-engine";
import { cn } from "@/lib/utils";

const chainTag: Record<ChainId, string> = {
  base: "text-chain-base border-chain-base/40",
  scroll: "text-chain-scroll border-chain-scroll/40",
  polygon: "text-chain-polygon border-chain-polygon/40",
};

const statusTone: Record<Opportunity["status"], string> = {
  armed: "text-signal border-signal/50 bg-signal/10",
  capped: "text-warn border-warn/50 bg-warn/10",
  thin: "text-muted-foreground border-border",
  scanning: "text-muted-foreground border-border",
  executed: "text-signal border-signal/50",
  missed: "text-danger border-danger/40",
};

export function ArbFeed({
  opps,
  onExecute,
}: {
  opps: Opportunity[];
  onExecute?: (o: Opportunity) => void;
}) {
  return (
    <div className="panel flex min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold tracking-[0.18em] uppercase">Longtail arb feed</h2>
        <span className="label-xs">{opps.length} in window</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {opps.length === 0 && (
          <p className="px-3 py-8 text-center font-mono text-xs text-muted-foreground">
            scanning pools…
          </p>
        )}
        <ul className="divide-y divide-border">
          {opps.map((o) => (
            <li key={o.id} className="animate-rowin px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase",
                    chainTag[o.chain],
                  )}
                >
                  {o.chain}
                </span>
                <span className="font-mono text-sm font-semibold">{o.pair}</span>
                <span
                  className={cn(
                    "ml-auto rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase",
                    statusTone[o.status],
                  )}
                >
                  {o.status}
                </span>
              </div>

              <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                buy <span className="text-foreground">{o.legs[0].venue}</span> @{" "}
                {price(o.legs[0].price)} → sell{" "}
                <span className="text-foreground">{o.legs[1].venue}</span> @ {price(o.legs[1].price)}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] sm:grid-cols-4">
                <Stat k="spread" v={pct(o.spreadPct)} />
                <Stat k="loan" v={usd(o.loanUsd)} tone={o.status === "capped" ? "warn" : undefined} />
                <Stat k="slip" v={pct(o.slipPct)} tone={o.slipPct > 2 ? "warn" : undefined} />
                <Stat
                  k="net"
                  v={`${o.netUsd >= 0 ? "+" : ""}${usd(o.netUsd)}`}
                  tone={o.netUsd >= 0 ? "good" : "bad"}
                />
              </div>

              <div className="mt-2 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      o.confidence > 60 ? "bg-signal" : o.confidence > 30 ? "bg-warn" : "bg-danger",
                    )}
                    style={{ width: `${o.confidence}%` }}
                  />
                </div>
                <span className="label-xs">
                  conf {o.confidence.toFixed(0)}% · {o.blocksLeft}b left
                </span>
                {onExecute && (
                  <button
                    type="button"
                    onClick={() => onExecute(o)}
                    className="rounded-sm border border-signal/50 bg-signal/10 px-2 py-0.5 font-mono text-[10px] uppercase text-signal hover:bg-signal/20"
                  >
                    execute
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: "good" | "bad" | "warn" | undefined }) {
  return (
    <div className="flex justify-between gap-1 sm:block">
      <span className="label-xs">{k}</span>
      <span
        className={cn(
          "block tabular-nums",
          tone === "good" && "text-signal",
          tone === "bad" && "text-danger",
          tone === "warn" && "text-warn",
        )}
      >
        {v}
      </span>
    </div>
  );
}
