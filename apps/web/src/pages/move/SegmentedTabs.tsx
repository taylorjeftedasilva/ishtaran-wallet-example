import { useI18n } from '../../i18n/index.js';
import styles from './SegmentedTabs.module.css';

export type MoveMode = 'send' | 'pay';

/** Enviar and Pagar are one visual experience with two modes -- not two separate screens. */
export function SegmentedTabs({ mode, onChange }: { mode: MoveMode; onChange: (mode: MoveMode) => void }) {
  const { t } = useI18n();
  return (
    <div className={styles.tabs} role="tablist">
      <button role="tab" aria-selected={mode === 'send'} className={`${styles.tab} ${mode === 'send' ? styles.active : ''}`} onClick={() => onChange('send')}>
        ↗️ {t('move', 'sendTab')}
      </button>
      <button role="tab" aria-selected={mode === 'pay'} className={`${styles.tab} ${mode === 'pay' ? styles.active : ''}`} onClick={() => onChange('pay')}>
        🧾 {t('move', 'payTab')}
      </button>
    </div>
  );
}
