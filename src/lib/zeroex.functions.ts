import { createServerFn } from "@tanstack/react-start";

export type RouteQuote = {
  ok: boolean;
  error?: string;
  sellAmount?: string;
  buyAmount?: string;
  minBuyAmount?: string;
  /** buyAmount / sellAmount, normalized by decimals. */
  rate?: number;
  /** Guaranteed slippage between quoted and minimum output, in %. */
  slippagePct?: number;
  networkFeeWei?: string;
  sources?: string[];
};

type Input = {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  sellDecimals: number;
  buyDecimals: number;
  slippageBps: number;
  taker?: string;
};

/**
 * 0x Swap API (v2, allowance-holder) price probe for a single arbitrage leg.
 * Read-only: returns routing output so the operator can compare the modeled
 * spread against real on-chain liquidity before signing.
 */
export const getRouteQuote = createServerFn({ method: "POST" })
  .inputValidator((data: Input) => data)
  .handler(async ({ data }): Promise<RouteQuote> => {
    const key = process.env["ZEROEX_API_KEY"];
    if (!key) return { ok: false, error: "ZEROEX_API_KEY not configured" };

    const url = new URL("https://api.0x.org/swap/allowance-holder/price");
    url.searchParams.set("chainId", String(data.chainId));
    url.searchParams.set("sellToken", data.sellToken);
    url.searchParams.set("buyToken", data.buyToken);
    url.searchParams.set("sellAmount", data.sellAmount);
    url.searchParams.set("slippageBps", String(data.slippageBps));
    if (data.taker) url.searchParams.set("taker", data.taker);

    try {
      const res = await fetch(url, {
        headers: { "0x-api-key": key, "0x-version": "v2" },
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const msg =
          (body["reason"] as string) ?? (body["message"] as string) ?? `0x error ${res.status}`;
        return { ok: false, error: String(msg).slice(0, 200) };
      }

      const buyAmount = String(body["buyAmount"] ?? "0");
      const minBuyAmount = String(body["minBuyAmount"] ?? buyAmount);
      const sell = Number(data.sellAmount) / 10 ** data.sellDecimals;
      const buy = Number(buyAmount) / 10 ** data.buyDecimals;
      const min = Number(minBuyAmount) / 10 ** data.buyDecimals;

      const route = body["route"] as { fills?: { source?: string }[] } | undefined;
      const sources = [
        ...new Set((route?.fills ?? []).map((f) => f.source ?? "").filter(Boolean)),
      ].slice(0, 4);

      const fees = body["totalNetworkFee"];

      return {
        ok: true,
        sellAmount: data.sellAmount,
        buyAmount,
        minBuyAmount,
        rate: sell > 0 ? buy / sell : 0,
        slippagePct: buy > 0 ? ((buy - min) / buy) * 100 : 0,
        networkFeeWei: fees ? String(fees) : undefined,
        sources,
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 200) };
    }
  });
