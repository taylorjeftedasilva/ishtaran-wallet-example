import type { ReactNode } from 'react';
import styles from './Screen.module.css';

interface ScreenProps {
  title?: string;
  onBack?: () => void;
  trailing?: ReactNode;
  children: ReactNode;
}

export function Screen({ title, onBack, trailing, children }: ScreenProps) {
  return (
    <div className={styles.screen}>
      {(title || onBack) && (
        <div className={styles.topBar}>
          {onBack && (
            <button className={styles.backButton} onClick={onBack} aria-label="Back">
              ←
            </button>
          )}
          {title && <h1 className={styles.title}>{title}</h1>}
          <div style={{ marginLeft: 'auto' }}>{trailing}</div>
        </div>
      )}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
