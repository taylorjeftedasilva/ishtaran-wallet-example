// Backend configuration -- the real API Key lives ONLY here, loaded server-side from the local
// Sandbox bootstrap file `scripts/setup.ts` produced (IMPLEMENTATION_PLAN.md Fase G's hard rule:
// the API Key never appears in apps/web). Fails loudly and immediately if bootstrap hasn't run --
// never falls back to a fake/empty credential.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeWalletConfig } from '../../../config/wallet.config.js';
import type { WalletConfig } from '@wallet-app/wallet-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const BOOTSTRAP_PATH = join(REPO_ROOT, 'config', '.sandbox-bootstrap.json');
const DEFAULT_DB_PATH = join(REPO_ROOT, 'apps', 'api', 'wallet-app.sqlite');

export interface SandboxBootstrap {
  runId: string;
  organizationId: string;
  applicationId: string;
  environmentId: string;
  apiKey: string;
  memberRefreshToken: string;
  assetNetworkId: string;
  networkId: string;
  executionWalletId: string;
  executionWalletMnemonic: string;
  appRevenueAccountId: string;
  networkCostPayerAccountId: string;
  executionSourceId: string;
  webhookEndpointId: string;
  webhookSecret: string;
  createdAt: string;
}

export interface AppConfig {
  bootstrap: SandboxBootstrap;
  bootstrapPath: string;
  wallet: WalletConfig;
  port: number;
  dbPath: string;
  /** V1 simplification (Slice 8), loudly documented: a single shared owner token, not full
   * Member-JWT SSO -- a real production dashboard would authenticate the App Owner via their own
   * Member login (Fase G's own table already notes this). Never the API Key itself. */
  ownerToken: string;
}

function loadBootstrap(): SandboxBootstrap {
  let raw: string;
  try {
    raw = readFileSync(BOOTSTRAP_PATH, 'utf8');
  } catch {
    throw new Error(
      `No Sandbox bootstrap found at ${BOOTSTRAP_PATH}. Run "npm run setup" from the repo root first -- ` +
        'apps/api never starts with a fake/empty API Key.',
    );
  }
  return JSON.parse(raw) as SandboxBootstrap;
}

export function loadConfig(): AppConfig {
  return {
    bootstrap: loadBootstrap(),
    bootstrapPath: BOOTSTRAP_PATH,
    wallet: activeWalletConfig,
    port: Number(process.env.PORT ?? 3001),
    dbPath: process.env.WALLET_DB_PATH ?? DEFAULT_DB_PATH,
    ownerToken: process.env.WALLET_OWNER_TOKEN ?? 'owner-dev-token',
  };
}
