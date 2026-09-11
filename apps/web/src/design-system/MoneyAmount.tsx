// Real Ledger amounts arrive as full-precision decimal strings (e.g. "44.595000000000000000") --
// this only ever affects DISPLAY (rounded to 2 places for readability), never the value sent back
// to any API call, which always uses the original string.
export function formatMoney(amount: string | number, currency = 'USDT'): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return `-- ${currency}`;
  const formatted = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currency}`;
}

export function MoneyAmount({ amount, currency = 'USDT', size = 'md' }: { amount: string | number; currency?: string; size?: 'md' | 'lg' | 'xl' }) {
  const fontSize = { md: 'var(--font-size-lg)', lg: 'var(--font-size-xl)', xl: 'var(--font-size-2xl)' }[size];
  return <span style={{ fontSize, fontWeight: 700, letterSpacing: '-0.01em' }}>{formatMoney(amount, currency)}</span>;
}
