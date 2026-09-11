// Slice 7 (IMPLEMENTATION_PLAN.md Fase K) -- History projection. Read-only, from the App
// Database's own TransactionView rows -- never the economic source of truth (Section 20); every
// row is kept in sync by the webhook receiver (webhooks.ts) and by each route that changes state
// directly (payments.ts, withdrawals.ts). A periodic reconciliation job (re-fetch any
// non-terminal row older than N minutes) is not built in V1 -- flagged, not silently assumed.
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireSession, type AuthenticatedRequest } from './auth.js';

export function registerHistoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/wallet/history', { preHandler: requireSession }, async (request) => {
    const { accountId } = (request as AuthenticatedRequest).user;
    return db
      .prepare('SELECT * FROM transaction_views WHERE account_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(accountId);
  });
}
