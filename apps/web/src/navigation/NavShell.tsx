import type { ReactNode } from 'react';
import { useI18n } from '../i18n/index.js';
import type { AppRoute } from './routes.js';
import styles from './NavShell.module.css';

const ICONS: Record<AppRoute, string> = {
  home: '🏠',
  send: '↗️',
  receive: '↙️',
  activity: '📜',
  revenue: '📈',
  settings: '⚙️',
};

interface NavShellProps {
  active: AppRoute;
  onNavigate: (route: AppRoute) => void;
  showRevenue: boolean;
  appName: string;
  children: ReactNode;
}

export function NavShell({ active, onNavigate, showRevenue, appName, children }: NavShellProps) {
  const { t } = useI18n();
  const items: AppRoute[] = ['home', 'send', 'receive', 'activity', ...(showRevenue ? (['revenue'] as const) : []), 'settings'];

  return (
    <div className={styles.layout}>
      <nav className={styles.sideNav} aria-label={appName}>
        <div className={styles.sideBrand}>
          {appName}
          <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 400, color: 'var(--color-text-faint)', marginTop: 2 }}>{t('common', 'appReferenceBadge')}</div>
        </div>
        {items.map((item) => (
          <button
            key={item}
            className={`${styles.sideNavItem} ${item === active ? styles.active : ''}`}
            onClick={() => onNavigate(item)}
            aria-current={item === active ? 'page' : undefined}
          >
            <span className={styles.navIcon}>{ICONS[item]}</span>
            {t('nav', item)}
          </button>
        ))}
      </nav>

      <div className={styles.main}>{children}</div>

      <nav className={styles.bottomNav} aria-label={appName}>
        {items.map((item) => (
          <button
            key={item}
            className={`${styles.navItem} ${item === active ? styles.active : ''}`}
            onClick={() => onNavigate(item)}
            aria-current={item === active ? 'page' : undefined}
          >
            <span className={styles.navIcon}>{ICONS[item]}</span>
            <span>{t('nav', item)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
