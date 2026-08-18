import { useEffect, useMemo, useState } from "react";
import { encodeAbiParameters, parseAbiParameters, type Address } from "viem";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CHAIN_IDS,
  EXECUTOR_ABI,
  EXPLORER,
  LOAN_ASSET,
  VIEM_CHAINS,
  isAddress,
  shortAddr,
  toUnits,
} from "@/lib/executor";
import { usd, type ChainId, type HunterSettings, type Liquidation, type Opportunity } from "@/lib/hunter-engine";
import type { useWallet } from "@/hooks/use-wallet";
import { cn } from "@/lib/utils";

export type ExecTarget = { kind: "arb"; opp: Opportunity } | { kind: "liq"; liq: Liquidation };

type Wallet = ReturnType<typeof useWallet>;

export function ExecuteDialog({
  target,
  onClose,
  wallet,
  settings,
  update,
}: {
  target: ExecTarget | null;
  onClose: () => void;
  wallet: Wallet;
  settings: HunterSettings;
  update: (patch: Partial<HunterSettings>) => void;
}) {
  const chain: ChainId | null = target
    ? target.kind === "arb"
      ? target.opp.chain
      : target.liq.chain
    : null;

  const [borrower, setBorrower] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [busy, setBusy] = useState<"idle" | "preflight" | "signing" | "mining">("idle");
  const [preflight, setPreflight] = useState<{ ok: boolean; msg: string } | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);

  useEffect(() => {
    setPreflight(null);
    setHash(null);
    setBusy("idle");
  }, [target]);

  const executor = chain ? (settings.executor[chain] ?? "") : "";
  const asset = chain ? LOAN_ASSET[chain] : null;

  const notionalUsd = target
    ? target.kind === "arb"
      ? target.opp.loanUsd
      : target.liq.stepSizeUsd * target.liq.steps
    : 0;
  const capUsd = settings.bankrollUsd * (settings.capPct / 100);
  const overCap = notionalUsd > capUsd + 0.01;

  const minProfitUsd = useMemo(() => {
    if (!target) return 0;
    const net = target.kind === "arb" ? target.opp.netUsd : target.liq.netUsd;
    return Math.max(0, net * (1 - slippageBps / 10_000) * 0.5);
  }, [target, slippageBps]);

  const needsBorrower = target?.kind === "liq";
  const ready =
    !!chain &&
    !!wallet.address &&
    isAddress(executor) &&
    !overCap &&
    (!needsBorrower || isAddress(borrower));

  const buildCall = (): { address: Address; abi: typeof EXECUTOR_ABI; functionName: string; args: readonly unknown[] } => {
    if (!chain || !asset || !target) throw new Error("no target");
    const amount = toUnits(notionalUsd, asset.decimals);
    const minProfit = toUnits(minProfitUsd, asset.decimals);
    if (target.kind === "arb") {
      const o = target.opp;
      const params = encodeAbiParameters(
        parseAbiParameters("string buyVenue, string sellVenue, string pair, uint256 slippageBps"),
        [o.legs[0].venue, o.legs[1].venue, o.pair, BigInt(slippageBps)],
      );
      return {
        address: executor as Address,
        abi: EXECUTOR_ABI,
        functionName: "executeArb",
        args: [asset.address, amount, minProfit, params],
      };
    }
    const l = target.liq;
    return {
      address: executor as Address,
      abi: EXECUTOR_ABI,
      functionName: "backstepLiquidate",
      args: [asset.address, borrower as Address, amount, BigInt(l.steps), minProfit],
    };
  };

  const runPreflight = async () => {
    if (!chain || !wallet.address) return;
    setBusy("preflight");
    setPreflight(null);
    try {
      const pc = wallet.publicClientFor(chain);
      const call = buildCall();
      await pc.simulateContract({ ...call, account: wallet.address } as never);
      setPreflight({ ok: true, msg: "simulation passed — call would succeed at head" });
    } catch (e) {
      setPreflight({ ok: false, msg: (e as Error).message.split("\n")[0]!.slice(0, 220) });
    } finally {
      setBusy("idle");
    }
  };

  const send = async () => {
    if (!chain || !wallet.address) return;
    try {
      if (wallet.chainIdNum !== CHAIN_IDS[chain]) await wallet.switchTo(chain);
      const wc = wallet.walletClient();
      if (!wc) throw new Error("wallet unavailable");
      setBusy("signing");
      const call = buildCall();
      const txHash = await wc.writeContract({
        ...call,
        account: wallet.address,
        chain: VIEM_CHAINS[chain],
      } as never);
      setHash(txHash);
      setBusy("mining");
      toast.success("Signed — broadcasting", { description: shortAddr(txHash) });
      const pc = wallet.publicClientFor(chain);
      const rc = await pc.waitForTransactionReceipt({ hash: txHash });
      if (rc.status === "success") {
        toast.success("Executed on-chain", { description: `block ${rc.blockNumber}` });
      } else {
        toast.error("Transaction reverted on-chain");
      }
    } catch (e) {
      toast.error("Execution aborted", { description: (e as Error).message.split("\n")[0]!.slice(0, 140) });
    } finally {
      setBusy("idle");
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-border bg-surface-raised">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm tracking-[0.14em] uppercase">
            Sign &amp; execute · {chain}
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">
            {target?.kind === "arb"
              ? `${target.opp.pair} · ${target.opp.legs[0].venue} → ${target.opp.legs[1].venue}`
              : target?.kind === "liq"
                ? `${target.liq.lender} · ${target.liq.collateral}/${target.liq.debt} · ${target.liq.steps} backsteps`
                : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 font-mono text-[11px]">
          <Row k="notional" v={usd(notionalUsd)} tone={overCap ? "bad" : undefined} />
          <Row k={`cap ${settings.capPct}%`} v={usd(capUsd)} />
          <Row k="loan asset" v={asset ? `${asset.symbol} ${shortAddr(asset.address)}` : "—"} />
          <Row k="min profit guard" v={usd(minProfitUsd)} />
          <Row
            k="signer"
            v={wallet.address ? shortAddr(wallet.address) : "not connected"}
            tone={wallet.address ? undefined : "bad"}
          />

          <label className="block">
            <span className="label-xs">executor contract ({chain})</span>
            <Input
              value={executor}
              spellCheck={false}
              placeholder="0x…"
              onChange={(e) =>
                chain && update({ executor: { ...settings.executor, [chain]: e.target.value } })
              }
              className="mt-1 h-8 border-border bg-background font-mono text-[11px]"
            />
          </label>

          {needsBorrower && (
            <label className="block">
              <span className="label-xs">borrower address</span>
              <Input
                value={borrower}
                spellCheck={false}
                placeholder="0x…"
                onChange={(e) => setBorrower(e.target.value)}
                className="mt-1 h-8 border-border bg-background font-mono text-[11px]"
              />
            </label>
          )}

          <label className="block">
            <span className="label-xs">slippage guard (bps)</span>
            <Input
              type="number"
              value={slippageBps}
              onChange={(e) => setSlippageBps(Number(e.target.value) || 0)}
              className="mt-1 h-8 border-border bg-background font-mono text-[11px]"
            />
          </label>

          {overCap && (
            <p className="text-danger">notional exceeds the {settings.capPct}% flashloan cap — blocked.</p>
          )}

          {preflight && (
            <p className={cn("break-all", preflight.ok ? "text-signal" : "text-danger")}>
              {preflight.ok ? "✓ " : "✕ "}
              {preflight.msg}
            </p>
          )}

          {hash && chain && (
            <a
              href={`${EXPLORER[chain]}/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
              className="block break-all text-signal underline"
            >
              {hash}
            </a>
          )}
        </div>

        <div className="mt-2 flex gap-2">
          <Button
            variant="outline"
            className="flex-1 font-mono text-[11px] uppercase"
            disabled={!ready || busy !== "idle"}
            onClick={runPreflight}
          >
            {busy === "preflight" ? "simulating…" : "preflight"}
          </Button>
          <Button
            className="flex-1 bg-signal font-mono text-[11px] text-background uppercase hover:bg-signal/90"
            disabled={!ready || busy !== "idle"}
            onClick={send}
          >
            {busy === "signing" ? "sign in wallet…" : busy === "mining" ? "mining…" : "sign & send"}
          </Button>
        </div>

        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
          This broadcasts a real transaction from your wallet to your executor contract. Run
          preflight first — a reverting simulation means the hunt is stale.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "bad" | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="label-xs">{k}</span>
      <span className={cn("tabular-nums", tone === "bad" ? "text-danger" : "text-foreground")}>
        {v}
      </span>
    </div>
  );
}
