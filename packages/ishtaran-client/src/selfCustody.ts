// The real SelfCustody signing protocol (DEC-037, CUSTODY-EXECUTION-MODES.md) -- ported from
// examples/marketplace-mercatto/self-custody-settlement.ts and register-execution-wallet.ts,
// which already proved this live against Sandbox. Nothing here is wallet-specific invention:
// same SDK calls, same all-signatures-gate broadcast, same Sandbox confirmation simulation.
// This module is the one place the wallet's private key material ever touches an
// IshtaranClient call -- only ever `sign(...)`, never a raw key sent over the wire (INV-SC-01).
import { DerivationScheme, wallet, type IshtaranClient, type SettlementResponse } from '@ishtaran/sdk';

export interface ExecutionSigner {
  sign(derivationIndex: number, canonicalHash: Uint8Array): Uint8Array;
}

export interface RegisteredExecutionWallet {
  walletId: string;
  signer: ExecutionSigner;
}

/**
 * Generates a brand-new BIP32 execution wallet locally and registers only its public extended
 * key with Ishtaran -- the private key and recovery mnemonic never leave this process. One
 * wallet per (Application, Network), same convention as Mercatto's own bootstrap.
 */
export async function registerExecutionWallet(
  client: IshtaranClient,
  applicationId: string,
  networkId: string,
): Promise<RegisteredExecutionWallet> {
  const generated = wallet.generate();
  const registered = await client.wallets.register(
    applicationId,
    networkId,
    DerivationScheme.TRON_BIP44_HARDENED_ACCOUNT!,
    generated.wallet.accountExtendedPublicKey,
  );
  return { walletId: registered.walletId, signer: generated.signer };
}

const SETTLEMENT_POLL_TIMEOUT_MS = 30_000;
const SETTLEMENT_POLL_INTERVAL_MS = 500;
const BROADCAST_REFERENCE_POLL_TIMEOUT_MS = 20_000;
const BROADCAST_REFERENCE_POLL_INTERVAL_MS = 500;

/**
 * Call this right after `executeSettlement` or `executeRefund`'s underlying settlement leg --
 * signs every ExecutionLeg locally, submits the signatures, simulates on-chain confirmation
 * (Sandbox-only), and waits for the Settlement to reach COMPLETED. Safe to call even when the
 * Settlement had nothing to execute on-chain (all beneficiaries retained) -- `signingRequestId`
 * is null in that case and this resolves immediately.
 */
export async function completeSelfCustodySettlement(
  client: IshtaranClient,
  environmentId: string,
  settlementId: string,
  signer: ExecutionSigner,
): Promise<SettlementResponse> {
  const settlement = await client.settlements.get(settlementId);

  if (settlement.signingRequestId) {
    await signEveryLeg(client, settlement.signingRequestId, signer);
    await confirmEveryLegBroadcast(client, environmentId, settlement.signingRequestId);
  }

  return waitForSettlementCompleted(client, settlementId);
}

async function signEveryLeg(client: IshtaranClient, signingRequestId: string, signer: ExecutionSigner): Promise<void> {
  const signingRequest = await client.signingRequests.get(signingRequestId);

  for (const leg of signingRequest.legs) {
    const hashBytes = hexToBytes(leg.canonicalHash);
    const signatureBytes = signer.sign(signingRequest.derivationReference, hashBytes);
    const signatureHex = bytesToHex(signatureBytes);
    await client.signingRequests.submitSignedTransaction(signingRequestId, leg.executionLegId, leg.canonicalHash, signatureHex);
  }
}

async function confirmEveryLegBroadcast(client: IshtaranClient, environmentId: string, signingRequestId: string): Promise<void> {
  const legs = await waitForLegChainReferences(client, signingRequestId);
  for (const leg of legs) {
    const broadcastAttemptId = sandboxBroadcastAttemptIdFromReference(leg.broadcastReference!);
    await client.sandbox.simulateBroadcastConfirmation(environmentId, broadcastAttemptId, 1, true);
  }
}

async function waitForLegChainReferences(client: IshtaranClient, signingRequestId: string) {
  const deadline = Date.now() + BROADCAST_REFERENCE_POLL_TIMEOUT_MS;
  let signingRequest = await client.signingRequests.get(signingRequestId);

  const isReconciled = () => signingRequest.legs.every((leg) => leg.broadcastReference?.startsWith('sandbox-broadcast-'));

  while (!isReconciled()) {
    const unreconciled = signingRequest.legs.find((leg) => !leg.broadcastReference);
    if (unreconciled) {
      throw new Error(
        `ExecutionLeg ${unreconciled.executionLegId} has no broadcastReference -- expected Broadcast status, got ${unreconciled.status}.`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `SigningRequest ${signingRequestId} still has Legs with an unreconciled broadcastReference after ${BROADCAST_REFERENCE_POLL_TIMEOUT_MS}ms.`,
      );
    }
    await sleep(BROADCAST_REFERENCE_POLL_INTERVAL_MS);
    signingRequest = await client.signingRequests.get(signingRequestId);
  }

  return signingRequest.legs;
}

async function waitForSettlementCompleted(client: IshtaranClient, settlementId: string): Promise<SettlementResponse> {
  const deadline = Date.now() + SETTLEMENT_POLL_TIMEOUT_MS;
  let settlement = await client.settlements.get(settlementId);

  while (settlement.status.name !== 'COMPLETED') {
    if (settlement.status.name === 'FAILED') {
      throw new Error(`Settlement ${settlementId} reached FAILED while waiting for confirmation.`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Settlement ${settlementId} did not reach COMPLETED within ${SETTLEMENT_POLL_TIMEOUT_MS}ms -- last status=${settlement.status.name}`);
    }
    await sleep(SETTLEMENT_POLL_INTERVAL_MS);
    settlement = await client.settlements.get(settlementId);
  }

  return settlement;
}

function sandboxBroadcastAttemptIdFromReference(reference: string): string {
  const prefix = 'sandbox-broadcast-';
  if (!reference.startsWith(prefix)) {
    throw new Error(`Unexpected broadcastReference format (not a Sandbox reference): ${reference}`);
  }
  const hexN = reference.slice(prefix.length);
  return `${hexN.slice(0, 8)}-${hexN.slice(8, 12)}-${hexN.slice(12, 16)}-${hexN.slice(16, 20)}-${hexN.slice(20, 32)}`;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
