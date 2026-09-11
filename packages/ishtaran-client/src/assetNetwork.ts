// The Asset Network isn't hardcoded: this looks up the real seeded USDT-on-Tron pair by
// symbol/code, exactly the way examples/marketplace-mercatto/setup.ts does it -- the wallet
// supports exactly one real, seeded Sandbox Asset/Network in V1 (wallet-core's
// supportedAssets/supportedNetworks), never a broader claim than what's actually seeded.
import type { IshtaranClient } from '@ishtaran/sdk';

export async function resolveUsdtTronAssetNetworkId(
  owner: IshtaranClient,
): Promise<{ assetNetworkId: string; networkId: string }> {
  const assetNetworks = await owner.assetNetworkCatalog.listAssetNetworks();
  for (const candidate of assetNetworks) {
    const [asset, network] = await Promise.all([
      owner.assetNetworkCatalog.getAsset(candidate.assetId),
      owner.assetNetworkCatalog.getNetwork(candidate.networkId),
    ]);
    if (asset.symbol === 'USDT' && network.code === 'tron') {
      return { assetNetworkId: candidate.assetNetworkId, networkId: candidate.networkId };
    }
  }
  throw new Error(
    'No USDT/Tron Asset Network found in this Sandbox -- the wallet requires one to be seeded (real precondition, not a bug in this example).',
  );
}
