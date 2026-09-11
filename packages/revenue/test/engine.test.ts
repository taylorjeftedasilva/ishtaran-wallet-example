import type { RevenueRule } from '@wallet-app/wallet-core';
import { describe, expect, it } from 'vitest';
import { calculateRevenue } from '../src/engine.js';

function sumSplits(allocations: { splitPercentage: string }[] | undefined): string {
  if (!allocations) throw new Error('expected allocations');
  return allocations.reduce((total, a) => (Number(total) + Number(a.splitPercentage)).toFixed(6), '0.000000');
}

describe('calculateRevenue', () => {
  it('P2P NONE -- no fee, no split needed', () => {
    const rule: RevenueRule = { event: 'P2P', form: 'NONE', payer: 'SHARED', value: {} };
    const result = calculateRevenue({ event: 'P2P', grossAmount: '25', rule });
    expect(result.mechanism).toBe('NONE');
    expect(result.appFeeAmount).toBe('0');
    expect(result.transactionAmount).toBe('25');
    expect(result.senderDebit).toBe('25');
    expect(result.recipientNet).toBe('25');
    expect(result.allocations).toBeUndefined();
  });

  it('MERCHANT_PAYMENT RECEIVER 0.7% -- receiver absorbs, sender pays exactly the sticker price', () => {
    const rule: RevenueRule = { event: 'MERCHANT_PAYMENT', form: 'PERCENTAGE', payer: 'RECEIVER', value: { percentage: '0.7' } };
    const result = calculateRevenue({ event: 'MERCHANT_PAYMENT', grossAmount: '100', rule });
    expect(result.mechanism).toBe('SPLIT_PARTICIPANT');
    expect(result.transactionAmount).toBe('100');
    expect(result.senderDebit).toBe('100');
    expect(result.appFeeAmount).toBe('0.7');
    expect(result.recipientNet).toBe('99.3');
    expect(result.allocations).toEqual([
      { role: 'RECIPIENT', splitPercentage: '99.3' },
      { role: 'APP_REVENUE', splitPercentage: '0.7' },
    ]);
    expect(sumSplits(result.allocations)).toBe('100.000000');
  });

  it('PAYMENT RECEIVER 1%', () => {
    const rule: RevenueRule = { event: 'PAYMENT', form: 'PERCENTAGE', payer: 'RECEIVER', value: { percentage: '1' } };
    const result = calculateRevenue({ event: 'PAYMENT', grossAmount: '250', rule });
    expect(result.appFeeAmount).toBe('2.5');
    expect(result.recipientNet).toBe('247.5');
    expect(result.transactionAmount).toBe('250');
    expect(sumSplits(result.allocations)).toBe('100.000000');
  });

  it('sender-pays-extra -- a hypothetical SENDER-payer split event adds the fee on top', () => {
    const rule: RevenueRule = { event: 'PAYMENT', form: 'PERCENTAGE', payer: 'SENDER', value: { percentage: '1' } };
    const result = calculateRevenue({ event: 'PAYMENT', grossAmount: '250', rule });
    expect(result.appFeeAmount).toBe('2.5');
    expect(result.transactionAmount).toBe('252.5');
    expect(result.senderDebit).toBe('252.5');
    expect(result.recipientNet).toBe('250');
    expect(sumSplits(result.allocations)).toBe('100.000000');
  });

  it('WITHDRAWAL SENDER FIXED 1 USDT -- realized as a side transaction, never inside the real withdrawal amount', () => {
    const rule: RevenueRule = { event: 'WITHDRAWAL', form: 'FIXED', payer: 'SENDER', value: { fixedAmount: '1' } };
    const result = calculateRevenue({ event: 'WITHDRAWAL', grossAmount: '50', rule });
    expect(result.mechanism).toBe('SIDE_TRANSACTION');
    expect(result.appFeeAmount).toBe('1');
    expect(result.transactionAmount).toBe('50');
    expect(result.senderDebit).toBe('51');
    expect(result.recipientNet).toBe('50');
    expect(result.allocations).toBeUndefined();
  });

  it('WITHDRAWAL RECEIVER FIXED (general case) -- fee deducted from the withdrawal itself', () => {
    const rule: RevenueRule = { event: 'WITHDRAWAL', form: 'FIXED', payer: 'RECEIVER', value: { fixedAmount: '1' } };
    const result = calculateRevenue({ event: 'WITHDRAWAL', grossAmount: '50', rule });
    expect(result.transactionAmount).toBe('49');
    expect(result.senderDebit).toBe('50');
    expect(result.recipientNet).toBe('49');
  });

  it('FIXED_PLUS_PERCENTAGE combines both components', () => {
    const rule: RevenueRule = {
      event: 'PAYMENT',
      form: 'FIXED_PLUS_PERCENTAGE',
      payer: 'RECEIVER',
      value: { fixedAmount: '0.5', percentage: '2' },
    };
    const result = calculateRevenue({ event: 'PAYMENT', grossAmount: '100', rule });
    expect(result.appFeeAmount).toBe('2.5');
    expect(result.recipientNet).toBe('97.5');
  });

  it('preserves 6-decimal precision through the full engine (99.999999 / 0.000001 shape)', () => {
    const rule: RevenueRule = { event: 'PAYMENT', form: 'PERCENTAGE', payer: 'RECEIVER', value: { percentage: '0.000001' } };
    const result = calculateRevenue({ event: 'PAYMENT', grossAmount: '100', rule });
    expect(result.appFeeAmount).toBe('0.000001');
    expect(result.allocations).toEqual([
      { role: 'RECIPIENT', splitPercentage: '99.999999' },
      { role: 'APP_REVENUE', splitPercentage: '0.000001' },
    ]);
    expect(sumSplits(result.allocations)).toBe('100.000000');
  });

  it('rejects a rule whose event does not match the context event', () => {
    const rule: RevenueRule = { event: 'WITHDRAWAL', form: 'FIXED', payer: 'SENDER', value: { fixedAmount: '1' } };
    expect(() => calculateRevenue({ event: 'PAYMENT', grossAmount: '10', rule })).toThrow(/Revenue rule is for event/);
  });

  it('rejects SHARED/APP_OWNER payer with a non-zero fee instead of guessing a mechanism', () => {
    const shared: RevenueRule = { event: 'PAYMENT', form: 'PERCENTAGE', payer: 'SHARED', value: { percentage: '1' } };
    const appOwner: RevenueRule = { event: 'PAYMENT', form: 'PERCENTAGE', payer: 'APP_OWNER', value: { percentage: '1' } };
    expect(() => calculateRevenue({ event: 'PAYMENT', grossAmount: '10', rule: shared })).toThrow(/out of scope for V1/);
    expect(() => calculateRevenue({ event: 'PAYMENT', grossAmount: '10', rule: appOwner })).toThrow(/out of scope for V1/);
  });

  it('rejects a FIXED rule with no fixedAmount and a PERCENTAGE rule with no percentage', () => {
    const badFixed: RevenueRule = { event: 'WITHDRAWAL', form: 'FIXED', payer: 'SENDER', value: {} };
    const badPercentage: RevenueRule = { event: 'PAYMENT', form: 'PERCENTAGE', payer: 'RECEIVER', value: {} };
    expect(() => calculateRevenue({ event: 'WITHDRAWAL', grossAmount: '10', rule: badFixed })).toThrow(/no fixedAmount/);
    expect(() => calculateRevenue({ event: 'PAYMENT', grossAmount: '10', rule: badPercentage })).toThrow(/no percentage/);
  });
});
