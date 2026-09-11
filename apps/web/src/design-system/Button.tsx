import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  compact?: boolean;
  busy?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'primary', compact = false, busy = false, disabled, children, className, ...rest }: ButtonProps) {
  const classes = [styles.button, styles[variant], compact ? styles.compact : '', className].filter(Boolean).join(' ');
  return (
    <button className={classes} disabled={disabled || busy} aria-busy={busy} {...rest}>
      {children}
    </button>
  );
}
