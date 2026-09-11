import type { ReactNode } from 'react';
import styles from './Feedback.module.css';

type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'feeApp' | 'feePlatform' | 'feeNetwork';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}

type BannerTone = 'danger' | 'warning' | 'info' | 'success';

export function Banner({ tone = 'info', children }: { tone?: BannerTone; children: ReactNode }) {
  const toneClass = { danger: styles.bannerDanger, warning: styles.bannerWarning, info: styles.bannerInfo, success: styles.bannerSuccess }[tone];
  return <div className={`${styles.banner} ${toneClass}`}>{children}</div>;
}

export function Spinner() {
  return <span className={styles.spinner} aria-hidden="true" />;
}

export function EmptyState({ icon, title, body }: { icon?: string; title: string; body?: string }) {
  return (
    <div className={styles.emptyState}>
      {icon && <div className={styles.emptyIcon}>{icon}</div>}
      <p style={{ fontWeight: 600, color: 'var(--color-text)' }}>{title}</p>
      {body && <p style={{ marginTop: 4 }}>{body}</p>}
    </div>
  );
}
