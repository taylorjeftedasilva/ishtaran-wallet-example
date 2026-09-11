// Passphrase-based encryption for the wallet's recovery mnemonic -- pure WebCrypto (PBKDF2 key
// derivation + AES-GCM), no third-party crypto library. Storage-agnostic on purpose (unit
// testable in Node, which has the same `crypto.subtle` global as a browser) -- IndexedDB wiring
// lives in walletStore.ts. This is the `BrowserDemoSigner` storage layer IMPLEMENTATION_PLAN.md
// Fase H calls out as explicitly NOT hardware-backed -- a real mobile app would use
// iOS Keychain / Android Keystore instead (SECURITY.md says so plainly).
const PBKDF2_ITERATIONS = 210_000; // OWASP 2023 minimum for PBKDF2-HMAC-SHA256.
const SALT_BYTES = 16;
const IV_BYTES = 12; // AES-GCM standard nonce size.

export interface EncryptedBlob {
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64 (includes the GCM auth tag)
}

// lib.dom.d.ts (TS 5.7+) types typed-array-returning APIs as Uint8Array<ArrayBufferLike>, which
// WebCrypto's BufferSource overloads no longer accept structurally -- these are real, valid
// BufferSource values at runtime (a plain Uint8Array backed by a real ArrayBuffer), so a
// same-shape cast at each WebCrypto call site is correct, not a type-safety compromise.
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSecret(secret: string, passphrase: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(secret));
  return { salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

/** Throws if the passphrase is wrong (AES-GCM's auth tag fails to verify) -- never returns garbage silently. */
export async function decryptSecret(blob: EncryptedBlob, passphrase: string): Promise<string> {
  const salt = fromBase64(blob.salt);
  const iv = fromBase64(blob.iv);
  const key = await deriveKey(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, fromBase64(blob.ciphertext) as BufferSource);
  return new TextDecoder().decode(plaintext);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
