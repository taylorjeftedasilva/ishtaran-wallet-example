// Prompt 2 -- split into two distinct concerns that Prompt 1's old (pre-core-capability) design
// conflated into one interface:
//
//  - WalletBalanceReader: READS the wallet's own on-chain balance via Ishtaran's official
//    WalletBalance core capability (`client.walletBalance`, Prompt 1/1.1). Environment-agnostic
//    from this app's point of view -- Ishtaran itself already resolves Sandbox vs. Production
//    server-side from `environmentId`, so there is no need for separate Sandbox/Production reader
//    implementations any more (there was, before this capability existed -- see git history of
//    this file for the old GAPS.md G.8 design).
//  - WalletChainActions: MUTATES simulated/real chain state (a Sandbox "simular depósito" credit,
//    or a wallet-to-wallet "Enviar" transfer). This genuinely differs by environment (Sandbox can
//    simulate; a real Production transfer must be signed client-side with the user's own private
//    key and broadcast directly to a Tron node -- apps/api never holds that key, and Production
//    is not live today, DEC-037) -- kept Sandbox/Production-specific.
//
// Neither of these ever touches the Ishtaran Ledger (routes/ledgerPosition.ts) -- this is the
// wallet's OWN on-chain (or simulated-on-chain) balance, a fundamentally different, real concept
// from Ishtaran's economic position.

export interface WalletBalanceSnapshot {
  address: string;
  /** Decimal string, never a lossy float. */
  balance: string;
  /** Null if this wallet has never been successfully observed yet -- balance is "0" in that case, never a lie. */
  observedAt: string | null;
  /** True if `observedAt` is null or older than the platform's freshness window (currently 30s). */
  stale: boolean;
  /** "sandbox" | "trongrid" | etc -- whichever provider actually answered, reported honestly by the platform itself. */
  source: string | null;
  /** True if a refresh was suppressed by the platform's freshness window/single-flight guard -- never an error, the balance above is still the latest known value. */
  refreshSuppressed: boolean;
  /** Set only when the most recent refresh attempt failed -- balance/observedAt above remain the last successfully observed values, never zeroed out. */
  refreshFailureReason: string | null;
  nextRefreshAllowedAt: string | null;
}

export interface WalletNetworkBalance {
  assetNetworkId: string;
  networkCode: string;
  balance: string;
  observedAt: string | null;
  stale: boolean;
}

/** One Asset's balance aggregated across every Network this account has a registered address on -- never summed across different Assets. */
export interface WalletAssetBalance {
  assetId: string;
  assetSymbol: string;
  aggregateBalance: string;
  networkBalances: WalletNetworkBalance[];
}

/**
 * Reads the wallet's own on-chain balance via Ishtaran's official WalletBalance capability
 * (`client.walletBalance`) -- the ONLY sanctioned way this app asks "how much does this
 * self-custody wallet actually have." `getBalance` is always cheap (last known snapshot, never a
 * blockchain/RPC call); `refreshBalance` asks the platform to check authoritatively, subject to
 * its own 30s freshness/single-flight guard (never an error to call it too often -- check
 * `refreshSuppressed` on the result).
 */
export interface WalletBalanceReader {
  getBalance(accountId: string): Promise<WalletBalanceSnapshot>;
  refreshBalance(accountId: string): Promise<WalletBalanceSnapshot>;
  /** Multi-asset/multi-network aggregate view (Prompt 2 Home). Today only ever returns USDT/TRON (the only supported Asset/Network), but the shape is already generic. */
  getAssetBalances(accountId: string): Promise<WalletAssetBalance[]>;
}

export interface WalletTransferResult {
  fromBalance: string;
  toBalance: string;
}

/**
 * Environment-specific CHAIN MUTATIONS -- simulating (Sandbox) or would-be-broadcasting
 * (Production, not implemented -- see ProductionWalletChainActions) an actual balance change.
 * Never used for reading (see WalletBalanceReader above).
 */
export interface WalletChainActions {
  /** "Simular depósito" -- represents an external deposit (an exchange/wallet sending funds in) landing at `address`. `idempotencyKey` required -- a retry never double-credits. */
  creditExternalDeposit(address: string, amount: string, idempotencyKey: string): Promise<string>;

  /** "Enviar" -- a direct wallet-to-wallet transfer, entirely outside Ishtaran's business domain. Throws INSUFFICIENT_FUNDS-shaped errors on insufficient balance, never creates a negative balance. `idempotencyKey` required -- a retry never double-debits. */
  transfer(fromAddress: string, toAddress: string, amount: string, idempotencyKey: string): Promise<WalletTransferResult>;
}
