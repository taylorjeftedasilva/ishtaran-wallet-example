import type { WalletChainActions, WalletTransferResult } from './WalletBalanceProvider.js';

/**
 * Prompt 2 -- chain-mutation actions only for Production (the QUERY path moved to
 * IshtaranWalletBalanceReader, which now uses Ishtaran's official WalletBalance capability --
 * server-side, `client.walletBalance` already resolves this environment's real TRC-20 provider,
 * see `TronBlockchainBalanceProvider` in the platform core). Production/ManagedCustody remains
 * structurally disabled today (DEC-037) -- this class is never exercised against real
 * infrastructure in this pass, and is honestly documented as such rather than pretending
 * otherwise.
 */
export class ProductionWalletChainActions implements WalletChainActions {
  async creditExternalDeposit(): Promise<string> {
    // There is no such thing as "simulating" a deposit against a real blockchain -- a real
    // external deposit is a real on-chain transaction someone else broadcasts, never a call this
    // app makes on their behalf. "Simular depósito" is a Sandbox-only concept by construction --
    // this method exists only so ProductionWalletChainActions satisfies the same interface, and
    // fails loudly rather than silently no-op'ing if ever reached in error.
    throw new Error(
      'creditExternalDeposit is not applicable in Production -- a real external deposit is a real on-chain transaction, never a simulation call. This code path should be unreachable (Settings hides "Simular depósito" outside Sandbox).',
    );
  }

  async transfer(): Promise<WalletTransferResult> {
    // A real self-custody transfer must be signed with the user's own private key, which never
    // leaves their device (this app's own onboarding/localWallet.ts architecture) -- apps/api
    // structurally cannot hold that key and therefore cannot broadcast on the user's behalf. A
    // real Production "Enviar" would need the FRONTEND to build, sign, and broadcast the
    // transaction directly to a Tron RPC/node, then only ask the backend to refresh the balance
    // afterward -- a genuinely different flow from Sandbox's server-side transfer, not yet built
    // (out of scope for this pass, Production is not live -- DEC-037).
    throw new Error(
      "transfer is not implemented server-side for Production -- a real wallet-to-wallet transfer must be signed client-side with the user's own private key and broadcast directly to the chain; apps/api never holds that key. Production is not live in this platform today (DEC-037).",
    );
  }
}
