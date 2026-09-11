import { useCallback, useEffect, useState } from 'react';
import * as api from '../apiClient.js';
import { checkForBalanceChange } from './clientSideBalanceDetector.js';

const FOREGROUND_POLL_MS = 30_000;

export type WalletBalanceState = {
  snapshot: api.WalletBalanceSnapshot | null;
  /** True only while the very first fetch is in flight -- never re-shown on background polls/refreshes (avoids UI flicker). */
  initialLoading: boolean;
  /** True while an explicit, user-visible refresh (manual button or a just-completed action) is in flight. */
  refreshing: boolean;
  /** Set when the most recent fetch/refresh attempt failed outright (network down, session no longer valid, etc) -- distinct from the platform's own `refreshFailureReason` on a successful-but-stale snapshot. Cleared on the next successful call. */
  error: string | null;
  /** Manual "atualizar" button -- always authoritative (Prompt 2 §4). */
  manualRefresh: () => void;
};

/**
 * Prompt 2 §8-9 -- the wallet's own on-chain balance, kept fresh via:
 *  1. An initial fetch on mount (cheap -- last known snapshot).
 *  2. A re-fetch on foreground return (visibilitychange) and ~every 30s while visible -- always
 *     the CHEAP `getBalance` (never the expensive `refreshBalance`), which already reflects
 *     whatever the platform's own event-driven refresh / background reconciliation observed
 *     server-side (Prompt 1.1) -- this is how the UI picks up a server-driven update without a
 *     manual reload, never by itself hitting the RPC/provider.
 *  3. On each of those ticks, in Production only, the device independently re-checks the public
 *     chain (clientSideBalanceDetector.ts) and escalates to the expensive, authoritative
 *     `refreshBalance` ONLY if it disagrees with the just-fetched snapshot -- never on a match,
 *     never in Sandbox (no independent chain to read there, see that file's header).
 *  4. Nothing runs at all while the document is hidden (background) -- no battery/network waste.
 *  5. `bumpAfterAction()` lets a caller (MoveFlow, Sandbox deposit sheet) force an immediate,
 *     authoritative refresh right after an action it knows changed the balance, rather than
 *     waiting for the next 30s tick (Prompt 2 §17, event-driven UI).
 *
 * Every network call in this hook is wrapped so a failure NEVER leaves `initialLoading`/
 * `refreshing` stuck `true` forever (an unhandled rejection here previously meant the UI spun
 * indefinitely instead of showing an error -- found live, fixed) -- `error` is set instead, and
 * the caller can offer a retry.
 */
export function useWalletBalance(environment: 'sandbox' | 'production'): WalletBalanceState & { bumpAfterAction: () => void } {
  const [snapshot, setSnapshot] = useState<api.WalletBalanceSnapshot | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  function describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  const cheapTick = useCallback(async () => {
    const fresh = await api.getWalletBalance();
    setSnapshot(fresh);
    setError(null);

    const detection = await checkForBalanceChange({
      environment,
      address: fresh.address,
      lastKnownBalance: fresh.balance,
    });
    if (detection.status === 'checked_changed') {
      const authoritative = await api.refreshWalletBalance().catch(() => null);
      if (authoritative) setSnapshot(authoritative);
    }
  }, [environment]);

  const manualRefresh = useCallback(() => {
    setRefreshing(true);
    api
      .refreshWalletBalance()
      .then((fresh) => {
        setSnapshot(fresh);
        setError(null);
      })
      .catch((err) => setError(describeError(err)))
      .finally(() => setRefreshing(false));
  }, []);

  const bumpAfterAction = useCallback(() => {
    setRefreshing(true);
    api
      .getWalletBalance()
      .then((fresh) => {
        setSnapshot(fresh);
        setError(null);
      })
      .catch((err) => setError(describeError(err)))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    async function initial() {
      try {
        const fresh = await api.getWalletBalance();
        if (!cancelled) {
          setSnapshot(fresh);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }

    function startPolling() {
      stopPolling();
      intervalId = setInterval(() => {
        cheapTick().catch((err) => setError(describeError(err)));
      }, FOREGROUND_POLL_MS);
    }

    function stopPolling() {
      if (intervalId) clearInterval(intervalId);
      intervalId = undefined;
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        cheapTick().catch((err) => setError(describeError(err)));
        startPolling();
      } else {
        stopPolling();
      }
    }

    initial().then(() => {
      if (!cancelled && document.visibilityState === 'visible') startPolling();
    });
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [cheapTick, retryToken]);

  const manualRefreshOrRetry = useCallback(() => {
    if (!snapshot && error) {
      // Never observed anything successfully yet -- re-run the initial fetch, not just `refresh`
      // (which would still fail identically without re-establishing anything).
      setInitialLoading(true);
      setError(null);
      setRetryToken((t) => t + 1);
      return;
    }
    manualRefresh();
  }, [snapshot, error, manualRefresh]);

  return { snapshot, initialLoading, refreshing, error, manualRefresh: manualRefreshOrRetry, bumpAfterAction };
}
