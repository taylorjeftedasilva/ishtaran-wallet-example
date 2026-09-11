// High-level self-custody wallet API for apps/web -- the ONLY place in this codebase that ever
// holds a plaintext mnemonic or private key, and only ever transiently, in memory
// (IMPLEMENTATION_PLAN.md Fase H). Wraps @ishtaran/sdk's own wallet.generate()/wallet.restore()
// (never a home-grown BIP39/BIP32 implementation) + cryptoStorage's passphrase encryption +
// walletStore's IndexedDB persistence.
import { deriveTronAddress, wallet } from '@ishtaran/sdk';
import { decryptSecret, encryptSecret } from './cryptoStorage.js';
import { clearWalletRecord, loadWalletRecord, saveWalletRecord } from './walletStore.js';

const RECEIVING_ADDRESS_INDEX = 0;

export interface LocalSigner {
  sign(derivationIndex: number, canonicalHash: Uint8Array): Uint8Array;
}

export async function hasWallet(): Promise<boolean> {
  return (await loadWalletRecord()) !== undefined;
}

/** Generates a brand-new wallet, encrypts its mnemonic at rest, and returns the mnemonic ONCE --
 * the caller must show it to the user immediately (Section 22/R's Security screen) and never
 * log/transmit it. Overwrites any existing local wallet record. */
export async function createWallet(passphrase: string): Promise<{ mnemonic: string; address: string }> {
  const generated = wallet.generate();
  const address = deriveTronAddress(generated.wallet.accountExtendedPublicKey, RECEIVING_ADDRESS_INDEX);
  const encryptedMnemonic = await encryptSecret(generated.mnemonic, passphrase);
  await saveWalletRecord({
    encryptedMnemonic,
    accountExtendedPublicKey: generated.wallet.accountExtendedPublicKey,
    address,
    createdAt: new Date().toISOString(),
  });
  return { mnemonic: generated.mnemonic, address };
}

/** Recovery path: restores a wallet from an existing mnemonic (e.g. a new device) instead of
 * generating one. Same real SDK primitive, never a bespoke derivation. */
export async function importWallet(mnemonic: string, passphrase: string): Promise<{ address: string }> {
  const restored = wallet.restore(mnemonic);
  const address = deriveTronAddress(restored.wallet.accountExtendedPublicKey, RECEIVING_ADDRESS_INDEX);
  const encryptedMnemonic = await encryptSecret(mnemonic, passphrase);
  await saveWalletRecord({
    encryptedMnemonic,
    accountExtendedPublicKey: restored.wallet.accountExtendedPublicKey,
    address,
    createdAt: new Date().toISOString(),
  });
  return { address };
}

/** The receiving address never requires the passphrase -- it's public material, safe to show
 * (and re-derive) without unlocking anything. */
export async function getReceivingAddress(): Promise<string | undefined> {
  const record = await loadWalletRecord();
  return record?.address;
}

/** Decrypts the mnemonic transiently to produce a signer -- the passphrase gate
 * IMPLEMENTATION_PLAN.md Fase H calls "biometric/passphrase confirmation." Throws on a wrong
 * passphrase (AES-GCM auth-tag failure), never silently returns an unusable signer. */
export async function unlockSigner(passphrase: string): Promise<LocalSigner> {
  const record = await loadWalletRecord();
  if (!record) throw new Error('No local wallet found -- create or import one first.');
  const mnemonic = await decryptSecret(record.encryptedMnemonic, passphrase);
  const restored = wallet.restore(mnemonic);
  return restored.signer;
}

export async function forgetWallet(): Promise<void> {
  await clearWalletRecord();
}

/** Same decrypt call as unlockSigner, returning the plaintext mnemonic instead of a signer --
 * for the Settings "view recovery phrase" flow (product requirement: explicit action + password
 * re-entry to reveal, never shown casually). Throws on a wrong passphrase, same as unlockSigner. */
export async function revealMnemonic(passphrase: string): Promise<string> {
  const record = await loadWalletRecord();
  if (!record) throw new Error('No local wallet found -- create or import one first.');
  return decryptSecret(record.encryptedMnemonic, passphrase);
}
