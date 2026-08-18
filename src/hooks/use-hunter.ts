import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAINS,
  DEFAULT_SETTINGS,
  makeLiquidation,
  makeOpportunity,
  type ChainId,
  type HunterSettings,
  type Liquidation,
  type Opportunity,
} from "@/lib/hunter-engine";

const STORAGE_KEY = "hunter.settings.v1";

export type ChainStat = {
  id: ChainId;
  block: number;
  latencyMs: number;
  gas: number;
  pending: number;
  online: boolean;
};

export function useHunter() {
  const [settings, setSettings] = useState<HunterSettings>(DEFAULT_SETTINGS);
  const [running, setRunning] = useState(true);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [liqs, setLiqs] = useState<Liquidation[]>([]);
  const [stats, setStats] = useState<ChainStat[]>(() =>
    CHAINS.map((c) => ({
      id: c.id,
      block: 0,
      latencyMs: 0,
      gas: 0,
      pending: 0,
      online: true,
    })),
  );
  const [realized, setRealized] = useState({ net: 0, wins: 0, misses: 0, loans: 0 });

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Restore operator config after hydration only.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    } catch {
      /* ignore malformed config */
    }
  }, []);

  const update = useCallback((patch: Partial<HunterSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  // Chain watcher heartbeat.
  useEffect(() => {
    const t = setInterval(() => {
      setStats((prev) =>
        prev.map((s) => {
          const enabled = settingsRef.current.chains[s.id];
          return {
            ...s,
            online: enabled,
            block: enabled ? s.block + (Math.random() > 0.35 ? 1 : 0) : s.block,
            latencyMs: enabled ? Math.round(28 + Math.random() * 180) : 0,
            gas: enabled
              ? Number(
                  (s.id === "polygon"
                    ? 24 + Math.random() * 60
                    : 0.01 + Math.random() * 0.4
                  ).toFixed(3),
                )
              : 0,
            pending: enabled ? Math.round(40 + Math.random() * 900) : 0,
          };
        }),
      );
    }, 1200);
    return () => clearInterval(t);
  }, []);

  // Seed block heights once on the client (avoids SSR randomness).
  useEffect(() => {
    setStats((prev) =>
      prev.map((s) => ({ ...s, block: Math.floor(12_000_000 + Math.random() * 8_000_000) })),
    );
  }, []);

  // Opportunity + liquidation scanner.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const s = settingsRef.current;
      const active = CHAINS.filter((c) => s.chains[c.id]).map((c) => c.id);
      if (active.length === 0) return;
      const chain = active[Math.floor(Math.random() * active.length)]!;

      if (Math.random() > 0.28) {
        const o = makeOpportunity(chain, s);
        setOpps((prev) => [o, ...prev].slice(0, 40));
        if (o.status === "armed") {
          setRealized((r) => ({
            net: r.net + o.netUsd,
            wins: r.wins + 1,
            misses: r.misses,
            loans: r.loans + o.loanUsd,
          }));
        } else if (o.status === "thin") {
          setRealized((r) => ({ ...r, misses: r.misses + 1 }));
        }
      } else {
        const l = makeLiquidation(chain, s);
        setLiqs((prev) => [l, ...prev].slice(0, 24));
        if (l.status === "closed") {
          setRealized((r) => ({ ...r, net: r.net + l.netUsd, wins: r.wins + 1 }));
        }
      }
    }, 1500);
    return () => clearInterval(t);
  }, [running]);

  const reset = useCallback(() => {
    setOpps([]);
    setLiqs([]);
    setRealized({ net: 0, wins: 0, misses: 0, loans: 0 });
  }, []);

  return { settings, update, running, setRunning, opps, liqs, stats, realized, reset };
}
