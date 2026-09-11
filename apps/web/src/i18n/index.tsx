// Minimal, dependency-free i18n -- a typed nested-key dictionary + a React Context, deliberately
// not a library: this reference project stays easy to read and reuse (no heavy framework). Every
// user-visible string lives in en.ts/pt-BR.ts/es.ts, never hardcoded in a component.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { en, type Dictionary } from './en.js';
import { ptBR } from './pt-BR.js';
import { es } from './es.js';

export type Locale = 'en' | 'pt-BR' | 'es';
export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];
const DICTIONARIES: Record<Locale, Dictionary> = { en, 'pt-BR': ptBR, es };
const STORAGE_KEY = 'wallet.locale';

type Section = keyof Dictionary;
type KeyOf<S extends Section> = keyof Dictionary[S] & string;

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'pt-BR' || stored === 'es') return stored;
  } catch {
    // Private-mode/blocked storage -- fall through to browser-language detection.
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  if (nav.toLowerCase().startsWith('pt')) return 'pt-BR';
  if (nav.toLowerCase().startsWith('es')) return 'es';
  return 'en';
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: <S extends Section>(section: S, key: KeyOf<S>, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best-effort persistence only.
    }
  }, []);

  const t = useCallback(
    <S extends Section>(section: S, key: KeyOf<S>, vars?: Record<string, string | number>): string => {
      const dict = DICTIONARIES[locale];
      const template = (dict[section] as Record<string, string>)[key] ?? (en[section] as Record<string, string>)[key] ?? String(key);
      if (!vars) return template;
      return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), template);
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
