// Slice 7 (IMPLEMENTATION_PLAN.md Fase L) -- webhook receiver. Reads the RAW body (before any
// JSON parsing) to verify `X-Webhook-Signature` via the SDK's own real
// `verifyWebhookSignature` (HMAC-SHA256 over `{unixTimestampSeconds}.{rawBody}`, constant-time
// compare, timestamp tolerance -- the exact algorithm the platform itself uses, never
// reimplemented here). The event type is never in the delivery itself (real, documented platform
// DX gap) -- this infers intent from which PascalCase ID field is present in the body
// (TransactionId/SettlementId/WithdrawalId/RefundId), then re-fetches the real aggregate rather
// than trusting the webhook body's own snapshot (Fase K: a webhook is only ever a hint to
// re-fetch, never itself the new state). Dedupes on `X-Webhook-Delivery-Id`.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { verifyWebhookSignature } from '@ishtaran/sdk';
import { getSettlement, getTransaction, getWithdrawal } from '@wallet-app/ishtaran-client';
import type { AppContext } from '../app.js';

export function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const { webhookSecret } = config.bootstrap;

  app.register(async (instance) => {
    // Scoped to this plugin instance only -- every other route keeps Fastify's normal JSON
    // body parsing. Signature verification needs the EXACT bytes as received, never a
    // re-serialized version of the parsed JSON (Fase L, and the SDK's own doc comment on
    // `computeWebhookSignature`: "never reserializes the JSON before computing").
    instance.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      done(null, body);
    });

    instance.post('/webhooks/ishtaran', async (request, reply) => {
      const rawBody = request.body as string;
      const signature = request.headers['x-webhook-signature'];
      const timestamp = request.headers['x-webhook-timestamp'];
      const deliveryId = request.headers['x-webhook-delivery-id'];

      if (typeof signature !== 'string' || typeof timestamp !== 'string' || typeof deliveryId !== 'string') {
        return reply.code(400).send({ error: 'Missing required webhook headers' });
      }
      if (!verifyWebhookSignature(rawBody, signature, timestamp, webhookSecret)) {
        return reply.code(401).send({ error: 'Invalid webhook signature' });
      }

      const alreadyProcessed = db.prepare('SELECT delivery_id FROM webhook_deliveries WHERE delivery_id = ?').get(deliveryId);
      if (alreadyProcessed) {
        return reply.code(200).send({ deduped: true });
      }

      const payload = JSON.parse(rawBody) as Record<string, unknown>;
      await reconcileFromPayload(app, ctx, payload);

      db.prepare('INSERT INTO webhook_deliveries (delivery_id, processed_at) VALUES (?, ?)').run(deliveryId, new Date().toISOString());
      return reply.code(200).send({ received: true });
    });
  });
}

async function reconcileFromPayload(app: FastifyInstance, ctx: AppContext, payload: Record<string, unknown>): Promise<void> {
  const { db } = ctx;
  const now = new Date().toISOString();

  if (typeof payload.TransactionId === 'string') {
    const transaction = await getTransaction(app.appClient, payload.TransactionId);
    db.prepare('UPDATE transaction_views SET status = ?, updated_at = ? WHERE ishtaran_transaction_id = ?').run(
      transaction.status.name, now, payload.TransactionId,
    );
  }
  if (typeof payload.SettlementId === 'string') {
    const settlement = await getSettlement(app.appClient, payload.SettlementId);
    db.prepare('UPDATE transaction_views SET status = ?, settlement_id = ?, updated_at = ? WHERE ishtaran_transaction_id = ?').run(
      settlement.status.name, settlement.settlementId, now, settlement.transactionId,
    );
  }
  if (typeof payload.WithdrawalId === 'string') {
    const withdrawal = await getWithdrawal(app.appClient, payload.WithdrawalId);
    db.prepare('UPDATE transaction_views SET status = ?, technical_reference = ?, updated_at = ? WHERE withdrawal_id = ?').run(
      withdrawal.status.name, withdrawal.technicalReference, now, payload.WithdrawalId,
    );
  }
}
