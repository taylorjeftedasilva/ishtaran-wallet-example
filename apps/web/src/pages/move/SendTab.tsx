import { useEffect, useState } from 'react';
import * as api from '../../apiClient.js';
import { useI18n } from '../../i18n/index.js';
import { Screen } from '../../design-system/Screen.js';
import { Card } from '../../design-system/Card.js';
import { Stack, Row } from '../../design-system/Stack.js';
import { Button } from '../../design-system/Button.js';
import { TextField } from '../../design-system/TextField.js';
import { Banner, Badge, Spinner } from '../../design-system/Feedback.js';
import { shorten } from '../../lib/format.js';

type Step = { name: 'compose' } | { name: 'review'; toAddress: string; amount: string } | { name: 'success'; toAddress: string; amount: string };

/**
 * "Enviar" -- I, owner of this wallet, transfer USDT directly to another address. A single atomic
 * wallet-to-wallet movement (apiClient.transferToAddress -> /wallet/transfer), never a
 * Transaction/PaymentIntent/Settlement -- that is Pagar (PayTab.tsx), a fundamentally different
 * operation. No pre-created request is needed on the recipient's side.
 */
export function SendTab({ onCompleted, onGoToSandboxTools }: { onCompleted: () => void; onGoToSandboxTools: () => void }) {
  const { t } = useI18n();
  const [balance, setBalance] = useState<string | null>(null);
  const [refreshBalance, setRefreshBalance] = useState(0);
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>({ name: 'compose' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficientFunds, setInsufficientFunds] = useState(false);
  const [result, setResult] = useState<api.WalletBalanceSnapshot | null>(null);

  useEffect(() => {
    api.getWalletBalance().then((r) => setBalance(r.balance));
  }, [refreshBalance]);

  const exceedsBalance = balance !== null && amount !== '' && Number(amount) > Number(balance);
  const canContinue = toAddress.trim().length > 0 && Number(amount) > 0 && !exceedsBalance;

  function handleContinue() {
    setStep({ name: 'review', toAddress: toAddress.trim(), amount });
  }

  async function handleConfirm() {
    if (step.name !== 'review') return;
    setError(null);
    setInsufficientFunds(false);
    setBusy(true);
    try {
      const outcome = await api.transferToAddress(step.toAddress, step.amount);
      setResult(outcome.balance);
      setStep({ name: 'success', toAddress: step.toAddress, amount: step.amount });
      onCompleted();
    } catch (err) {
      const apiErr = err as api.ApiError;
      if (apiErr.code === 'INSUFFICIENT_SANDBOX_WALLET_BALANCE') {
        setInsufficientFunds(true);
        setRefreshBalance((k) => k + 1);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (step.name === 'success') {
    return (
      <div style={{ padding: 'var(--space-4) 0' }}>
        <Stack gap={5} align="center">
          <div style={{ fontSize: 48 }}>✅</div>
          <Stack gap={1} align="center">
            <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800 }}>{t('send', 'transferSuccessTitle')}</h1>
            <span style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>{step.amount} USDT</span>
          </Stack>
          {result && (
            <Card style={{ width: '100%' }}>
              <Stack gap={3}>
                <Row justify="space-between">
                  <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'to')}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}>{shorten(step.toAddress)}</span>
                </Row>
                <Row justify="space-between">
                  <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'yourNewBalance')}</span>
                  <span style={{ fontWeight: 700 }}>{result.balance} USDT</span>
                </Row>
              </Stack>
            </Card>
          )}
          <Button
            onClick={() => {
              setStep({ name: 'compose' });
              setToAddress('');
              setAmount('');
            }}
            style={{ width: '100%' }}
          >
            {t('send', 'backToHome')}
          </Button>
        </Stack>
      </div>
    );
  }

  if (step.name === 'review') {
    return (
      <Stack gap={4}>
        {error && <Banner tone="danger">{error}</Banner>}
        {insufficientFunds && (
          <Banner tone="warning">
            <Stack gap={2}>
              <span>{t('send', 'insufficientFunds')}</span>
              <Button compact variant="secondary" onClick={onGoToSandboxTools}>
                {t('send', 'goToSandboxTools')}
              </Button>
            </Stack>
          </Banner>
        )}
        <Card>
          <Stack gap={4}>
            <Row justify="space-between">
              <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'to')}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}>{shorten(step.toAddress)}</span>
            </Row>
            <Row justify="space-between">
              <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'youSendRow')}</span>
              <span style={{ fontWeight: 700 }}>{step.amount} USDT</span>
            </Row>
            <div style={{ borderTop: '1px dashed var(--color-border)' }} />
            <Row justify="space-between">
              <Badge tone="feePlatform">{t('send', 'feesRow')}</Badge>
              <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--font-size-sm)' }}>{t('send', 'noFees')}</span>
            </Row>
            <div style={{ borderTop: '1px dashed var(--color-border)' }} />
            <Row justify="space-between">
              <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'recipientReceivesRow')}</span>
              <span style={{ fontWeight: 700 }}>{step.amount} USDT</span>
            </Row>
            <Row justify="space-between">
              <span style={{ fontWeight: 700 }}>{t('send', 'totalRow')}</span>
              <span style={{ fontWeight: 800, fontSize: 'var(--font-size-lg)' }}>{step.amount} USDT</span>
            </Row>
          </Stack>
        </Card>
        <Row gap={2}>
          <Button variant="secondary" onClick={() => setStep({ name: 'compose' })} style={{ flex: 1 }} disabled={busy}>
            {t('common', 'back')}
          </Button>
          <Button busy={busy} onClick={handleConfirm} style={{ flex: 2 }}>
            {t('send', 'confirmSend')}
          </Button>
        </Row>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <Card>
        <Stack gap={4}>
          <TextField label={t('send', 'addressLabel')} placeholder={t('send', 'addressPlaceholder')} hint={t('send', 'addressHint')} value={toAddress} onChange={(e) => setToAddress(e.target.value)} />
          <TextField label={t('send', 'amountLabel')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {balance !== null ? (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('send', 'balanceAvailableLabel', { balance })}</span>
          ) : (
            <Spinner />
          )}
          {exceedsBalance && <Banner tone="warning">{t('send', 'insufficientFunds')}</Banner>}
          <Button disabled={!canContinue} onClick={handleContinue}>
            {t('common', 'continue')}
          </Button>
        </Stack>
      </Card>
    </Stack>
  );
}
