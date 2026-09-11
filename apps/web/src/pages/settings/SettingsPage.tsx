import { useEffect, useState } from 'react';
import * as api from '../../apiClient.js';
import { useI18n, LOCALES, type Locale } from '../../i18n/index.js';
import { useSession } from '../../state/SessionContext.js';
import { getReceivingAddress, forgetWallet } from '../../wallet/localWallet.js';
import { clearSessionToken } from '../../apiClient.js';
import { Screen } from '../../design-system/Screen.js';
import { Card } from '../../design-system/Card.js';
import { Stack, Row } from '../../design-system/Stack.js';
import { Button } from '../../design-system/Button.js';
import { MoneyAmount } from '../../design-system/MoneyAmount.js';
import { RevealRecoveryPhraseSheet } from './RevealRecoveryPhraseSheet.js';
import { ForgetWalletSheet } from './ForgetWalletSheet.js';
import { WithdrawSheet } from './WithdrawSheet.js';
import { DemoDepositSheet } from './DemoDepositSheet.js';

type OpenSheet = 'none' | 'reveal' | 'forget' | 'withdraw' | 'demoDeposit';

export function SettingsPage({ onLoggedOut, onDataChanged }: { onLoggedOut: () => void; onDataChanged: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const { session, appConfig, logOut } = useSession();
  const [address, setAddress] = useState('');
  const [showDeveloperInfo, setShowDeveloperInfo] = useState(false);
  const [openSheet, setOpenSheet] = useState<OpenSheet>('none');
  const [walletBalance, setWalletBalance] = useState<string | null>(null);

  useEffect(() => {
    getReceivingAddress().then((a) => setAddress(a ?? ''));
    api.getWalletBalance().then((r) => setWalletBalance(r.balance));
  }, []);

  function handleLogOut() {
    clearSessionToken();
    logOut();
    onLoggedOut();
  }

  async function handleForgetWallet() {
    await forgetWallet();
    clearSessionToken();
    logOut();
    onLoggedOut();
  }

  return (
    <Screen title={t('settings', 'title')}>
      {/* Sandbox Tools -- the honest, explicit path to test funds (GAPS.md G.5). Placed first,
          not buried, since without it most of the app's own primary actions (Send) are blocked.
          Only ever shown in Sandbox -- "Simular depósito" hits ProductionWalletChainActions'
          honest "not applicable in Production" error otherwise (real, not silently broken), but
          the UI itself should never offer an action that can never work in this environment
          (found live during Prompt 2 manual review -- this gate was previously missing). */}
      {appConfig.environment === 'sandbox' && (
        <Card style={{ background: 'linear-gradient(135deg, var(--color-fee-network-soft), var(--color-surface))', border: '1px solid var(--color-fee-network)' }}>
          <Stack gap={3}>
            <Row justify="space-between" align="flex-start">
              <span style={{ fontWeight: 700 }}>🧪 {t('settings', 'sandboxTools')}</span>
            </Row>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{t('settings', 'sandboxToolsBody')}</p>
            <Stack gap={1}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 600 }}>{t('settings', 'sandboxWalletBalance')}</span>
              {walletBalance !== null && <MoneyAmount amount={walletBalance} size="lg" />}
            </Stack>
            <Button onClick={() => setOpenSheet('demoDeposit')}>{t('settings', 'simulateDeposit')}</Button>
          </Stack>
        </Card>
      )}

      <Card>
        <Stack gap={3}>
          <span style={{ fontWeight: 700 }}>👤 {t('settings', 'account')}</span>
          <Row justify="space-between">
            <span style={{ color: 'var(--color-text-muted)' }}>{t('settings', 'email')}</span>
            <span>{session.email}</span>
          </Row>
        </Stack>
      </Card>

      <Card>
        <Stack gap={3}>
          <span style={{ fontWeight: 700 }}>🔒 {t('settings', 'security')}</span>
          <Button variant="secondary" onClick={() => setOpenSheet('reveal')}>
            {t('settings', 'revealRecoveryPhrase')}
          </Button>
        </Stack>
      </Card>

      {appConfig.withdrawalEnabled && (
        <Card>
          <Stack gap={3}>
            <span style={{ fontWeight: 700 }}>🏦 {t('settings', 'cashOut')}</span>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{t('settings', 'cashOutBody')}</p>
            <Button variant="secondary" onClick={() => setOpenSheet('withdraw')}>
              {t('settings', 'cashOut')}
            </Button>
          </Stack>
        </Card>
      )}

      <Card>
        <Stack gap={3}>
          <span style={{ fontWeight: 700 }}>🌐 {t('settings', 'language')}</span>
          <Stack gap={2}>
            {LOCALES.map((l) => (
              <button
                key={l.code}
                onClick={() => setLocale(l.code as Locale)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  background: l.code === locale ? 'var(--color-brand-soft)' : 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 14px',
                  color: l.code === locale ? 'var(--color-brand-strong)' : 'var(--color-text)',
                  fontWeight: 600,
                }}
              >
                {l.label} {l.code === locale && '✓'}
              </button>
            ))}
          </Stack>
        </Stack>
      </Card>

      <Card>
        <Stack gap={2}>
          <button
            onClick={() => setShowDeveloperInfo((v) => !v)}
            style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', fontWeight: 600, textAlign: 'left' }}
          >
            {t('settings', 'developerInfo')} {showDeveloperInfo ? '▲' : '▼'}
          </button>
          {showDeveloperInfo && (
            <Stack gap={2} style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)' }}>
              <div>
                {t('settings', 'walletId')}: {session.accountId}
              </div>
              <div>
                {t('settings', 'receivingAddress')}: {address}
              </div>
            </Stack>
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap={2}>
          <span style={{ fontWeight: 700 }}>ℹ️ {t('settings', 'about')}</span>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)' }}>{t('settings', 'aboutBody')}</p>
        </Stack>
      </Card>

      <Stack gap={2}>
        <Button variant="ghost" onClick={handleLogOut}>
          {t('common', 'logOut')}
        </Button>
        <Button variant="danger" onClick={() => setOpenSheet('forget')}>
          {t('settings', 'forgetWallet')}
        </Button>
      </Stack>

      {openSheet === 'reveal' && <RevealRecoveryPhraseSheet onClose={() => setOpenSheet('none')} />}
      {openSheet === 'forget' && <ForgetWalletSheet onCancel={() => setOpenSheet('none')} onConfirm={handleForgetWallet} />}
      {openSheet === 'withdraw' && <WithdrawSheet onClose={() => setOpenSheet('none')} onWithdrawn={onDataChanged} />}
      {openSheet === 'demoDeposit' && (
        <DemoDepositSheet
          onClose={() => setOpenSheet('none')}
          currentBalance={walletBalance}
          onDeposited={(balance) => {
            setWalletBalance(balance);
            onDataChanged();
          }}
        />
      )}
    </Screen>
  );
}
