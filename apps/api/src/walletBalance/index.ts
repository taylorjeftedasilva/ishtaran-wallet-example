import type { IshtaranClient } from '@ishtaran/sdk';
import type { WalletConfig } from '@wallet-app/wallet-core';
import { IshtaranWalletBalanceReader } from './IshtaranWalletBalanceReader.js';
import { SandboxWalletChainActions } from './SandboxWalletBalanceProvider.js';
import { ProductionWalletChainActions } from './ProductionWalletBalanceProvider.js';
import type { WalletBalanceReader, WalletChainActions } from './WalletBalanceProvider.js';

export type {
  WalletBalanceReader,
  WalletBalanceSnapshot,
  WalletAssetBalance,
  WalletNetworkBalance,
  WalletChainActions,
  WalletTransferResult,
} from './WalletBalanceProvider.js';

/** Prompt 2 -- environment-agnostic; Ishtaran's own WalletBalance capability already resolves Sandbox vs. Production server-side. */
export function createWalletBalanceReader(client: IshtaranClient, environmentId: string, assetNetworkId: string): WalletBalanceReader {
  return new IshtaranWalletBalanceReader(client, environmentId, assetNetworkId);
}

/** The ONE place that picks Sandbox vs. Production for chain-MUTATING actions. Every route consumes only `WalletChainActions`, never knows or cares which one is active. */
export function createWalletChainActions(
  environment: WalletConfig['environment'],
  client: IshtaranClient,
  environmentId: string,
  assetNetworkId: string,
): WalletChainActions {
  return environment === 'production'
    ? new ProductionWalletChainActions()
    : new SandboxWalletChainActions(client, environmentId, assetNetworkId);
}
