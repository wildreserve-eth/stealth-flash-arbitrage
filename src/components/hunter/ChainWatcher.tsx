import { CHAINS, type ChainId } from "@/lib/hunter-engine";
import type { ChainStat } from "@/hooks/use-hunter";
import { cn } from "@/lib/utils";

const accent: Record<ChainId, string> = {
  base: "text-chain-base",
  scroll: "text-chain-scroll",
  polygon: "text-chain-polygon",
};

const dot: Record<ChainId, string> = {
  base: "bg-chain-base",
  scroll: "bg-chain-scroll",
  polygon: "bg-chain-polygon",
};

export function ChainWatcher({
  stats,
  enabled,
  rpc,
  onToggle,
}: {
  stats: ChainStat[];
  enabled: Record<ChainId, boolean>;
  rpc: Record<ChainId, string>;
  onToggle: (id: ChainId) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {CHAINS.map((c) => {
        const s = stats.find((x) => x.id === c.id)!;
        const on = enabled[c.id];
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            className={cn(
              "panel scan-line group text-left transition-colors",
              on ? "hover:border-primary/50" : "opacity-45 hover:opacity-70",
            )}
          >
            {on && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden">
                <div className="animate-sweep h-px w-1/3 bg-primary/70" />
              </div>
            )}
            <div className="flex items-center justify-between px-3 pt-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    on ? cn(dot[c.id], "animate-blip") : "bg-muted-foreground",
                  )}
                />
                <span className={cn("text-sm font-semibold tracking-wide", accent[c.id])}>
                  {c.name}
                </span>
              </div>
              <span className="label-xs">{on ? "watching" : "paused"}</span>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-3">
              <Cell label="block" value={s.block ? `#${s.block.toLocaleString()}` : "—"} />
              <Cell label="rpc lat" value={s.latencyMs ? `${s.latencyMs}ms` : "—"} />
              <Cell
                label="gas"
                value={s.gas ? `${s.gas} ${c.gasUnit}` : "—"}
                tone={s.gas > 60 ? "warn" : "normal"}
              />
              <Cell label="mempool" value={s.pending ? `${s.pending} tx` : "—"} />
            </div>

            <div className="truncate border-t border-border px-3 py-2 font-mono text-[10px] text-muted-foreground">
              {rpc[c.id]}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Cell({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "warn";
}) {
  return (
    <div>
      <div className="label-xs">{label}</div>
      <div
        className={cn(
          "font-mono text-xs tabular-nums",
          tone === "warn" ? "text-warn" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
