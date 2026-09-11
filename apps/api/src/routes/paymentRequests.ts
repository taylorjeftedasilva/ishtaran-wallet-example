// Slice 9 (IMPLEMENTATION_PLAN.md Fase I flow 3, PRODUCT_SPEC.md Section 12) -- Payment Request.
// No platform-level "payment request" primitive exists -- this is entirely an App Database
// concept (PaymentRequest record) that, once paid, drives the EXACT SAME real
// CreateTransaction+CreatePaymentIntent+ExecuteSettlement flow as any other payment
// (routes/payments.ts's createPayment/finalizePayment, reused here rather than duplicated).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { RevenueEvent } from '@wallet-app/wallet-core';
import type { AppContext } from '../app.js';
import { requireSession, type AuthenticatedRequest } from './auth.js';
import { calculatePaymentFees, createPayment } from './payments.js';

const DEFAULT_EXPIRY_MINUTES = 60;

interface PaymentRequestRow {
  id: string;
  requester_account_id: string;
  requester_user_id: string;
  amount: string;
  description: string;
  status: string;
  transaction_id: string | null;
  created_at: string;
  expires_at: string;
}

export function registerPaymentRequestRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  app.post<{ Body: { amount: string; description?: string; expiryMinutes?: number } }>(
    '/wallet/payment-requests',
    { preHandler: requireSession },
    async (request, reply) => {
      const { amount, expiryMinutes } = request.body;
      // Optional -- product feedback (Prompt 2 manual review): a "what's this for?" note is
      // convenient, never a real requirement of the platform or of this local record itself
      // (never surfaced to Ishtaran at all until paid). Stored as '' rather than NULL to avoid an
      // existing-column migration on the local SQLite dev DB -- every display site below falls
      // back to a neutral label when empty, never showing a blank line.
      const description = request.body.description?.trim() ?? '';
      const { userId, accountId } = (request as AuthenticatedRequest).user;
      if (!amount) return reply.code(400).send({ error: 'amount is required' });
      if (!config.wallet.paymentRequest.enabled) return reply.code(403).send({ error: 'Payment requests are disabled in this wallet.config.ts' });

      const id = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (expiryMinutes ?? config.wallet.paymentRequest.defaultExpiryMinutes ?? DEFAULT_EXPIRY_MINUTES) * 60_000);

      db.prepare(
        `INSERT INTO payment_requests (id, requester_account_id, requester_user_id, amount, description, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, accountId, userId, amount, description, 'ACTIVE', now.toISOString(), expiresAt.toISOString());

      return reply.code(201).send({ id, amount, description, status: 'ACTIVE', expiresAt: expiresAt.toISOString() });
    },
  );

  // List the current user's own requests, newest first -- purely additive read (the row shape
  // and creation/payment logic above are untouched), needed for a real Receive/Payment-Request
  // screen instead of only being reachable by a known id. PAID requests are excluded by default --
  // once paid, the real record lives in Activity (via the Transaction createPayment already
  // wrote into transaction_views), so "Suas cobranças" stays a clean list of what's still
  // outstanding rather than growing forever with resolved items (product feedback, Prompt 2).
  app.get<{ Querystring: { includePaid?: string } }>('/wallet/payment-requests', { preHandler: requireSession }, async (request) => {
    const { accountId } = (request as AuthenticatedRequest).user;
    const rows = db
      .prepare('SELECT * FROM payment_requests WHERE requester_account_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(accountId) as unknown as PaymentRequestRow[];
    const now = new Date();
    const withFreshStatus = rows.map((row) => {
      if (row.status === 'ACTIVE' && new Date(row.expires_at) < now) {
        db.prepare("UPDATE payment_requests SET status = 'EXPIRED' WHERE id = ?").run(row.id);
        return { ...row, status: 'EXPIRED' };
      }
      return row;
    });
    return request.query.includePaid === '1' ? withFreshStatus : withFreshStatus.filter((row) => row.status !== 'PAID');
  });

  app.get<{ Params: { id: string } }>('/wallet/payment-requests/:id', { preHandler: requireSession }, async (request, reply) => {
    const row = db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(request.params.id) as PaymentRequestRow | undefined;
    if (!row) return reply.code(404).send({ error: 'Payment request not found' });

    if (row.status === 'ACTIVE' && new Date(row.expires_at) < new Date()) {
      db.prepare("UPDATE payment_requests SET status = 'EXPIRED' WHERE id = ?").run(row.id);
      row.status = 'EXPIRED';
    }
    return reply.send(row);
  });

  // Product feedback (Prompt 2 manual review): the review screen the payer sees before confirming
  // must show the REAL fee split, but must NEVER create a real Transaction to do it -- that
  // used to happen here (calling /pay early) and left a visible AWAITING_FUNDS entry in the
  // payer's own Activity feed before they had confirmed anything. `calculatePaymentFees` is a
  // pure, deterministic, config-driven computation (same one createPayment itself uses) -- no
  // Ishtaran call, no local write, nothing "sent" by looking at this.
  app.get<{ Params: { id: string } }>('/wallet/payment-requests/:id/preview-fees', { preHandler: requireSession }, async (request, reply) => {
    const row = db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(request.params.id) as PaymentRequestRow | undefined;
    if (!row) return reply.code(404).send({ error: 'Payment request not found' });
    if (row.status === 'ACTIVE' && new Date(row.expires_at) < new Date()) {
      db.prepare("UPDATE payment_requests SET status = 'EXPIRED' WHERE id = ?").run(row.id);
      return reply.code(409).send({ error: 'This payment request has expired', code: 'PAYMENT_REQUEST_EXPIRED' });
    }
    if (row.status !== 'ACTIVE') {
      return reply.code(409).send({ error: `This payment request is ${row.status}, not payable`, code: 'PAYMENT_REQUEST_NOT_ACTIVE' });
    }
    const calculation = calculatePaymentFees(config.wallet, row.amount, 'PAYMENT');
    return reply.send({ calculation });
  });

  app.post<{ Params: { id: string } }>('/wallet/payment-requests/:id/pay', { preHandler: requireSession }, async (request, reply) => {
    const { accountId: payerAccountId, walletAddress } = (request as AuthenticatedRequest).user;
    if (!walletAddress) {
      return reply.code(409).send({ error: 'This session has no known wallet address on file.', code: 'WALLET_ADDRESS_UNKNOWN' });
    }
    const row = db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(request.params.id) as PaymentRequestRow | undefined;
    if (!row) return reply.code(404).send({ error: 'Payment request not found' });
    if (row.status === 'ACTIVE' && new Date(row.expires_at) < new Date()) {
      db.prepare("UPDATE payment_requests SET status = 'EXPIRED' WHERE id = ?").run(row.id);
      return reply.code(409).send({ error: 'This payment request has expired', code: 'PAYMENT_REQUEST_EXPIRED' });
    }
    if (row.status !== 'ACTIVE') {
      return reply.code(409).send({ error: `This payment request is ${row.status}, not payable`, code: 'PAYMENT_REQUEST_NOT_ACTIVE' });
    }

    // Product feedback (Prompt 2 manual review): this only creates the real Transaction +
    // PaymentIntent (needed here, not later, so the review screen can show the REAL server-
    // computed fee split before the payer confirms anything -- the same reason a real checkout
    // creates a PaymentIntent up front). It must NEVER mark this request PAID -- nothing has
    // actually been funded or settled yet at this point (that only happens via
    // simulate-sandbox-send + finalize, still ahead). The previous version marked PAID right
    // here, which meant a payer who saw the review screen and backed out (or whose
    // simulate-send/finalize later failed) left behind a request wrongly marked PAID with no real
    // payment behind it -- a real correctness bug, not just a UX one. Status only flips to PAID
    // once `/payments/:transactionId/finalize` (routes/payments.ts) actually confirms Settlement
    // completed. Idempotent by construction: Ishtaran's own idempotencyKey
    // (`payment-request:${row.id}`) means calling this again (a retry, or the user re-entering
    // review) returns the SAME Transaction, never a second one.
    const event: RevenueEvent = 'PAYMENT';
    const result = await createPayment(app, ctx, payerAccountId, row.requester_account_id, row.amount, event, `payment-request:${row.id}`);

    db.prepare('UPDATE payment_requests SET transaction_id = ? WHERE id = ?').run(result.transactionId, row.id);

    return reply.code(201).send(result);
  });

  // "Cancelar cobrança" -- only the requester, only while still ACTIVE (and not already expired).
  // Purely a local App Database concept (no Transaction/PaymentIntent exists yet at this point --
  // see the module comment above), so cancelling here is always safe: nothing real to unwind.
  app.post<{ Params: { id: string } }>('/wallet/payment-requests/:id/cancel', { preHandler: requireSession }, async (request, reply) => {
    const { accountId } = (request as AuthenticatedRequest).user;
    const row = db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(request.params.id) as PaymentRequestRow | undefined;
    if (!row) return reply.code(404).send({ error: 'Payment request not found' });
    if (row.requester_account_id !== accountId) {
      return reply.code(403).send({ error: 'Only the requester can cancel this payment request', code: 'NOT_REQUEST_OWNER' });
    }
    if (row.status === 'ACTIVE' && new Date(row.expires_at) < new Date()) {
      db.prepare("UPDATE payment_requests SET status = 'EXPIRED' WHERE id = ?").run(row.id);
      return reply.code(409).send({ error: 'This payment request already expired', code: 'PAYMENT_REQUEST_EXPIRED' });
    }
    if (row.status !== 'ACTIVE') {
      return reply.code(409).send({ error: `This payment request is ${row.status}, cannot be cancelled`, code: 'PAYMENT_REQUEST_NOT_ACTIVE' });
    }
    db.prepare("UPDATE payment_requests SET status = 'CANCELLED' WHERE id = ?").run(row.id);
    return reply.send({ id: row.id, status: 'CANCELLED' });
  });

  // "Remover da lista" -- only the requester, only for a request that never became a real payment
  // (EXPIRED or CANCELLED -- `transaction_id` is guaranteed null for both, checked defensively
  // below anyway). A PAID request is never deletable here -- its real record belongs to Activity/
  // the underlying Transaction, not to this purely-local convenience list.
  app.delete<{ Params: { id: string } }>('/wallet/payment-requests/:id', { preHandler: requireSession }, async (request, reply) => {
    const { accountId } = (request as AuthenticatedRequest).user;
    const row = db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(request.params.id) as PaymentRequestRow | undefined;
    if (!row) return reply.code(404).send({ error: 'Payment request not found' });
    if (row.requester_account_id !== accountId) {
      return reply.code(403).send({ error: 'Only the requester can remove this payment request', code: 'NOT_REQUEST_OWNER' });
    }
    if ((row.status !== 'EXPIRED' && row.status !== 'CANCELLED') || row.transaction_id) {
      return reply.code(409).send({ error: 'Only an expired or cancelled request with no payment can be removed', code: 'PAYMENT_REQUEST_NOT_REMOVABLE' });
    }
    db.prepare('DELETE FROM payment_requests WHERE id = ?').run(row.id);
    return reply.code(204).send();
  });
}
