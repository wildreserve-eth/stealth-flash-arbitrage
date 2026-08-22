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
  QUOTE_ASSET,
  VIEM_CHAINS,
  isAddress,
  shortAddr,
  toUnits,
} from "@/lib/executor";
import { usd, type ChainId, type HunterSettings, type Liquidation, type Opportunity } from "@/lib/hunter-engine";
import type { useWallet } from "@/hooks/use-wallet";
import { cn } from "@/lib/utils";
import { getRouteQuote, type RouteQuote } from "@/lib/zeroex.functions";

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
  const [gasPlan, setGasPlan] = useState<{
    gas: bigint;
    maxFeeGwei: number;
    tipGwei: number;
    nonce: number;
    chainId: number;
  } | null>(null);

  useEffect(() => {
    setPreflight(null);
    setHash(null);
    setGasPlan(null);
    setBusy("idle");
  }, [target]);

  const executor = chain ? (settings.executor[chain] ?? "") : "";
  const asset = chain ? LOAN_ASSET[chain] : null;
  const quoteAsset = chain ? QUOTE_ASSET[chain] : null;

  // Stealth: rotate the profit recipient across the operator's payout pool so
  // earnings can't be traced to a single address. Re-picked per target.
  const pool = useMemo(
    () => (settings.stealthRecipients ?? []).filter(isAddress),
    [settings.stealthRecipients],
  );
  const [stealthPick, setStealthPick] = useState("");
  useEffect(() => {
    setStealthPick(pool.length ? pool[Math.floor(Math.random() * pool.length)]! : "");
  }, [target, pool]);

  const stealthRotate = settings.stealthMode && pool.length > 0;
  const recipient = (
    stealthRotate && stealthPick ? stealthPick : settings.profitRecipient || wallet.address || ""
  ) as string;

  const relay = chain && settings.stealthMode ? (settings.stealthRelays?.[chain] ?? "").trim() : "";
  const relayHost = useMemo(() => {
    if (!relay) return "";
    try {
      return new URL(relay).host;
    } catch {
      return relay;
    }
  }, [relay]);

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
    isAddress(recipient) &&
    (!needsBorrower || isAddress(borrower));

  const buildCall = (): { address: Address; abi: typeof EXECUTOR_ABI; functionName: string; args: readonly unknown[] } => {
    if (!chain || !asset || !target) throw new Error("no target");
    const amount = toUnits(notionalUsd, asset.decimals);
    const minProfit = toUnits(minProfitUsd, asset.decimals);
    if (target.kind === "arb") {
      const o = target.opp;
      const params = encodeAbiParameters(
        parseAbiParameters(
          "string buyVenue, string sellVenue, string pair, uint256 slippageBps, address profitTo",
        ),
        [o.legs[0].venue, o.legs[1].venue, o.pair, BigInt(slippageBps), recipient as Address],
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
    // Stealth: swap the wallet's network RPC onto the private relay before
    // anything is signed; restored in `finally` no matter the outcome.
    let relayArmed = false;
    try {
      if (relay) {
        await wallet.setChainRpc(chain, relay, true);
        relayArmed = true;
        toast.info("Stealth relay armed", { description: relayHost || relay });
      }
      // 1. chainId: force the wallet onto the exact target chain and verify the
      //    provider actually reports it before anything is signed.
      const targetId = CHAIN_IDS[chain];
      if (wallet.chainIdNum !== targetId) await wallet.switchTo(chain);
      const live = Number(
        (await window.ethereum!.request({ method: "eth_chainId" })) as string,
      );
      if (live !== targetId) {
        throw new Error(`wrong network: wallet on ${live}, executor expects ${targetId}`);
      }

      const wc = wallet.walletClient();
      if (!wc) throw new Error("wallet unavailable");
      setBusy("signing");
      const call = buildCall();
      const pcPre = wallet.publicClientFor(chain);

      // 2. gas: estimate against head and add headroom, then price with
      //    EIP-1559 fields (Polygon requires a non-trivial priority fee).
      const gasEstimate = await pcPre.estimateContractGas({
        ...call,
        account: wallet.address,
      } as never);
      const gas = (gasEstimate * 125n) / 100n;

      const fees = await pcPre.estimateFeesPerGas();
      const maxPriorityFeePerGas =
        fees.maxPriorityFeePerGas && fees.maxPriorityFeePerGas > 0n
          ? (fees.maxPriorityFeePerGas * 125n) / 100n
          : 30_000_000_000n; // 30 gwei floor — Polygon drops lower tips
      const maxFeePerGas =
        fees.maxFeePerGas && fees.maxFeePerGas > maxPriorityFeePerGas
          ? (fees.maxFeePerGas * 125n) / 100n
          : maxPriorityFeePerGas * 2n;

      // 3. nonce: pin from the pending pool so back-to-back hunts from the same
      //    signer queue instead of colliding on a stale wallet-cached nonce.
      const nonce = await pcPre.getTransactionCount({
        address: wallet.address,
        blockTag: "pending",
      });

      setGasPlan({
        gas,
        maxFeeGwei: Number(maxFeePerGas) / 1e9,
        tipGwei: Number(maxPriorityFeePerGas) / 1e9,
        nonce,
        chainId: targetId,
      });

      const txHash = await wc.writeContract({
        ...call,
        account: wallet.address,
        chain: VIEM_CHAINS[chain],
        chainId: targetId,
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        nonce,
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
      if (relayArmed) {
        try {
          await wallet.setChainRpc(chain, settings.rpc[chain], false);
          toast.info("Public RPC restored", { description: "stealth relay disarmed" });
        } catch {
          toast.warning("Relay still active in wallet", {
            description: "restore the public RPC in your wallet's network settings",
          });
        }
      }
      setBusy("idle");
    }
  };

  const [quotes, setQuotes] = useState<{ buy: RouteQuote; sell: RouteQuote } | null>(null);
  const [quoting, setQuoting] = useState(false);

  useEffect(() => {
    setQuotes(null);
  }, [target]);

  const fetchQuotes = async () => {
    if (!chain || !asset || !quoteAsset || notionalUsd <= 0) return;
    setQuoting(true);
    setQuotes(null);
    try {
      const sellAmount = toUnits(notionalUsd, asset.decimals).toString();
      const buyLeg = await getRouteQuote({
        data: {
          chainId: CHAIN_IDS[chain],
          sellToken: asset.address,
          buyToken: quoteAsset.address,
          sellAmount,
          sellDecimals: asset.decimals,
          buyDecimals: quoteAsset.decimals,
          slippageBps,
          ...(wallet.address ? { taker: wallet.address } : {}),
        },
      });
      const back = buyLeg.ok ? (buyLeg.buyAmount ?? "0") : "0";
      const sellLeg =
        back !== "0"
          ? await getRouteQuote({
              data: {
                chainId: CHAIN_IDS[chain],
                sellToken: quoteAsset.address,
                buyToken: asset.address,
                sellAmount: back,
                sellDecimals: quoteAsset.decimals,
                buyDecimals: asset.decimals,
                slippageBps,
                ...(wallet.address ? { taker: wallet.address } : {}),
              },
            })
          : { ok: false, error: "skipped — first leg failed" };
      setQuotes({ buy: buyLeg, sell: sellLeg });
    } catch (e) {
      toast.error("0x quote failed", { description: (e as Error).message.slice(0, 140) });
    } finally {
      setQuoting(false);
    }
  };

  const roundTripUsd = (() => {
    if (!quotes?.sell.ok || !asset) return null;
    return Number(quotes.sell.buyAmount ?? 0) / 10 ** asset.decimals;
  })();

  const sendProfitCall = async (fn: "setProfitRecipient" | "sweep") => {
    if (!chain || !wallet.address || !asset || !isAddress(executor) || !isAddress(recipient)) return;
    try {
      if (wallet.chainIdNum !== CHAIN_IDS[chain]) await wallet.switchTo(chain);
      const wc = wallet.walletClient();
      if (!wc) throw new Error("wallet unavailable");
      const txHash = await wc.writeContract({
        address: executor as Address,
        abi: EXECUTOR_ABI,
        functionName: fn,
        args: fn === "sweep" ? [asset.address, recipient as Address] : [recipient as Address],
        account: wallet.address,
        chain: VIEM_CHAINS[chain],
      } as never);
      toast.success(fn === "sweep" ? "Sweeping profits to wallet" : "Profit recipient updated", {
        description: shortAddr(txHash),
      });
      await wallet.publicClientFor(chain).waitForTransactionReceipt({ hash: txHash });
      toast.success("Confirmed on-chain");
    } catch (e) {
      toast.error("Profit routing failed", {
        description: (e as Error).message.split("\n")[0]!.slice(0, 140),
      });
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
          <Row k="chain id" v={chain ? String(CHAIN_IDS[chain]) : "—"} />
          {gasPlan && (
            <>
              <Row k="gas limit" v={gasPlan.gas.toString()} />
              <Row
                k="max fee / tip"
                v={`${gasPlan.maxFeeGwei.toFixed(1)} / ${gasPlan.tipGwei.toFixed(1)} gwei`}
              />
              <Row k="nonce" v={String(gasPlan.nonce)} />
            </>
          )}
          <Row
            k="signer"
            v={wallet.address ? shortAddr(wallet.address) : "not connected"}
            tone={wallet.address ? undefined : "bad"}
          />
          {settings.stealthMode && (
            <>
              <Row
                k="broadcast"
                v={relay ? `private relay · ${relayHost || "custom"}` : "public mempool — no relay set"}
                tone={relay ? undefined : "bad"}
              />
              {stealthRotate && (
                <Row k="stealth payout" v={`${shortAddr(stealthPick)} · 1 of ${pool.length} rotated`} />
              )}
            </>
          )}

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

          <label className="block">
            <span className="label-xs">profit recipient (gas top-up wallet)</span>
            <Input
              value={settings.profitRecipient}
              spellCheck={false}
              placeholder={wallet.address ?? "0x… (defaults to connected wallet)"}
              onChange={(e) => update({ profitRecipient: e.target.value })}
              className="mt-1 h-8 border-border bg-background font-mono text-[11px]"
            />
            <span className="mt-1 block text-[10px] text-muted-foreground">
              profits route to {isAddress(recipient) ? shortAddr(recipient) : "— connect a wallet"}
            </span>
          </label>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 font-mono text-[10px] uppercase"
              disabled={!isAddress(recipient) || !isAddress(executor)}
              onClick={() => sendProfitCall("setProfitRecipient")}
            >
              set recipient
            </Button>
            <Button
              variant="outline"
              className="flex-1 font-mono text-[10px] uppercase"
              disabled={!isAddress(recipient) || !isAddress(executor)}
              onClick={() => sendProfitCall("sweep")}
            >
              sweep → wallet
            </Button>
          </div>

          {target?.kind === "arb" && (
            <div className="rounded-sm border border-border p-2">
              <div className="flex items-center justify-between">
                <span className="label-xs">0x swap route</span>
                <button
                  type="button"
                  onClick={fetchQuotes}
                  disabled={quoting}
                  className="rounded-sm border border-signal/50 bg-signal/10 px-2 py-0.5 text-[10px] uppercase text-signal hover:bg-signal/20 disabled:opacity-50"
                >
                  {quoting ? "quoting…" : "fetch quotes"}
                </button>
              </div>

              {quotes && (
                <div className="mt-2 space-y-1">
                  <Leg
                    label={`${asset?.symbol} → ${quoteAsset?.symbol}`}
                    q={quotes.buy}
                    decimals={quoteAsset?.decimals ?? 18}
                  />
                  <Leg
                    label={`${quoteAsset?.symbol} → ${asset?.symbol}`}
                    q={quotes.sell}
                    decimals={asset?.decimals ?? 6}
                  />
                  {roundTripUsd !== null && (
                    <Row
                      k="round-trip out"
                      v={`${usd(roundTripUsd)} (${roundTripUsd - notionalUsd >= 0 ? "+" : ""}${usd(
                        roundTripUsd - notionalUsd,
                      )})`}
                      tone={roundTripUsd < notionalUsd ? "bad" : undefined}
                    />
                  )}
                </div>
              )}
            </div>
          )}

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

function Leg({ label, q, decimals }: { label: string; q: RouteQuote; decimals: number }) {
  if (!q.ok) {
    return (
      <p className="break-all text-[10px] text-danger">
        {label}: {q.error ?? "no route"}
      </p>
    );
  }
  const out = Number(q.buyAmount ?? 0) / 10 ** decimals;
  return (
    <div className="text-[10px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-xs">{label}</span>
        <span className="tabular-nums text-foreground">
          {out.toLocaleString(undefined, { maximumFractionDigits: 6 })}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2 text-muted-foreground">
        <span>slippage {(q.slippagePct ?? 0).toFixed(2)}%</span>
        <span className="truncate">{(q.sources ?? []).join(" · ") || "—"}</span>
      </div>
    </div>
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
