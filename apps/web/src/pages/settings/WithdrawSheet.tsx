import { useState } from 'react';
import * as api from '../../apiClient.js';
import { useI18n } from '../../i18n/index.js';
import { Sheet } from '../../design-system/Sheet.js';
import { Stack, Row } from '../../design-system/Stack.js';
import { Button } from '../../design-system/Button.js';
import { TextField } from '../../design-system/TextField.js';
import { Banner } from '../../design-system/Feedback.js';

type Phase = 'form' | 'quote' | 'done';

export function WithdrawSheet({ onClose, onWithdrawn }: { onClose: () => void; onWithdrawn: () => void }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('form');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [quote, setQuote] = useState<api.WithdrawalQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownNotice, setCooldownNotice] = useState(false);

  async function handleGetQuote() {
    setError(null);
    setBusy(true);
    try {
      const destination = await api.createWithdrawalDestination(address.trim());
      setDestinationId(destination.withdrawalDestinationId);
      const q = await api.getWithdrawalQuote(destination.withdrawalDestinationId, amount);
      setQuote(q);
      setPhase('quote');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    if (!destinationId) return;
    setError(null);
    setBusy(true);
    try {
      await api.requestWithdrawal(destinationId, amount);
      setPhase('done');
      onWithdrawn();
    } catch (err) {
      const apiErr = err as api.ApiError;
      if (apiErr.code === 'WITHDRAWAL_DESTINATION_NOT_USABLE') {
        setCooldownNotice(true);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet onDismiss={onClose}>
      <Row justify="space-between">
        <span style={{ fontWeight: 700 }}>{t('settings', 'cashOut')}</span>
        <button onClick={onClose} aria-label={t('common', 'close')} style={{ background: 'none', border: 'none', fontSize: 20 }}>
          ✕
        </button>
      </Row>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{t('settings', 'cashOutBody')}</p>

      {error && <Banner tone="danger">{error}</Banner>}
      {cooldownNotice && <Banner tone="warning">{t('settings', 'withdrawalCooldownNotice')}</Banner>}

      {phase === 'form' && (
        <Stack gap={3}>
          <TextField label={t('settings', 'destinationAddressLabel')} value={address} onChange={(e) => setAddress(e.target.value)} />
          <TextField label={t('settings', 'amountLabel')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button busy={busy} disabled={!address.trim() || !amount || Number(amount) <= 0} onClick={handleGetQuote}>
            {t('settings', 'getQuote')}
          </Button>
        </Stack>
      )}

      {phase === 'quote' && quote && (
        <Stack gap={3}>
          <Row justify="space-between">
            <span style={{ color: 'var(--color-text-muted)' }}>{t('settings', 'networkCostRow')}</span>
            <span>{quote.networkExecutionCost} USDT</span>
          </Row>
          <Row justify="space-between">
            <span style={{ fontWeight: 700 }}>{t('settings', 'youWillReceiveRow')}</span>
            <span style={{ fontWeight: 800 }}>{quote.estimatedRecipientAmount} USDT</span>
          </Row>
          <Button busy={busy} onClick={handleWithdraw}>
            {t('settings', 'requestWithdrawal')}
          </Button>
        </Stack>
      )}

      {phase === 'done' && (
        <Stack gap={3}>
          <Banner tone="success">{t('common', 'done')}</Banner>
          <Button variant="secondary" onClick={onClose}>
            {t('common', 'close')}
          </Button>
        </Stack>
      )}
    </Sheet>
  );
}
