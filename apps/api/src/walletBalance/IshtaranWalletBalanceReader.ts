import type { IshtaranClient } from '@ishtaran/sdk';
import type { WalletAssetBalance, WalletBalanceReader, WalletBalanceSnapshot } from './WalletBalanceProvider.js';

/**
 * Prompt 2 -- the official integration with Ishtaran's WalletBalance core capability (Prompt
 * 1/1.1), replacing the pre-capability GAPS.md G.8 design that queried Sandbox chain simulation
 * (`client.sandbox.getWalletBalance`) or raw TronGrid directly for the QUERY path. `accountId` is
 * the walletId throughout -- `ExecutionDestination` already ties one Account to one registered
 * self-custody address per AssetNetwork (see this app's own `registerExecutionDestination` at
 * signup), so no separate wallet-registration concept exists here either.
 *
 * ONE class for both environments -- `client.walletBalance` already resolves Sandbox vs.
 * Production server-side from `environmentId`, so this app no longer needs to pick an
 * implementation itself for reads (only chain-mutating actions still differ by environment, see
 * WalletChainActions).
 */
export class IshtaranWalletBalanceReader implements WalletBalanceReader {
  constructor(
    private readonly client: IshtaranClient,
    private readonly environmentId: string,
    private readonly assetNetworkId: string,
  ) {}

  async getBalance(accountId: string): Promise<WalletBalanceSnapshot> {
    return toSnapshot(await this.client.walletBalance.getBalance(accountId, this.environmentId, this.assetNetworkId));
  }

  async refreshBalance(accountId: string): Promise<WalletBalanceSnapshot> {
    return toSnapshot(await this.client.walletBalance.refreshBalance(accountId, this.environmentId, this.assetNetworkId));
  }

  async getAssetBalances(accountId: string): Promise<WalletAssetBalance[]> {
    const results = await this.client.walletBalance.getAssetBalances(accountId, this.environmentId, [this.assetNetworkId]);
    return results.map((r) => ({
      assetId: r.assetId,
      assetSymbol: r.assetSymbol,
      aggregateBalance: r.aggregateBalance,
      networkBalances: r.networkBalances.map((n) => ({
        assetNetworkId: n.assetNetworkId,
        networkCode: n.networkCode,
        balance: n.balance,
        observedAt: n.observedAt,
        stale: n.stale,
      })),
    }));
  }
}

function toSnapshot(r: {
  address: string;
  balance: string;
  observedAt: string | null;
  stale: boolean;
  source: string | null;
  refreshSuppressed: boolean;
  refreshFailureReason: string | null;
  nextRefreshAllowedAt: string | null;
}): WalletBalanceSnapshot {
  return {
    address: r.address,
    balance: r.balance,
    observedAt: r.observedAt,
    stale: r.stale,
    source: r.source,
    refreshSuppressed: r.refreshSuppressed,
    refreshFailureReason: r.refreshFailureReason,
    nextRefreshAllowedAt: r.nextRefreshAllowedAt,
  };
}
