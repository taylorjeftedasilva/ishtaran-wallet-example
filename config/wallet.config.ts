// The one file a future config-driven builder edits to reshape this reference project's product
// behavior (IMPLEMENTATION_PLAN.md Fase D/S -- the Builder LEGO contract). apps/api and apps/web
// both import `activeWalletConfig` from here; nothing else decides mode/branding/revenue rules.
//
// Switch modes by changing WALLET_APP_MODE (env) or the fallback below -- never by editing
// packages/wallet-core's preset objects themselves (those are the schema + the two reference
// presets; this file is the actual selection).
import { loadWalletConfig, type WalletConfig } from '@wallet-app/wallet-core';

const mode = (process.env.WALLET_APP_MODE === 'MONETIZED' ? 'MONETIZED' : 'PERSONAL') satisfies WalletConfig['mode'];

export const activeWalletConfig: WalletConfig = loadWalletConfig(mode);
