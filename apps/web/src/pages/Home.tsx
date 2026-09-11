import { useEffect, useState } from 'react';
import * as api from '../apiClient.js';
import { useI18n } from '../i18n/index.js';
import { useSession } from '../state/SessionContext.js';
import { Screen } from '../design-system/Screen.js';
import { Card } from '../design-system/Card.js';
import { Stack, Row } from '../design-system/Stack.js';
import { Button } from '../design-system/Button.js';
import { formatMoney } from '../design-system/MoneyAmount.js';
import { Spinner, EmptyState, Badge } from '../design-system/Feedback.js';
import { ActivityRow } from './activity/ActivityRow.js';
import { useWalletBalance } from '../wallet/useWalletBalance.js';
import { shorten } from '../lib/format.js';
import type { AppRoute } from '../navigation/routes.js';

const BALANCE_HIDDEN_STORAGE_KEY = 'wallet.balanceHidden';

/**
 * Prompt 1/1.1 + Prompt 2 -- "Quantos USDT existem na minha carteira agora?" is the ONE question
 * Home answers with its primary number: the wallet's own on-chain balance, read via Ishtaran's
 * official WalletBalance capability (`useWalletBalance`, wrapping `client.walletBalance` through
 * apps/api's `walletBalanceReader`) -- never a local table, never the Ishtaran Ledger. The Ledger
 * answers a different, equally real question ("what does Ishtaran's own accounting say I'm
 * economically owed/reserved/delivered") -- shown separately below, its own section, never summed.
 */
export function HomePage({
  onNavigate,
  onNavigateToMove,
  refreshKey,
}: {
  onNavigate: (route: AppRoute) => void;
  onNavigateToMove: (mode: 'send' | 'pay') => void;
  refreshKey: number;
}) {
  const { t } = useI18n();
  const { session, appConfig } = useSession();
  const wallet = useWalletBalance(appConfig.environment);
  const [assets, setAssets] = useState<api.WalletAssetBalance[] | null>(null);
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [balanceHidden, setBalanceHidden] = useState(() => {
    try {
      return localStorage.getItem(BALANCE_HIDDEN_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<api.LedgerPosition | null>(null);
  const [history, setHistory] = useState<api.TransactionViewRow[] | null>(null);
  const [showLedgerDetails, setShowLedgerDetails] = useState(false);

  useEffect(() => {
    // Every one of these needs its own catch -- an unhandled rejection here previously left
    // `assets`/`ledger`/`history` stuck `null` forever (spinner with no way out) instead of
    // surfacing a real error the user can retry from (found live, fixed).
    api
      .getWalletAssetBalances()
      .then((r) => {
        setAssets(r.assets);
        setAssetsError(null);
      })
      .catch((err) => setAssetsError(err instanceof Error ? err.message : String(err)));
    api.getLedgerPosition().then(setLedger).catch(() => undefined);
    api
      .getHistory()
      .then((rows) => setHistory(rows.slice(0, 5)))
      .catch(() => setHistory([]));
  }, [refreshKey]);

  // A completed Send/Pay/Deposit elsewhere in the app bumps refreshKey -- pull an authoritative
  // number right away rather than waiting for the next 30s tick (Prompt 2 §17).
  useEffect(() => {
    if (refreshKey > 0) wallet.bumpAfterAction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  function toggleBalanceHidden() {
    setBalanceHidden((v) => {
      const next = !v;
      try {
        localStorage.setItem(BALANCE_HIDDEN_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Private mode/blocked storage -- the toggle still works for this session, just doesn't persist.
      }
      return next;
    });
  }

  const primaryAsset = assets?.[0] ?? null;
  const primaryNetwork = primaryAsset?.networkBalances[0] ?? null;
  const displayBalance = primaryAsset?.aggregateBalance ?? wallet.snapshot?.balance ?? null;
  const freshnessLabel = describeFreshness(wallet.snapshot, t);

  return (
    <Screen
      trailing={
        <Row gap={2}>
          {appConfig.environment === 'sandbox' && <Badge tone="feeNetwork">🧪 {t('home', 'sandboxBadge')}</Badge>}
          <Badge tone="neutral">👤 {session.email}</Badge>
        </Row>
      }
    >
      <Stack gap={1}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', fontWeight: 600 }}>
          {t('home', 'greeting')} · {t('home', 'yourWallet')}
        </span>
      </Stack>

      <Card
        style={{
          background: 'linear-gradient(160deg, var(--color-brand) 0%, var(--color-brand-strong) 100%)',
          border: 'none',
          color: 'var(--color-text-on-brand)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Stack gap={3}>
          <Row justify="space-between" align="flex-start">
            <span style={{ fontSize: 'var(--font-size-sm)', opacity: 0.85, fontWeight: 600 }}>{t('home', 'totalBalanceLabel')}</span>
            <button
              onClick={toggleBalanceHidden}
              aria-label={t('home', balanceHidden ? 'showBalanceAction' : 'hideBalanceAction')}
              style={{ background: 'rgba(255,255,255,0.16)', border: 'none', borderRadius: 'var(--radius-pill)', width: 32, height: 32, color: 'inherit', fontSize: 14 }}
            >
              {balanceHidden ? '🙈' : '👁️'}
            </button>
          </Row>

          {displayBalance === null && wallet.error ? (
            <Stack gap={2}>
              <span style={{ fontSize: 'var(--font-size-sm)' }}>⚠️ {t('home', 'balanceLoadError')}</span>
              <button
                onClick={wallet.manualRefresh}
                style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.16)', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 14px', color: 'inherit', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}
              >
                {t('home', 'retryAction')}
              </button>
            </Stack>
          ) : displayBalance === null ? (
            <Spinner />
          ) : (
            <span style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 800, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
              {balanceHidden ? '•••••• USDT' : formatMoney(displayBalance)}
            </span>
          )}

          <Row justify="space-between" align="center">
            <Row gap={1} align="center">
              {wallet.refreshing ? (
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.85 }}>{t('home', 'refreshing')}</span>
              ) : (
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.85 }}>{freshnessLabel}</span>
              )}
            </Row>
            <button
              onClick={wallet.manualRefresh}
              disabled={wallet.refreshing}
              aria-label={t('home', 'refreshAction')}
              style={{ background: 'rgba(255,255,255,0.16)', border: 'none', borderRadius: 'var(--radius-pill)', width: 32, height: 32, color: 'inherit', fontSize: 14, opacity: wallet.refreshing ? 0.6 : 1 }}
            >
              🔄
            </button>
          </Row>

          {appConfig.environment === 'sandbox' && (
            <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7 }}>{t('home', 'sandboxDisclaimer')}</span>
          )}
        </Stack>
      </Card>

      <Row gap={2}>
        <Button compact onClick={() => onNavigateToMove('send')} style={{ flex: 1 }}>
          ↗️ {t('home', 'send')}
        </Button>
        <Button compact variant="secondary" onClick={() => onNavigateToMove('pay')} style={{ flex: 1 }}>
          🧾 {t('home', 'pay')}
        </Button>
        <Button compact variant="secondary" onClick={() => onNavigate('receive')} style={{ flex: 1 }}>
          ↙️ {t('home', 'receive')}
        </Button>
      </Row>

      {/* Prompt 2 §5/§6 -- multi-asset carousel. Today renders exactly one card (USDT) because
          that is the only Asset this deployment actually supports -- the component itself never
          hardcodes "there is one asset"; a second real AssetNetwork would just add a second card. */}
      {assets && assets.length > 0 && (
        <Stack gap={2}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', overflowX: 'auto', paddingBottom: 'var(--space-1)' }}>
            {assets.map((asset) => (
              <div key={asset.assetId} style={{ minWidth: 220, flex: '0 0 auto' }}>
                <Card padSm flat style={{ border: '1px solid var(--color-border)' }}>
                  <Stack gap={2}>
                    <Row justify="space-between">
                      <span style={{ fontWeight: 700 }}>{asset.assetSymbol}</span>
                      <span style={{ fontWeight: 700 }}>{formatMoney(asset.aggregateBalance, asset.assetSymbol)}</span>
                    </Row>
                    {asset.networkBalances.length > 0 && (
                      <button
                        onClick={() => setExpandedAssetId((cur) => (cur === asset.assetId ? null : asset.assetId))}
                        style={{ background: 'none', border: 'none', color: 'var(--color-brand)', fontSize: 'var(--font-size-xs)', fontWeight: 600, textAlign: 'left', padding: 0 }}
                      >
                        {expandedAssetId === asset.assetId ? t('home', 'hideByNetworkAction') : t('home', 'viewByNetworkAction')}
                      </button>
                    )}
                    {expandedAssetId === asset.assetId && (
                      <Stack gap={1} style={{ marginTop: 'var(--space-1)' }}>
                        {asset.networkBalances.map((nb) => (
                          <Row key={nb.assetNetworkId} justify="space-between">
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{nb.networkCode}</span>
                            <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>{formatMoney(nb.balance, asset.assetSymbol)}</span>
                          </Row>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </Card>
              </div>
            ))}
          </div>
          {primaryNetwork && wallet.snapshot && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)' }}>
              {t('home', 'addressLabel')}: {shorten(wallet.snapshot.address)}
            </span>
          )}
        </Stack>
      )}

      <Card padSm>
        <Stack gap={2}>
          <button
            onClick={() => setShowLedgerDetails((v) => !v)}
            style={{ background: 'none', border: 'none', textAlign: 'left', display: 'flex', justifyContent: 'space-between', width: '100%' }}
          >
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700 }}>📒 {t('home', 'ledgerPositionLabel')}</span>
            <span style={{ color: 'var(--color-text-faint)' }}>{showLedgerDetails ? '▲' : '▼'}</span>
          </button>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', margin: 0 }}>{t('home', 'ledgerPositionHint')}</p>
          {showLedgerDetails && ledger && (
            <Stack gap={2} style={{ marginTop: 'var(--space-2)' }}>
              <Row justify="space-between">
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('home', 'ledgerAvailable')}</span>
                <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>{ledger.available} USDT</span>
              </Row>
              <Row justify="space-between">
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('home', 'ledgerReserved')}</span>
                <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>{ledger.reserved} USDT</span>
              </Row>
              <Row justify="space-between">
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('home', 'ledgerPayable')}</span>
                <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>{ledger.payable} USDT</span>
              </Row>
              <Row justify="space-between">
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('home', 'ledgerDelivered')}</span>
                <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>{ledger.delivered} USDT</span>
              </Row>
            </Stack>
          )}
        </Stack>
      </Card>

      <Stack gap={3}>
        <Row justify="space-between">
          <h2 style={{ fontSize: 'var(--font-size-md)', fontWeight: 700 }}>{t('home', 'recentActivity')}</h2>
          {history && history.length > 0 && (
            <button onClick={() => onNavigate('activity')} style={{ background: 'none', border: 'none', color: 'var(--color-brand)', fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
              {t('home', 'viewAllActivity')}
            </button>
          )}
        </Row>
        {history === null ? (
          <Spinner />
        ) : history.length === 0 ? (
          <Card>
            <EmptyState icon="📭" title={t('home', 'emptyActivityTitle')} body={t('home', 'emptyActivityBody')} />
          </Card>
        ) : (
          <Card padSm>
            <Stack gap={0}>
              {history.map((row, i) => (
                <ActivityRow key={row.id} row={row} divider={i > 0} />
              ))}
            </Stack>
          </Card>
        )}
      </Stack>
    </Screen>
  );
}

function describeFreshness(snapshot: api.WalletBalanceSnapshot | null, t: ReturnType<typeof useI18n>['t']): string {
  if (!snapshot || !snapshot.observedAt) return t('home', 'neverUpdated');
  const ageMs = Date.now() - new Date(snapshot.observedAt).getTime();
  if (ageMs < 45_000) return t('home', 'updatedNow');
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  return t('home', 'updatedMinutesAgo', { minutes });
}
