import { CHAINS, usd, type ChainId, type HunterSettings } from "@/lib/hunter-engine";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

export function ControlDeck({
  settings,
  update,
}: {
  settings: HunterSettings;
  update: (patch: Partial<HunterSettings>) => void;
}) {
  const cap = settings.bankrollUsd * (settings.capPct / 100);

  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold tracking-[0.18em] uppercase">Strategy deck</h2>
        <span className="label-xs">hybrid · flashloan</span>
      </div>

      <div className="mt-4 space-y-5">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="label-xs">Flashloan cap</span>
            <span className="signal-glow font-mono text-lg text-signal tabular-nums">
              {settings.capPct.toFixed(1)}%
            </span>
          </div>
          <Slider
            className="mt-3"
            value={[settings.capPct]}
            min={0.5}
            max={25}
            step={0.5}
            onValueChange={([v]) => update({ capPct: v ?? 6 })}
          />
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            max notional per hunt → <span className="text-foreground">{usd(cap)}</span> of{" "}
            {usd(settings.bankrollUsd)} bankroll
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="min net / hunt"
            value={settings.minNetUsd}
            onChange={(v) => update({ minNetUsd: v })}
            prefix="$"
          />
          <Field
            label="max gas / hunt"
            value={settings.maxGasUsd}
            onChange={(v) => update({ maxGasUsd: v })}
            prefix="$"
          />
          <Field
            label="bankroll"
            value={settings.bankrollUsd}
            onChange={(v) => update({ bankrollUsd: v })}
            prefix="$"
          />
          <Field
            label="hf trigger"
            value={settings.hfTrigger}
            step={0.01}
            onChange={(v) => update({ hfTrigger: v })}
          />
        </div>

        <label className="flex items-center justify-between rounded-sm border border-border bg-surface-raised px-3 py-2">
          <span>
            <span className="block text-xs">Auto-arm qualifying hunts</span>
            <span className="label-xs">simulation only — no signer attached</span>
          </span>
          <Switch
            checked={settings.autoArm}
            onCheckedChange={(v) => update({ autoArm: v })}
            aria-label="Auto-arm qualifying hunts"
          />
        </label>

        <div>
          <div className="label-xs mb-2">RPC endpoints</div>
          <div className="space-y-2">
            {CHAINS.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <span className="w-14 shrink-0 font-mono text-[10px] text-muted-foreground uppercase">
                  {c.short}
                </span>
                <Input
                  value={settings.rpc[c.id]}
                  spellCheck={false}
                  onChange={(e) =>
                    update({ rpc: { ...settings.rpc, [c.id as ChainId]: e.target.value } })
                  }
                  className="h-8 border-border bg-background font-mono text-[11px]"
                  placeholder={c.defaultRpc}
                />
              </div>
            ))}
          </div>
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            stored locally in this browser · never transmitted
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  prefix,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="label-xs">{label}</span>
      <span className="mt-1 flex items-center rounded-sm border border-border bg-background px-2">
        {prefix && <span className="font-mono text-xs text-muted-foreground">{prefix}</span>}
        <Input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="h-8 border-0 bg-transparent px-1 font-mono text-xs tabular-nums shadow-none focus-visible:ring-0"
        />
      </span>
    </label>
  );
}
