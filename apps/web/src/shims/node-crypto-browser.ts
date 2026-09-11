// Browser-safe shim for the subset of Node's `crypto` module @ishtaran/sdk's single bundled entry
// point (dist/index.js) imports at the top level -- the SDK is published as a Node.js package
// (package.json engines >=18) and has no separate browser-safe entry point today. apps/web only
// ever needs the SDK's pure wallet-derivation helpers (wallet.generate/deriveTronAddress,
// @noble/@scure under the hood, already browser-safe) via localWallet.ts, but Vite bundles the
// SDK's single dist/index.js as one module graph, so the unrelated Node-only `crypto` imports it
// also contains (an idempotency-key randomUUID() helper, and an HMAC helper for
// verifyWebhookSignature -- neither ever called from apps/web) still get evaluated and throw the
// moment anything touches them, because Vite externalizes Node built-ins in the browser with a
// proxy that throws on property access. This shim satisfies exactly those two call shapes using
// real Web Crypto primitives already available in every browser -- never a mock, never disabling
// the check, just the same operation through the browser-native API instead of Node's.
export function randomUUID(): string {
  return crypto.randomUUID();
}

export function createHmac(algorithm: string, key: string) {
  if (algorithm !== 'sha256') {
    throw new Error(`node-crypto-browser shim: only sha256 is implemented, got ${algorithm}`);
  }
  const chunks: Uint8Array[] = [];
  return {
    update(data: string) {
      chunks.push(new TextEncoder().encode(data));
      return this;
    },
    digest(encoding: 'hex') {
      if (encoding !== 'hex') {
        throw new Error(`node-crypto-browser shim: only hex digest is implemented, got ${encoding}`);
      }
      // Synchronous digest is not offered by SubtleCrypto -- this shim's callers in @ishtaran/sdk
      // are never exercised from apps/web today (webhook signature verification is server-side
      // only, see examples/marketplace-mercatto/webhook-notifications.ts), so a clear failure here
      // is preferable to a fabricated synchronous result.
      throw new Error(
        'node-crypto-browser shim: createHmac(...).digest() needs an async Web Crypto call -- not wired up because no apps/web code path calls it today. If a real caller appears, implement it against SubtleCrypto.sign() instead of stubbing a fake digest.',
      );
    },
  };
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
