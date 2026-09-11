import { useEffect, useState } from 'react';
import * as api from '../../apiClient.js';
import { useI18n } from '../../i18n/index.js';
import { Screen } from '../../design-system/Screen.js';
import { Card } from '../../design-system/Card.js';
import { Stack, Row } from '../../design-system/Stack.js';
import { Button } from '../../design-system/Button.js';
import { TextField } from '../../design-system/TextField.js';
import { Banner, Spinner, Badge } from '../../design-system/Feedback.js';
import { formatMoney } from '../../design-system/MoneyAmount.js';
import { shorten } from '../../lib/format.js';

export function RevenuePage() {
  const { t } = useI18n();
  const [ownerSessionToken, setOwnerSessionToken] = useState<string | null>(api.getOwnerSessionToken());

  if (!ownerSessionToken) {
    return <OwnerGate onSignedIn={setOwnerSessionToken} />;
  }
  return <RevenueDashboard ownerSessionToken={ownerSessionToken} onSignOut={() => setOwnerSessionToken(null)} />;
}

function OwnerGate({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const { t } = useI18n();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setError(null);
    setBusy(true);
    try {
      const result = await api.ownerLogin(token);
      api.setOwnerSessionToken(result.sessionToken);
      onSignedIn(result.sessionToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t('revenue', 'title')}>
      <Card style={{ background: 'linear-gradient(135deg, #1f2937, #111827)', border: 'none', color: '#fff' }}>
        <Stack gap={2}>
          <Badge tone="neutral" >
            🏢 {t('revenue', 'operatorBadge')}
          </Badge>
          <span style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)' }}>{t('revenue', 'ownerGateTitle')}</span>
          <p style={{ fontSize: 'var(--font-size-sm)', opacity: 0.8 }}>{t('revenue', 'ownerGateBody')}</p>
        </Stack>
      </Card>
      <Card>
        <Stack gap={4}>
          {error && <Banner tone="danger">{error}</Banner>}
          <TextField label={t('revenue', 'ownerTokenLabel')} type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSignIn()} />
          <Button busy={busy} disabled={!token} onClick={handleSignIn}>
            {t('revenue', 'ownerSignIn')}
          </Button>
        </Stack>
      </Card>
    </Screen>
  );
}

function RevenueDashboard({ ownerSessionToken, onSignOut }: { ownerSessionToken: string; onSignOut: () => void }) {
  const { t } = useI18n();
  const [walletBalance, setWalletBalance] = useState<api.WalletBalanceSnapshot | null>(null);
  const [balance, setBalance] = useState<api.RevenueBalance | null>(null);
  const [analytics, setAnalytics] = useState<api.RevenueAnalytics | null>(null);
  const [events, setEvents] = useState<api.RevenueEventRow[] | null>(null);

  useEffect(() => {
    api.getOwnerWalletBalance(ownerSessionToken).then(setWalletBalance);
    api.getRevenueBalance(ownerSessionToken).then(setBalance);
    api.getRevenueAnalytics(ownerSessionToken).then(setAnalytics);
    api.getRevenueHistory(ownerSessionToken).then((rows) => setEvents(rows.slice(0, 10)));
  }, [ownerSessionToken]);

  return (
    <Screen
      title={t('revenue', 'title')}
      trailing={
        <button
          onClick={() => {
            api.clearOwnerSessionToken();
            onSignOut();
          }}
          style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', fontWeight: 600 }}
        >
          {t('common', 'logOut')}
        </button>
      }
    >
      <Card style={{ background: 'linear-gradient(135deg, #1f2937, #111827)', border: 'none', color: '#fff' }}>
        <Stack gap={2}>
          <Badge tone="neutral">🏢 {t('revenue', 'operatorBadge')}</Badge>
          <span style={{ fontSize: 'var(--font-size-sm)', opacity: 0.8, fontWeight: 600 }}>{t('revenue', 'appWalletTitle')}</span>
          {walletBalance ? (
            <span style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 800 }}>{formatMoney(walletBalance.balance)}</span>
          ) : (
            <Spinner />
          )}
          <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7, margin: 0 }}>{t('revenue', 'appWalletBody')}</p>
          {walletBalance && (
            <Row justify="space-between" style={{ marginTop: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7 }}>{t('home', 'addressLabel')}</span>
              <span style={{ fontSize: 'var(--font-size-xs)', fontFamily: 'var(--font-mono)' }}>{shorten(walletBalance.address)}</span>
            </Row>
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap={2}>
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700 }}>{t('revenue', 'balanceLabel')}</span>
          {balance ? (
            <span style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800 }}>{formatMoney(balance.available)}</span>
          ) : (
            <Spinner />
          )}
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', margin: 0 }}>{t('revenue', 'ledgerHint')}</p>
        </Stack>
      </Card>

      {analytics && (
        <Card>
          <Stack gap={3}>
            <Row justify="space-between">
              <span style={{ color: 'var(--color-text-muted)' }}>{t('revenue', 'totalPayments')}</span>
              <span style={{ fontWeight: 700 }}>{analytics.totalPayments}</span>
            </Row>
            <Stack gap={2}>
              <span style={{ fontWeight: 700, fontSize: 'var(--font-size-sm)' }}>{t('revenue', 'byEventTitle')}</span>
              {analytics.byEvent.map((row) => (
                <Row key={row.rule_event} justify="space-between">
                  <span style={{ fontSize: 'var(--font-size-sm)' }}>{row.rule_event}</span>
                  <span style={{ fontSize: 'var(--font-size-sm)' }}>
                    {row.count}× · {row.totalRevenue.toFixed(2)} USDT
                  </span>
                </Row>
              ))}
            </Stack>
          </Stack>
        </Card>
      )}

      <Stack gap={3}>
        <h2 style={{ fontSize: 'var(--font-size-md)', fontWeight: 700 }}>{t('revenue', 'recentEvents')}</h2>
        {events === null ? (
          <Spinner />
        ) : events.length === 0 ? (
          <Card>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', textAlign: 'center' }}>{t('revenue', 'noEvents')}</p>
          </Card>
        ) : (
          <Card padSm>
            <Stack gap={0}>
              {events.map((e, i) => (
                <Row key={e.id} justify="space-between" style={{ padding: 'var(--space-3) 0', borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}>
                  <span style={{ fontSize: 'var(--font-size-sm)' }}>{e.rule_event}</span>
                  <span style={{ fontWeight: 600 }}>{e.amount} USDT</span>
                </Row>
              ))}
            </Stack>
          </Card>
        )}
      </Stack>
    </Screen>
  );
}
