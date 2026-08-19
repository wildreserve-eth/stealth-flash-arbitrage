import { CHAIN_IDS, EXPLORER, shortAddr } from "@/lib/executor";
import type { ChainId } from "@/lib/hunter-engine";
import type { useWallet } from "@/hooks/use-wallet";
import { cn } from "@/lib/utils";

type Wallet = ReturnType<typeof useWallet>;

const CHAINS: ChainId[] = ["base", "scroll", "polygon"];

export function WalletBar({ wallet }: { wallet: Wallet }) {
  const connected = !!wallet.address;

  return (
    <div className="panel mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 font-mono text-[11px]">
      <span className="label-xs">wallet</span>

      {connected ? (
        <>
          <a
            href={
              wallet.chainKey
                ? `${EXPLORER[wallet.chainKey]}/address/${wallet.address}`
                : undefined
            }
            target="_blank"
            rel="noreferrer"
            className="text-signal signal-glow underline-offset-2 hover:underline"
          >
            {shortAddr(wallet.address!)}
          </a>
          <Cell k="network" v={wallet.chainKey ?? `chain ${wallet.chainIdNum ?? "?"}`} />
          <Cell k="balance" v={wallet.balance} />
          <Cell k="gas" v={`${wallet.gasGwei} gwei`} />

          <div className="flex items-center gap-1">
            {CHAINS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => void wallet.switchTo(c)}
                className={cn(
                  "rounded-sm border px-2 py-1 text-[10px] uppercase transition-colors",
                  wallet.chainIdNum === CHAIN_IDS[c]
                    ? "border-signal/50 bg-signal/10 text-signal"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {c}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={wallet.disconnect}
            className="ml-auto rounded-sm border border-border px-2.5 py-1 text-[10px] uppercase text-muted-foreground hover:text-foreground"
          >
            disconnect
          </button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">
            {wallet.available ? "MetaMask detected — not connected" : "no injected wallet found"}
          </span>
          <button
            type="button"
            onClick={() => void wallet.connect()}
            disabled={wallet.connecting}
            className="ml-auto rounded-sm border border-signal/50 bg-signal/10 px-3 py-1.5 text-[10px] uppercase text-signal transition-colors hover:bg-signal/20 disabled:opacity-50"
          >
            {wallet.connecting ? "connecting…" : "connect metamask"}
          </button>
          {!wallet.available && (
            <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noreferrer"
              className="text-[10px] uppercase text-muted-foreground underline"
            >
              install
            </a>
          )}
        </>
      )}

      {wallet.error && <span className="w-full text-[10px] text-danger">{wallet.error}</span>}
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="label-xs">{k}</div>
      <div className="tabular-nums">{v}</div>
    </div>
  );
}
