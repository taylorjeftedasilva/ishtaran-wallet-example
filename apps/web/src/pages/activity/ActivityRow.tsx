import { useState } from 'react';
import type * as api from '../../apiClient.js';
import { useI18n } from '../../i18n/index.js';
import { formatMoney } from '../../design-system/MoneyAmount.js';
import { shorten } from '../../lib/format.js';
import { ActivityDetailSheet } from './ActivityDetailSheet.js';
import styles from './ActivityRow.module.css';

const KIND_ICON: Record<api.TransactionKind, string> = {
  payment_sent: '🧾',
  payment_received: '🧾',
  merchant_payment: '🛍️',
  app_revenue: '💼',
  withdrawal: '🏦',
  refund: '↩️',
  wallet_deposit: '⬇️',
  wallet_transfer_sent: '↗️',
  wallet_transfer_received: '↙️',
};

const INCOMING_KINDS: api.TransactionKind[] = ['payment_received', 'app_revenue', 'refund', 'wallet_deposit', 'wallet_transfer_received'];

export function ActivityRow({ row, divider }: { row: api.TransactionViewRow; divider: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const incoming = INCOMING_KINDS.includes(row.kind);

  return (
    <>
      <button className={`${styles.row} ${divider ? styles.divider : ''}`} onClick={() => setOpen(true)}>
        <span className={styles.icon}>{KIND_ICON[row.kind]}</span>
        <span className={styles.main}>
          <div className={styles.kind}>{t('activity', `kind_${row.kind}` as never)}</div>
          {row.counterparty_label && <div className={styles.counterparty}>{shorten(row.counterparty_label)}</div>}
        </span>
        <span className={styles.amount} style={{ color: incoming ? 'var(--color-success)' : 'var(--color-text)' }}>
          {incoming ? '+' : '-'}
          {formatMoney(row.amount)}
        </span>
      </button>
      {open && <ActivityDetailSheet row={row} onClose={() => setOpen(false)} />}
    </>
  );
}
