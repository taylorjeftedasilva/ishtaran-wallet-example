import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// apps/web never receives the API Key or any Ishtaran credential (IMPLEMENTATION_PLAN.md Fase G)
// -- it only ever talks to apps/api's own HTTP surface, at VITE_API_BASE (see src/apiClient.ts).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist' },
  resolve: {
    alias: {
      // @ishtaran/sdk (used by src/wallet/localWallet.ts for pure wallet-derivation helpers) is
      // published as a single Node.js bundle with no browser entry point -- it also contains
      // unrelated Node `crypto` imports (idempotency-key/HMAC helpers, never called from this
      // app) that Vite would otherwise externalize into a proxy that throws on access, blanking
      // the whole page. See src/shims/node-crypto-browser.ts for exactly what's shimmed and why.
      crypto: fileURLToPath(new URL('./src/shims/node-crypto-browser.ts', import.meta.url)),
    },
  },
});
