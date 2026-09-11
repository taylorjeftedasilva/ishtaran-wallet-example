// Fixed-point decimal helpers for asset amounts (USDT-TRC20's real precision: 6 decimal places)
// and for Ishtaran splitPercentage strings (verified live to at least 6 decimal places,
// IMPLEMENTATION_PLAN.md Fase A3). Plain `number` arithmetic is never used for money here --
// floating point drift is not acceptable against a real Ledger.

const ASSET_DECIMALS = 6;
const SCALE = 10n ** BigInt(ASSET_DECIMALS);

const DECIMAL_STRING = /^\d+(\.\d+)?$/;

export function toMicros(amount: string): bigint {
  const trimmed = amount.trim();
  if (!DECIMAL_STRING.test(trimmed)) {
    throw new Error(`Invalid decimal amount: "${amount}"`);
  }
  const [whole = '0', frac = ''] = trimmed.split('.');
  const paddedFrac = (frac + '0'.repeat(ASSET_DECIMALS)).slice(0, ASSET_DECIMALS);
  return BigInt(whole) * SCALE + BigInt(paddedFrac || '0');
}

export function fromMicros(micros: bigint): string {
  if (micros < 0n) throw new Error('Amount cannot be negative');
  const whole = micros / SCALE;
  const frac = micros % SCALE;
  const fracStr = frac.toString().padStart(ASSET_DECIMALS, '0').replace(/0+$/, '');
  return fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
}

/** amount * percentage / 100, rounded down -- the app never rounds a fee up in its own favor. */
export function applyPercentage(micros: bigint, percentage: string): bigint {
  const pctMicros = toMicros(percentage);
  return (micros * pctMicros) / (100n * SCALE);
}

export function addMicros(a: bigint, b: bigint): bigint {
  return a + b;
}

export function subMicros(a: bigint, b: bigint): bigint {
  const result = a - b;
  if (result < 0n) throw new Error('Resulting amount cannot be negative');
  return result;
}

/** (part / whole) * 100, formatted as a splitPercentage decimal string, rounded down to 6 places. */
export function toSplitPercentage(part: bigint, whole: bigint): string {
  if (whole <= 0n) throw new Error('Whole amount must be positive');
  const percentageMicros = (part * 100n * SCALE) / whole;
  return fromMicros(percentageMicros);
}

/**
 * 100 - percentage, computed in the same fixed-point space as toSplitPercentage so that
 * `subtractFromHundred(x) + x === "100"` exactly, by construction -- this is how every
 * multi-participant split in this package guarantees BR-SPL-003 (sum must be exactly 100)
 * regardless of how the fee ratio rounds.
 */
export function subtractFromHundred(percentage: string): string {
  const micros = toMicros(percentage);
  const hundredMicros = 100n * SCALE;
  if (micros > hundredMicros) throw new Error(`Percentage "${percentage}" exceeds 100`);
  return fromMicros(hundredMicros - micros);
}
