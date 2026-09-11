import { describe, expect, it } from 'vitest';
import { fromMicros, subtractFromHundred, toMicros, toSplitPercentage } from '../src/decimal.js';

// The exact split-precision cases from PROMPT 3 §11, proven at the decimal-helper level --
// these are the same numeric shapes IMPLEMENTATION_PLAN.md Fase A3 proved live against a real
// Sandbox CreateTransaction (BR-SPL-003: the sum must be exactly 100).

describe('toSplitPercentage / subtractFromHundred', () => {
  it('50 / 50', () => {
    const a = toSplitPercentage(50n * 10n ** 6n, 100n * 10n ** 6n);
    const b = subtractFromHundred(a);
    expect(a).toBe('50');
    expect(b).toBe('50');
    expect(sumAsDecimal(a, b)).toBe('100');
  });

  it('90 / 10', () => {
    const a = toSplitPercentage(10n * 10n ** 6n, 100n * 10n ** 6n);
    const b = subtractFromHundred(a);
    expect(a).toBe('10');
    expect(b).toBe('90');
    expect(sumAsDecimal(a, b)).toBe('100');
  });

  it('99 / 1', () => {
    const a = toSplitPercentage(1n * 10n ** 6n, 100n * 10n ** 6n);
    const b = subtractFromHundred(a);
    expect(a).toBe('1');
    expect(b).toBe('99');
    expect(sumAsDecimal(a, b)).toBe('100');
  });

  it('33.33 / 33.33 / 33.34 -- three-way split, remainder absorbed by the last share', () => {
    const whole = toMicros('100');
    const first = toSplitPercentage(toMicros('33.33'), whole);
    const second = toSplitPercentage(toMicros('33.33'), whole);
    const third = subtractFromHundred(sumAsDecimal(first, second));
    expect(first).toBe('33.33');
    expect(second).toBe('33.33');
    expect(third).toBe('33.34');
    expect(sumAsDecimal(sumAsDecimal(first, second), third)).toBe('100');
  });

  it('99.999999 / 0.000001 -- full 6-decimal precision preserved', () => {
    const a = toSplitPercentage(1n, 100n * 10n ** 6n);
    const b = subtractFromHundred(a);
    expect(a).toBe('0.000001');
    expect(b).toBe('99.999999');
    expect(sumAsDecimal(a, b)).toBe('100');
  });

  it('rejects a percentage above 100 (analogue of BR-SPL-003 sum > 100 rejection)', () => {
    expect(() => subtractFromHundred('100.000001')).toThrow(/exceeds 100/);
  });

  it('rejects a malformed decimal amount (analogue of an invalid sum input)', () => {
    expect(() => toMicros('not-a-number')).toThrow(/Invalid decimal amount/);
    expect(() => toMicros('-5')).toThrow(/Invalid decimal amount/);
  });
});

describe('toMicros / fromMicros round-trip', () => {
  it('preserves up to 6 decimal places', () => {
    for (const value of ['0', '1', '0.5', '100', '33.33', '33.34', '99.999999', '0.000001']) {
      expect(fromMicros(toMicros(value))).toBe(value);
    }
  });
});

function sumAsDecimal(a: string, b: string): string {
  return fromMicros(toMicros(a) + toMicros(b));
}
