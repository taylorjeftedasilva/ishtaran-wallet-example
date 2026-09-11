// Slice 9 (IMPLEMENTATION_PLAN.md Fase I flow 8, A2) -- Refund, exclusively pre-Settlement.
// GAPS.md/A2 (confirmed live and from Mercatto's own already-proven scenario): once a Settlement
// has distributed the Distributable Amount, there is no platform mechanism to reverse it --
// ExecuteRefund only ever refunds the still-Reserved remainder. This route is only ever reachable
// while the real Transaction is RESERVED (funded, not yet finalized) -- calling it after
// /finalize has run is a real, expected rejection, never worked around.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { executeRefund, getTransactionState } from '@wallet-app/ishtaran-client';
import type { AppContext } from '../app.js';
import { requireSession, type AuthenticatedRequest } from './auth.js';

export function registerRefundRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.post<{ Params: { transactionId: string }; Body: { reason?: string } }>(
    '/payments/:transactionId/refund',
    { preHandler: requireSession },
    async (request, reply) => {
      const { transactionId } = request.params;
      const { accountId } = (request as AuthenticatedRequest).user;

      const state = await getTransactionState(app.appClient, transactionId);
      if (state.status.name !== 'RESERVED') {
        return reply.code(409).send({
          error: `Refund is only available while the Transaction is RESERVED (pre-Settlement) -- current status is ${state.status.name}.`,
          code: 'REFUND_NOT_AVAILABLE',
        });
      }

      const idempotencyKey = `${accountId}:${transactionId}:refund`;
      const refund = await executeRefund(app.appClient, transactionId, request.body?.reason, idempotencyKey);

      const now = new Date().toISOString();
      db.prepare('UPDATE transaction_views SET refund_id = ?, status = ?, updated_at = ? WHERE ishtaran_transaction_id = ?').run(
        refund.refundId, 'REFUNDED', now, transactionId,
      );

      return reply.code(201).send(refund);
    },
  );
}
