import { describe, expect, it } from 'vitest';
import { findRevenueRule, loadWalletConfig, MONETIZED_WALLET_CONFIG, PERSONAL_WALLET_CONFIG } from '../src/config.js';

describe('loadWalletConfig', () => {
  it('defaults to PERSONAL', () => {
    expect(loadWalletConfig()).toBe(PERSONAL_WALLET_CONFIG);
  });

  it('PERSONAL has no revenue rules -- never monetized by accident', () => {
    expect(loadWalletConfig('PERSONAL').revenueRules).toEqual([]);
  });

  it('MONETIZED loads the real 4-rule preset', () => {
    expect(loadWalletConfig('MONETIZED')).toBe(MONETIZED_WALLET_CONFIG);
    expect(loadWalletConfig('MONETIZED').revenueRules).toHaveLength(4);
  });

  it('every real Sandbox-supported asset/network is exactly USDT/tron in both presets', () => {
    for (const config of [PERSONAL_WALLET_CONFIG, MONETIZED_WALLET_CONFIG]) {
      expect(config.supportedAssets).toEqual(['USDT']);
      expect(config.supportedNetworks).toEqual(['tron']);
      expect(config.environment).toBe('sandbox');
    }
  });
});

describe('findRevenueRule', () => {
  it('finds the MERCHANT_PAYMENT rule in the monetized preset', () => {
    const rule = findRevenueRule(MONETIZED_WALLET_CONFIG, 'MERCHANT_PAYMENT');
    expect(rule).toEqual({ event: 'MERCHANT_PAYMENT', form: 'PERCENTAGE', payer: 'RECEIVER', value: { percentage: '0.7' } });
  });

  it('P2P is free even in the monetized preset', () => {
    const rule = findRevenueRule(MONETIZED_WALLET_CONFIG, 'P2P');
    expect(rule?.form).toBe('NONE');
  });

  it('returns undefined for an event with no configured rule', () => {
    expect(findRevenueRule(PERSONAL_WALLET_CONFIG, 'PAYMENT')).toBeUndefined();
    expect(findRevenueRule(MONETIZED_WALLET_CONFIG, 'TRANSFER')).toBeUndefined();
  });
});
