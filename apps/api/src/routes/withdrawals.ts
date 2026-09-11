// Slice 6 (IMPLEMENTATION_PLAN.md Fase I flow 6) -- Withdrawal, real cooldowns respected, never
// bypassed. `CreateWithdrawalDestination` starts a real 24h activation cooldown
// (`WITHDRAWAL_DESTINATION_NOT_USABLE` until elapsed) -- this route never works around that; a
// rejection here is the platform working correctly, not a bug (Mercatto's own GAPS.md F.4).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createWithdrawalDestination, getWithdrawalQuote, requestWithdrawal } from '@wallet-app/ishtaran-client';
import type { AppContext } from '../app.js';
import { requireSession, type AuthenticatedRequest } from './auth.js';

export function registerWithdrawalRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const { organizationId, environmentId, assetNetworkId } = config.bootstrap;

  app.post<{ Body: { address: string } }>('/wallet/withdrawal-destinations', { preHandler: requireSession }, async (request, reply) => {
    const { address } = request.body;
    if (!address) return reply.code(400).send({ error: 'address is required' });
    const destination = await createWithdrawalDestination(app.appClient, organizationId, address, assetNetworkId);
    return reply.code(201).send(destination);
  });

  app.get<{ Querystring: { withdrawalDestinationId: string; amount: string } }>(
    '/wallet/withdrawal-quote',
    { preHandler: requireSession },
    async (request, reply) => {
      const { withdrawalDestinationId, amount } = request.query;
      const { accountId } = (request as AuthenticatedRequest).user;
      if (!withdrawalDestinationId || !amount) return reply.code(400).send({ error: 'withdrawalDestinationId and amount are required' });
      const quote = await getWithdrawalQuote(app.appClient, organizationId, environmentId, accountId, withdrawalDestinationId, assetNetworkId, amount);
      return reply.send(quote);
    },
  );

  app.post<{ Body: { withdrawalDestinationId: string; amount: string; clientWithdrawalIntentId?: string } }>(
    '/wallet/withdrawals',
    { preHandler: requireSession },
    async (request, reply) => {
      const { withdrawalDestinationId, amount, clientWithdrawalIntentId } = request.body;
      const { userId, accountId } = (request as AuthenticatedRequest).user;
      if (!withdrawalDestinationId || !amount) return reply.code(400).send({ error: 'withdrawalDestinationId and amount are required' });

      // Fase M -- stable per real intent, never freshly generated per HTTP retry.
      const idempotencyKey = clientWithdrawalIntentId ?? `${userId}:${withdrawalDestinationId}:${amount}`;
      const withdrawal = await requestWithdrawal(app.appClient, organizationId, environmentId, accountId, withdrawalDestinationId, assetNetworkId, amount, idempotencyKey);

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO transaction_views
          (id, kind, withdrawal_id, account_id, amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), 'withdrawal', withdrawal.withdrawalId, accountId, amount, withdrawal.status.name, now, now);

      return reply.code(201).send(withdrawal);
    },
  );

  app.get('/wallet/withdrawals', { preHandler: requireSession }, async (request) => {
    const { accountId } = (request as AuthenticatedRequest).user;
    const all = await app.appClient.withdrawals.list(organizationId);
    return all.filter((w) => w.accountId === accountId);
  });
}
