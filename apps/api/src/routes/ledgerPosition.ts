// GAPS.md G.8 -- renamed from routes/balance.ts (formerly `/wallet/balance`) now that that path
// means the WALLET's own on-chain/Sandbox balance (routes/walletBalance.ts). This route is
// Ishtaran's own real economic position for the account -- available/pending/reserved/payable/
// reservedForPayout/delivered -- always distinct from, never summed with, the wallet balance.
// Always backend-proxied (F.10: AccountHolder JWT cannot call Ledger at all).
import type { FastifyInstance } from 'fastify';
import { getFullAccountBalance } from '@wallet-app/ishtaran-client';
import type { AppContext } from '../app.js';
import { requireSession, type AuthenticatedRequest } from './auth.js';

export function registerLedgerPositionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { apiKey, assetNetworkId } = ctx.config.bootstrap;

  app.get('/wallet/ledger-position', { preHandler: requireSession }, async (request) => {
    const { accountId } = (request as AuthenticatedRequest).user;
    return getFullAccountBalance(apiKey, accountId, assetNetworkId);
  });
}
