import { createFileRoute } from "@tanstack/react-router";
import { useHunter } from "@/hooks/use-hunter";
import { ChainWatcher } from "@/components/hunter/ChainWatcher";
import { ControlDeck } from "@/components/hunter/ControlDeck";
import { ArbFeed } from "@/components/hunter/ArbFeed";
import { LiquidationFeed } from "@/components/hunter/LiquidationFeed";
import { usd, type ChainId } from "@/lib/hunter-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hybrid Flashloan MEV Hunter — Base · Scroll · Polygon" },
      {
        name: "description",
        content:
          "Multi-chain MEV console: 6% capped flashloan longtail arbitrage plus backstepping liquidations across Base, Scroll and Polygon, with your own RPC endpoints.",
      },
      { property: "og:title", content: "Hybrid Flashloan MEV Hunter" },
      {
        property: "og:description",
        content:
          "Capped flashloan longtail arbitrage and backstepping liquidation hunting across Base, Scroll and Polygon.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Console,
});

function Console() {
  const { settings, update, running, setRunning, opps, liqs, stats, realized, reset } = useHunter();

  const toggleChain = (id: ChainId) =>
    update({ chains: { ...settings.chains, [id]: !settings.chains[id] } });

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1400px] px-4 py-5 lg:px-6">
      <header className="panel mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div>
          <h1 className="text-sm font-bold tracking-[0.2em] uppercase">
            Hybrid<span className="text-signal signal-glow">·</span>Flashloan Hunter
          </h1>
          <p className="label-xs mt-0.5">
            longtail arb + backstep liquidations · base / scroll / polygon
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          <Metric label="realized net" value={`${realized.net >= 0 ? "+" : ""}${usd(realized.net)}`} tone />
          <Metric label="hunts hit" value={String(realized.wins)} />
          <Metric label="skipped" value={String(realized.misses)} />
          <Metric label="loan volume" value={usd(realized.loans)} />
          <Metric label="cap" value={`${settings.capPct.toFixed(1)}%`} tone />

          <button
            type="button"
            onClick={() => setRunning(!running)}
            className={cn(
              "rounded-sm border px-3 py-1.5 font-mono text-[11px] uppercase transition-colors",
              running
                ? "border-signal/50 bg-signal/10 text-signal hover:bg-signal/20"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {running ? "● hunting" : "▮ paused"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-sm border border-border px-3 py-1.5 font-mono text-[11px] uppercase text-muted-foreground transition-colors hover:text-foreground"
          >
            clear
          </button>
        </div>
      </header>

      <section className="mb-4">
        <ChainWatcher
          stats={stats}
          enabled={settings.chains}
          rpc={settings.rpc}
          onToggle={toggleChain}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr_1fr]">
        <ControlDeck settings={settings} update={update} />
        <div className="h-[520px] lg:h-[640px]">
          <ArbFeed opps={opps} />
        </div>
        <div className="h-[520px] lg:h-[640px]">
          <LiquidationFeed liqs={liqs} />
        </div>
      </div>

      <p className="mt-4 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Simulation console. Opportunity, gas and liquidation figures are modeled locally — no signer,
        no broadcast, no funds at risk. Wire an executor before treating any row as actionable.
      </p>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <div>
      <div className="label-xs">{label}</div>
      <div
        className={cn(
          "font-mono text-sm tabular-nums",
          tone ? "text-signal signal-glow" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
