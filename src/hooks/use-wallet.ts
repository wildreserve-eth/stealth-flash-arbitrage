import { useCallback, useEffect, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  formatGwei,
  http,
  type Address,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient,
} from "viem";
import { CHAIN_IDS, VIEM_CHAINS, chainIdToKey } from "@/lib/executor";
import type { ChainId } from "@/lib/hunter-engine";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export type WalletState = {
  available: boolean;
  address: Address | null;
  chainKey: ChainId | null;
  chainIdNum: number | null;
  balance: string;
  gasGwei: string;
  connecting: boolean;
  error: string | null;
};

export function useWallet(rpc: Record<ChainId, string>) {
  const [state, setState] = useState<WalletState>({
    available: false,
    address: null,
    chainKey: null,
    chainIdNum: null,
    balance: "—",
    gasGwei: "—",
    connecting: false,
    error: null,
  });

  useEffect(() => {
    setState((s) => ({ ...s, available: typeof window !== "undefined" && !!window.ethereum }));
  }, []);

  const readAccount = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) return;
    const accounts = (await eth.request({ method: "eth_accounts" })) as Address[];
    const address = accounts[0] ?? null;
    const idHex = (await eth.request({ method: "eth_chainId" })) as string;
    const chainIdNum = Number(idHex);
    setState((s) => ({ ...s, address, chainIdNum, chainKey: chainIdToKey(chainIdNum) ?? null }));
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    void readAccount();
    const eth = window.ethereum;
    const onAccounts = () => void readAccount();
    const onChain = () => void readAccount();
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [readAccount]);

  const publicClientFor = useCallback(
    (chain: ChainId): PublicClient =>
      createPublicClient({
        chain: VIEM_CHAINS[chain],
        transport: http(rpc[chain] || undefined),
      }) as PublicClient,
    [rpc],
  );

  const walletClient = useCallback((): WalletClient | null => {
    if (!window.ethereum) return null;
    return createWalletClient({ transport: custom(window.ethereum) });
  }, []);

  // Poll native balance + gas on the wallet's active chain.
  useEffect(() => {
    const { address, chainKey } = state;
    if (!address || !chainKey) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const pc = publicClientFor(chainKey);
        const [bal, gas] = await Promise.all([
          pc.getBalance({ address }),
          pc.getGasPrice(),
        ]);
        if (cancelled) return;
        setState((s) => ({
          ...s,
          balance: Number(formatEther(bal)).toFixed(5),
          gasGwei: Number(formatGwei(gas)).toFixed(3),
          error: null,
        }));
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: (e as Error).message.slice(0, 120) }));
      }
    };
    void tick();
    const t = setInterval(tick, 12_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [state.address, state.chainKey, publicClientFor]);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) {
      setState((s) => ({ ...s, error: "No injected wallet found. Install MetaMask or Rabby." }));
      return;
    }
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      await eth.request({ method: "eth_requestAccounts" });
      await readAccount();
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message.slice(0, 140) }));
    } finally {
      setState((s) => ({ ...s, connecting: false }));
    }
  }, [readAccount]);

  const disconnect = useCallback(() => {
    setState((s) => ({ ...s, address: null, balance: "—", gasGwei: "—" }));
  }, []);

  const switchTo = useCallback(
    async (chain: ChainId) => {
      const eth = window.ethereum;
      if (!eth) return;
      const hex = `0x${CHAIN_IDS[chain].toString(16)}`;
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
      } catch {
        const c = VIEM_CHAINS[chain];
        const req = eth.request as unknown as (a: { method: string; params?: unknown }) => Promise<unknown>;
        await req({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hex,
              chainName: c.name,
              nativeCurrency: c.nativeCurrency,
              rpcUrls: [rpc[chain] || c.rpcUrls.default.http[0]],
              blockExplorerUrls: c.blockExplorers ? [c.blockExplorers.default.url] : [],
            },
          ],
        });
      }
      await readAccount();
    },
    [rpc, readAccount],
  );

  return { ...state, connect, disconnect, switchTo, publicClientFor, walletClient };
}
