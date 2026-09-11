import type { IshtaranClient } from '@ishtaran/sdk';
import type { WalletChainActions, WalletTransferResult } from './WalletBalanceProvider.js';

/**
 * Prompt 2 -- chain-mutation actions only (the QUERY path moved to IshtaranWalletBalanceReader,
 * which now talks to Ishtaran's official WalletBalance capability instead of this class). Backed
 * by Ishtaran's own real Sandbox capability (`SandboxWalletBalance`,
 * `/v1/environments/{id}/sandbox/wallet-balance/*`), never a local table -- the Sandbox
 * substitutes external chain infrastructure only, never Ishtaran's own business logic
 * (Transaction/PaymentIntent/Settlement stay untouched by this class entirely). Every credit/
 * transfer here publishes `SandboxWalletBalanceChanged` server-side, which the WalletBalance
 * capability's event-driven refresh (Prompt 1.1) picks up automatically -- so a snapshot read via
 * IshtaranWalletBalanceReader shortly after one of these calls already reflects it, even without
 * an explicit refresh.
 */
export class SandboxWalletChainActions implements WalletChainActions {
  constructor(
    private readonly client: IshtaranClient,
    private readonly environmentId: string,
    private readonly assetNetworkId: string,
  ) {}

  async creditExternalDeposit(address: string, amount: string, idempotencyKey: string): Promise<string> {
    const result = await this.client.sandbox.creditWalletBalance(this.environmentId, address, this.assetNetworkId, amount, idempotencyKey);
    return result.balance;
  }

  async transfer(fromAddress: string, toAddress: string, amount: string, idempotencyKey: string): Promise<WalletTransferResult> {
    const result = await this.client.sandbox.transferWalletBalance(this.environmentId, fromAddress, toAddress, this.assetNetworkId, amount, idempotencyKey);
    return { fromBalance: result.fromBalanceAfter, toBalance: result.toBalanceAfter };
  }
}
