import type { ReactNode } from 'react';
import styles from './Sheet.module.css';

export function Sheet({ onDismiss, children }: { onDismiss?: () => void; children: ReactNode }) {
  return (
    <div className={styles.overlay} onClick={onDismiss}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
