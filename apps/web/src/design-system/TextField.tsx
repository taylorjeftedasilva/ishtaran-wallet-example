import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useId } from 'react';
import styles from './TextField.module.css';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  trailing?: ReactNode;
}

export function TextField({ label, hint, error, trailing, className, id, ...rest }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input id={inputId} className={[styles.input, error ? styles.error : '', className].filter(Boolean).join(' ')} {...rest} />
        {trailing && <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>{trailing}</div>}
      </div>
      {error ? <span className={styles.errorText}>{error}</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  children: ReactNode;
}

export function SelectField({ label, hint, children, id, ...rest }: SelectFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <select id={inputId} className={styles.input} {...rest}>
        {children}
      </select>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
