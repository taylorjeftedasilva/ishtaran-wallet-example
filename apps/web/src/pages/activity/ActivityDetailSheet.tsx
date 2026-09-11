import { useState } from 'react';
import type * as api from '../../apiClient.js';
import { useI18n } from '../../i18n/index.js';
import { Sheet } from '../../design-system/Sheet.js';
import { Stack, Row } from '../../design-system/Stack.js';
import { Button } from '../../design-system/Button.js';
import { Badge } from '../../design-system/Feedback.js';
import { MoneyAmount } from '../../design-system/MoneyAmount.js';
import { formatDate } from '../../lib/format.js';

const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  COMPLETED: 'success',
  FAILED: 'danger',
  RECONCILIATION: 'warning',
  REFUNDED: 'neutral',
  RESERVED: 'info',
  SIGNING: 'info',
  EXECUTING: 'info',
  CREATED: 'neutral',
};

export function ActivityDetailSheet({ row, onClose }: { row: api.TransactionViewRow; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [showTechnical, setShowTechnical] = useState(false);

  return (
    <Sheet onDismiss={onClose}>
      <Stack gap={4}>
        <Row justify="space-between">
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>{t('activity', 'detailTitle')}</h2>
          <button onClick={onClose} aria-label={t('common', 'close')} style={{ background: 'none', border: 'none', fontSize: 20 }}>
            ✕
          </button>
        </Row>

        <Stack gap={1} align="center">
          <MoneyAmount amount={row.amount} size="xl" />
          <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{t('activity', `status_${row.status}` as never)}</Badge>
        </Stack>

        <Stack gap={2}>
          <Row justify="space-between">
            <span style={{ color: 'var(--color-text-muted)' }}>{t('activity', 'dateLabel')}</span>
            <span>{formatDate(row.created_at, locale)}</span>
          </Row>
          {row.counterparty_label && (
            <Row justify="space-between">
              <span style={{ color: 'var(--color-text-muted)' }}>{t('activity', 'withLabel')}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}>{row.counterparty_label}</span>
            </Row>
          )}
          {row.app_fee && Number(row.app_fee) > 0 && (
            <Row justify="space-between">
              <span style={{ color: 'var(--color-text-muted)' }}>{t('send', 'appFeeRow')}</span>
              <span>{row.app_fee} USDT</span>
            </Row>
          )}
        </Stack>

        <div>
          <Button variant="ghost" compact onClick={() => setShowTechnical((v) => !v)}>
            {t('common', 'technicalDetails')} {showTechnical ? '▲' : '▼'}
          </Button>
          {showTechnical && (
            <Stack gap={1} style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', marginTop: 'var(--space-2)' }}>
              {row.ishtaran_transaction_id && <div>tx: {row.ishtaran_transaction_id}</div>}
              {row.settlement_id && <div>settlement: {row.settlement_id}</div>}
              {row.withdrawal_id && <div>withdrawal: {row.withdrawal_id}</div>}
              {row.refund_id && <div>refund: {row.refund_id}</div>}
              {row.technical_reference && <div>ref: {row.technical_reference}</div>}
            </Stack>
          )}
        </div>
      </Stack>
    </Sheet>
  );
}
