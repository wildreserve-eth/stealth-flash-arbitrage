import { pct, usd, type ChainId, type Liquidation } from "@/lib/hunter-engine";
import { cn } from "@/lib/utils";

const chainTag: Record<ChainId, string> = {
  base: "text-chain-base border-chain-base/40",
  scroll: "text-chain-scroll border-chain-scroll/40",
  polygon: "text-chain-polygon border-chain-polygon/40",
};

const statusTone: Record<Liquidation["status"], string> = {
  backstepping: "text-warn border-warn/50 bg-warn/10",
  closed: "text-signal border-signal/50 bg-signal/10",
  watching: "text-muted-foreground border-border",
  healed: "text-muted-foreground border-border",
};

export function LiquidationFeed({ liqs }: { liqs: Liquidation[] }) {
  return (
    <div className="panel flex min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold tracking-[0.18em] uppercase">
          Backstep liquidations
        </h2>
        <span className="label-xs">{liqs.length} tracked</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {liqs.length === 0 && (
          <p className="px-3 py-8 text-center font-mono text-xs text-muted-foreground">
            no unhealthy longtail positions yet…
          </p>
        )}
        <ul className="divide-y divide-border">
          {liqs.map((l) => (
            <li key={l.id} className="animate-rowin px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase",
                    chainTag[l.chain],
                  )}
                >
                  {l.chain}
                </span>
                <span className="font-mono text-sm font-semibold">
                  {l.collateral}/{l.debt}
                </span>
                <span className="label-xs">{l.lender}</span>
                <span
                  className={cn(
                    "ml-auto rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase",
                    statusTone[l.status],
                  )}
                >
                  {l.status}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] sm:grid-cols-4">
                <Stat
                  k="health"
                  v={l.healthFactor.toFixed(3)}
                  tone={l.healthFactor < 1 ? "bad" : l.healthFactor < 1.05 ? "warn" : undefined}
                />
                <Stat k="position" v={usd(l.positionUsd)} />
                <Stat k="bonus" v={pct(l.bonusPct)} />
                <Stat k="net" v={`+${usd(Math.max(0, l.netUsd))}`} tone="good" />
              </div>

              <div className="mt-2">
                <div className="label-xs mb-1">
                  backstep ladder · {l.steps} slices @ {usd(l.stepSizeUsd)}
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: l.steps }).map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-1.5 flex-1 rounded-full",
                        l.status === "closed"
                          ? "bg-signal"
                          : l.status === "backstepping" && i < Math.ceil(l.steps / 2)
                            ? "bg-warn"
                            : "bg-muted",
                      )}
                      style={{ opacity: 1 - i * 0.09 }}
                    />
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: "good" | "bad" | "warn" }) {
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
