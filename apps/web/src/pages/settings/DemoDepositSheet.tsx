import { useState } from 'react';
import * as api from '../../apiClient.js';
import { useI18n } from '../../i18n/index.js';
import { Sheet } from '../../design-system/Sheet.js';
import { Stack, Row } from '../../design-system/Stack.js';
import { Button } from '../../design-system/Button.js';
import { TextField } from '../../design-system/TextField.js';
import { Banner } from '../../design-system/Feedback.js';

const QUICK_AMOUNTS = ['50', '100', '500'];

/**
 * "Simular depósito" -- an external wallet/exchange sending test-USDT to this Sandbox address.
 * Shows Saldo anterior / Depósito / Saldo atual so it reads as an honest external event, never a
 * magically-appearing number.
 */
export function DemoDepositSheet({
  onClose,
  currentBalance,
  onDeposited,
}: {
  onClose: () => void;
  currentBalance: string | null;
  onDeposited: (balance: string) => void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState('100');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function handleDeposit() {
    setError(null);
    setBusy(true);
    try {
      setBefore(currentBalance ?? '0');
      const result = await api.simulateDeposit(amount);
      setDone(result.balance);
      onDeposited(result.balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet onDismiss={onClose}>
      <Row justify="space-between">
        <span style={{ fontWeight: 700 }}>{t('settings', 'simulateDeposit')}</span>
        <button onClick={onClose} aria-label={t('common', 'close')} style={{ background: 'none', border: 'none', fontSize: 20 }}>
          ✕
        </button>
      </Row>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{t('settings', 'simulateDepositBody')}</p>

      {error && <Banner tone="danger">{error}</Banner>}

      {!done ? (
        <Stack gap={4}>
          <Row gap={2}>
            {QUICK_AMOUNTS.map((q) => (
              <Button key={q} compact variant={amount === q ? 'primary' : 'secondary'} onClick={() => setAmount(q)}>
                {q}
              </Button>
            ))}
          </Row>
          <TextField label={t('settings', 'amountLabel')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button busy={busy} disabled={!amount || Number(amount) <= 0} onClick={handleDeposit}>
            {t('settings', 'simulateDeposit')}
          </Button>
        </Stack>
      ) : (
        <Stack gap={3}>
          <Banner tone="success">{t('settings', 'depositSuccess')}</Banner>
          <Stack gap={1}>
            <Row justify="space-between">
              <span style={{ color: 'var(--color-text-muted)' }}>{t('settings', 'balanceBefore')}</span>
              <span>{before} USDT</span>
            </Row>
            <Row justify="space-between">
              <span style={{ color: 'var(--color-text-muted)' }}>{t('settings', 'depositAmount')}</span>
              <span style={{ color: 'var(--color-success)' }}>+{amount} USDT</span>
            </Row>
            <Row justify="space-between">
              <span style={{ fontWeight: 700 }}>{t('settings', 'balanceAfter')}</span>
              <span style={{ fontWeight: 800 }}>{done} USDT</span>
            </Row>
          </Stack>
          <Button variant="secondary" onClick={onClose}>
            {t('common', 'done')}
          </Button>
        </Stack>
      )}
    </Sheet>
  );
}
