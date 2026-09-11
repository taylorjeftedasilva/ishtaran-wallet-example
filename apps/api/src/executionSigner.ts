// Restores the App's own execution wallet signer from the mnemonic scripts/setup.ts persisted.
// This is the App's OWN operating wallet (server-side custody of the app's funds/revenue flow) --
// a different concern entirely from an end user's self-custody wallet, which is generated and
// held client-side only and never reaches apps/api (IMPLEMENTATION_PLAN.md Fase H).
import { wallet, type ExecutionSigner } from '@wallet-app/ishtaran-client';

export function restoreExecutionSigner(mnemonic: string): ExecutionSigner {
  return wallet.restore(mnemonic).signer;
}
