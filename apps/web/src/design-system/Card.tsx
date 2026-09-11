import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  flat?: boolean;
  padSm?: boolean;
  children: ReactNode;
}

export function Card({ flat = false, padSm = false, children, className, ...rest }: CardProps) {
  const classes = [styles.card, flat ? styles.flat : '', padSm ? styles.padSm : '', className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
