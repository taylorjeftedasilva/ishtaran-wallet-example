import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/wallet/cryptoStorage.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('encryptSecret / decryptSecret', () => {
  it('round-trips the secret with the correct passphrase', async () => {
    const blob = await encryptSecret(MNEMONIC, 'correct horse battery staple');
    const recovered = await decryptSecret(blob, 'correct horse battery staple');
    expect(recovered).toBe(MNEMONIC);
  });

  it('rejects the wrong passphrase instead of returning garbage', async () => {
    const blob = await encryptSecret(MNEMONIC, 'correct horse battery staple');
    await expect(decryptSecret(blob, 'wrong passphrase')).rejects.toThrow();
  });

  it('never stores the plaintext secret in the blob', async () => {
    const blob = await encryptSecret(MNEMONIC, 'a passphrase');
    expect(blob.ciphertext).not.toContain(MNEMONIC);
    expect(JSON.stringify(blob)).not.toContain('abandon');
  });

  it('uses a fresh salt/iv on every call (never reuses nonce material)', async () => {
    const first = await encryptSecret(MNEMONIC, 'same passphrase');
    const second = await encryptSecret(MNEMONIC, 'same passphrase');
    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });
});
