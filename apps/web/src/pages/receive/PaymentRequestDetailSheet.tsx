import { useState } from 'react';
import * as api from '../../apiClient.js';
import { useI18n } from '../../i18n/index.js';
import { Sheet } from '../../design-system/Sheet.js';
import { Stack, Row } from '../../design-system/Stack.js';
import { Button } from '../../design-system/Button.js';
import { Badge, Banner } from '../../design-system/Feedback.js';
import { QrCode } from '../../design-system/QrCode.js';
import { formatDate } from '../../lib/format.js';
import { CopyableField } from './CopyableField.js';

const STATUS_TONE: Record<api.PaymentRequestStatus, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  PAID: 'success',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  ACTIVE: 'info',
  DRAFT: 'neutral',
};

/**
 * Clicking a row in "Suas cobranças" opens this -- product feedback (Prompt 2 manual review):
 * the list alone wasn't actionable (no way to see the payment code again, no QR, no way to
 * cancel/remove an expired one). ACTIVE requests get a QR + cancel; EXPIRED/CANCELLED get a
 * remove-from-list action (never available for PAID -- that record belongs to Activity now).
 */
export function PaymentRequestDetailSheet({
  request,
  locale,
  onClose,
  onChanged,
}: {
  request: api.PaymentRequestRow;
  locale: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [current, setCurrent] = useState(request);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  async function handleCancel() {
    setBusy(true);
    setError(null);
    try {
      await api.cancelPaymentRequest(current.id);
      setCurrent({ ...current, status: 'CANCELLED' });
      setConfirmingCancel(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      await api.deletePaymentRequest(current.id);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Sheet onDismiss={onClose}>
      <Row justify="space-between">
        <span style={{ fontWeight: 700 }}>{t('receive', 'detailTitle')}</span>
        <button onClick={onClose} aria-label={t('common', 'close')} style={{ background: 'none', border: 'none', fontSize: 20 }}>
          ✕
        </button>
      </Row>

      {error && <Banner tone="danger">{error}</Banner>}

      <Stack gap={4}>
        <Stack gap={1}>
          <span style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)' }}>{current.amount} USDT</span>
          <span style={{ color: 'var(--color-text-muted)' }}>{current.description || t('receive', 'noDescriptionFallback')}</span>
        </Stack>

        <Row justify="space-between">
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{t('receive', 'yourRequests')}</span>
          <Badge tone={STATUS_TONE[current.status]}>{t('receive', `requestStatus_${current.status}`)}</Badge>
        </Row>

        <Row justify="space-between">
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)' }}>{t('receive', 'createdLabel')}</span>
          <span style={{ fontSize: 'var(--font-size-xs)' }}>{formatDate(current.created_at, locale)}</span>
        </Row>
        <Row justify="space-between">
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)' }}>{t('receive', 'expiresLabel')}</span>
          <span style={{ fontSize: 'var(--font-size-xs)' }}>{formatDate(current.expires_at, locale)}</span>
        </Row>

        {current.status === 'ACTIVE' && (
          <>
            <Stack gap={2}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('receive', 'shareRequestId')}</span>
              <CopyableField value={current.id} />
            </Stack>
            <Stack gap={2} align="center">
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('receive', 'scanToPay')}</span>
              <QrCode value={current.id} size={200} />
            </Stack>

            {confirmingCancel ? (
              <Stack gap={2}>
                <Banner tone="warning">{t('receive', 'cancelRequestConfirm')}</Banner>
                <Row gap={2}>
                  <Button variant="secondary" onClick={() => setConfirmingCancel(false)} disabled={busy} style={{ flex: 1 }}>
                    {t('common', 'back')}
                  </Button>
                  <Button variant="danger" busy={busy} onClick={handleCancel} style={{ flex: 1 }}>
                    {t('receive', 'cancelRequest')}
                  </Button>
                </Row>
              </Stack>
            ) : (
              <Button variant="danger" onClick={() => setConfirmingCancel(true)}>
                {t('receive', 'cancelRequest')}
              </Button>
            )}
          </>
        )}

        {(current.status === 'EXPIRED' || current.status === 'CANCELLED') && (
          <>
            <Banner tone="info">{t('receive', current.status === 'EXPIRED' ? 'expiredNoActionsHint' : 'cancelledNoActionsHint')}</Banner>
            {confirmingRemove ? (
              <Stack gap={2}>
                <Banner tone="warning">{t('receive', 'removeFromListConfirm')}</Banner>
                <Row gap={2}>
                  <Button variant="secondary" onClick={() => setConfirmingRemove(false)} disabled={busy} style={{ flex: 1 }}>
                    {t('common', 'back')}
                  </Button>
                  <Button variant="danger" busy={busy} onClick={handleRemove} style={{ flex: 1 }}>
                    {t('receive', 'removeFromList')}
                  </Button>
                </Row>
              </Stack>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmingRemove(true)}>
                {t('receive', 'removeFromList')}
              </Button>
            )}
          </>
        )}
      </Stack>
    </Sheet>
  );
}
