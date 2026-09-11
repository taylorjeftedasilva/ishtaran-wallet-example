// wallet.config.ts schema -- the one file a future config-driven builder edits to reshape this
// reference project's behavior (Builder LEGO contract, IMPLEMENTATION_PLAN.md Fase S). Only
// fields the Product Spec + empirical Fase A findings actually support are modeled here --
// nothing aspirational.

export type RevenueEvent = 'PAYMENT' | 'WITHDRAWAL' | 'TRANSFER' | 'MERCHANT_PAYMENT' | 'P2P';
export type RevenueForm = 'NONE' | 'FIXED' | 'PERCENTAGE' | 'FIXED_PLUS_PERCENTAGE';
export type RevenuePayer = 'SENDER' | 'RECEIVER' | 'APP_OWNER' | 'SHARED';

export interface RevenueRule {
  event: RevenueEvent;
  form: RevenueForm;
  payer: RevenuePayer;
  /** Decimal strings, e.g. "1.5" -- real Ishtaran splitPercentage precision (verified live to at
   * least 6 decimal places, IMPLEMENTATION_PLAN.md Fase A3) is preserved end to end. */
  value: { fixedAmount?: string; percentage?: string };
}

export interface WalletConfig {
  mode: 'PERSONAL' | 'MONETIZED';
  branding: { appName: string; logoUrl?: string };
  /** V1: exactly the one real, seeded Sandbox Asset/Network -- never a claim of broader support. */
  supportedAssets: ['USDT'];
  supportedNetworks: ['tron'];
  revenueRules: RevenueRule[];
  paymentRequest: { enabled: boolean; defaultExpiryMinutes: number };
  withdrawal: { enabled: boolean };
  security: { requireConfirmationBeforeSigning: boolean };
  /** GAPS.md G.6 -- selects the WalletBalanceProvider (apps/api/src/walletBalance/) the whole app
   * consumes: 'sandbox' backed by Ishtaran's real SandboxWalletBalance capability, 'production' by
   * a real chain RPC. Widened from a 'sandbox'-only literal so the real architecture exists even
   * though Production is not live on this platform today (DEC-037) -- never pretends otherwise. */
  environment: 'sandbox' | 'production';
}

export const PERSONAL_WALLET_CONFIG: WalletConfig = {
  mode: 'PERSONAL',
  branding: { appName: 'Ishtaran Wallet (Personal)' },
  supportedAssets: ['USDT'],
  supportedNetworks: ['tron'],
  revenueRules: [],
  paymentRequest: { enabled: true, defaultExpiryMinutes: 60 },
  withdrawal: { enabled: true },
  security: { requireConfirmationBeforeSigning: true },
  environment: 'sandbox',
};

export const MONETIZED_WALLET_CONFIG: WalletConfig = {
  mode: 'MONETIZED',
  branding: { appName: 'Ishtaran Wallet (Monetized demo)' },
  supportedAssets: ['USDT'],
  supportedNetworks: ['tron'],
  revenueRules: [
    { event: 'P2P', form: 'NONE', payer: 'SHARED', value: {} },
    { event: 'MERCHANT_PAYMENT', form: 'PERCENTAGE', payer: 'RECEIVER', value: { percentage: '0.7' } },
    { event: 'PAYMENT', form: 'PERCENTAGE', payer: 'RECEIVER', value: { percentage: '1' } },
    { event: 'WITHDRAWAL', form: 'FIXED', payer: 'SENDER', value: { fixedAmount: '1' } },
  ],
  paymentRequest: { enabled: true, defaultExpiryMinutes: 60 },
  withdrawal: { enabled: true },
  security: { requireConfirmationBeforeSigning: true },
  environment: 'sandbox',
};

export function findRevenueRule(config: WalletConfig, event: RevenueEvent): RevenueRule | undefined {
  return config.revenueRules.find((r) => r.event === event);
}

export function loadWalletConfig(mode: WalletConfig['mode'] = 'PERSONAL'): WalletConfig {
  return mode === 'MONETIZED' ? MONETIZED_WALLET_CONFIG : PERSONAL_WALLET_CONFIG;
}
