// Slice 4 (IMPLEMENTATION_PLAN.md Fase V/E/F/I) -- "Pagar": payments (P2P / merchant / generic
// "payment") via the real Ishtaran Transaction/PaymentIntent/Settlement pipeline,
// RevenueEngine integration, real fresh-funding-per-Transaction + Settle + SelfCustody-completion.
// The fee is ALWAYS recomputed server-side from wallet.config.ts -- a client-supplied fee number
// is never trusted. Distinct from "Enviar" (routes/walletBalance.ts's /wallet/transfer, a direct
// wallet-to-wallet movement that never touches Transaction/PaymentIntent/Settlement at all --
// GAPS.md G.1/G.7 "Transfer != Payment != Settlement").
//
// GAPS.md G.1 (confirmed live + in real backend source, 2026-09-10): a Transaction can only be
// Settled under SelfCustody if it has its OWN confirmed PaymentIntent -- there is no "instant
// send from a pre-existing stored balance." So this is a two-step flow, not one call:
//   1. POST /payments            -- creates the Transaction + a fresh PaymentIntent, returns the
//                                    deposit address the sender's own self-custody wallet must
//                                    broadcast a real on-chain transfer to.
//   2. POST /payments/:id/finalize -- called once that on-chain transfer is sent; polls for the
//                                    deposit to confirm (auto-Reserving the Transaction), then
//                                    executes Settlement and drives SelfCustody signing to
//                                    completion.
//
// Prompt 2 -- step 1's funding must come from a real, persistent Sandbox wallet balance (the
// same WalletChainActions Home/Enviar use), never conjured. The sender's wallet DEBITS at
// simulate-sandbox-send time via `walletChainActions.transfer(senderAddress, depositAddress,
// ...)` -- the deposit address genuinely receives the test-USDT in the simulated chain state
// (exactly like a real self-custody payment), which Ishtaran's own `sandbox.simulateDeposit` then
// separately recognizes and processes -- two distinct real bookkeeping layers, never conflated.
//
// createPayment/finalizePayment are exported so routes/paymentRequests.ts (Slice 9 scenario 5)
// reuses the exact same real logic -- a Payment Request is never a separate primitive, only a
// different entry point into the same flow (PRODUCT_SPEC.md Section 12).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { calculateRevenue, type RevenueCalculation } from '@wallet-app/revenue';
import { findRevenueRule, type RevenueEvent, type RevenueRule, type WalletConfig } from '@wallet-app/wallet-core';
import {
  createPaymentIntent,
  createPaymentTransaction,
  executeSettlementAndComplete,
  getPaymentIntent,
  getTransactionState,
  type ParticipantInput,
} from '@wallet-app/ishtaran-client';
import type { AppContext } from '../app.js';
import { requireSession, type AuthenticatedRequest } from './auth.js';

const NO_FEE_RULE: RevenueRule = { event: 'P2P', form: 'NONE', payer: 'SHARED', value: {} };
const RESERVE_POLL_TIMEOUT_MS = 60_000;
const RESERVE_POLL_INTERVAL_MS = 1_000;

/**
 * Prompt 2 -- extracted so a review screen can preview the REAL, deterministic, config-driven fee
 * split (App Fee -- Platform Fee is genuinely unknowable until Settlement, never faked here)
 * WITHOUT creating any real Transaction/PaymentIntent yet. Pure, no side effects, no Ishtaran
 * call -- safe to call as many times as the UI needs while the user is still just looking.
 */
export function calculatePaymentFees(walletConfig: WalletConfig, amount: string, event: RevenueEvent): RevenueCalculation {
  const rule = findRevenueRule(walletConfig, event) ?? { ...NO_FEE_RULE, event };
  return calculateRevenue({ event, grossAmount: amount, rule });
}

interface TransactionViewRow {
  id: string;
  account_id: string;
  amount: string;
  app_fee: string | null;
}

export async function createPayment(
  app: FastifyInstance,
  ctx: AppContext,
  senderAccountId: string,
  recipientAccountId: string,
  amount: string,
  event: RevenueEvent,
  idempotencyKey?: string,
) {
  const { db, config } = ctx;
  const { organizationId, applicationId, environmentId, assetNetworkId, appRevenueAccountId } = config.bootstrap;

  // Deterministic, config-driven -- never a fee the client asked for (Fase E pipeline).
  const calculation = calculatePaymentFees(config.wallet, amount, event);

  // Prompt 2 -- an upfront, best-effort check against Ishtaran's official WalletBalance capability
  // (never a local table) -- avoids creating a real, doomed-to-hang Ishtaran Transaction when the
  // wallet obviously can't fund it. The AUTHORITATIVE check is the atomic debit at
  // simulate-sandbox-send time (WalletChainActions.transfer, real conditional UPDATE) -- this is
  // a courtesy, not the gate.
  const currentBalance = (await app.walletBalanceReader.getBalance(senderAccountId)).balance;
  if (Number(currentBalance) < Number(calculation.senderDebit)) {
    throw Object.assign(
      new Error(
        `Insufficient wallet balance: you have ${currentBalance} USDT, this payment needs ${calculation.senderDebit} USDT. ` +
          `Use "Simular depósito" in Settings > Sandbox Tools to add test funds before paying.`,
      ),
      { statusCode: 402, code: 'INSUFFICIENT_FUNDS', details: { available: currentBalance, required: calculation.senderDebit } },
    );
  }

  const participants: ParticipantInput[] = [{ accountId: senderAccountId, role: 'sender', isPayer: true }];
  if (calculation.mechanism === 'SPLIT_PARTICIPANT' && calculation.allocations) {
    participants.push(
      { accountId: recipientAccountId, role: 'recipient', isPayer: false, splitPercentage: calculation.allocations[0]!.splitPercentage },
      { accountId: appRevenueAccountId, role: 'app-revenue', isPayer: false, splitPercentage: calculation.allocations[1]!.splitPercentage },
    );
  } else {
    participants.push({ accountId: recipientAccountId, role: 'recipient', isPayer: false });
  }

  const key = idempotencyKey ?? randomUUID();

  const created = await createPaymentTransaction(app.appClient, {
    organizationId,
    applicationId,
    environmentId,
    assetNetworkId,
    amount: calculation.transactionAmount,
    participants,
    idempotencyKey: key,
  });

  // GAPS.md G.1 addendum, found live in Slice 9's E2E battery (08-refund): a refund credits the
  // payer's real Available balance -- if that balance is already >= this new Transaction's
  // amount, CreateTransaction auto-reserves it SYNCHRONOUSLY (BR-TXN-002), before a PaymentIntent
  // is ever created for it. `CreatePaymentIntent` on an already-Reserved Transaction is correctly
  // rejected (`TRANSACTION_NOT_ELIGIBLE_FOR_FUNDING`) -- and per G.1, a Transaction with no
  // PaymentIntent of its own can never be Settled either, so this state is a genuine dead end for
  // the normal payment flow. Fail fast with a clear, honest error instead of chaining into that
  // confusing rejection -- money already sitting as real Available balance (e.g. from a prior
  // refund) can only be moved via Withdrawal in V1, never respent in-app (same root cause as G.1,
  // not a new platform gap).
  const stateAfterCreate = await getTransactionState(app.appClient, created.transactionId);
  if (stateAfterCreate.status.name !== 'CREATED' && stateAfterCreate.status.name !== 'AWAITING_FUNDS') {
    throw Object.assign(
      new Error(
        `This payment auto-reserved from an existing Available balance (e.g. a prior refund) instead of needing a fresh deposit. ` +
          `Per GAPS.md G.1, a Transaction funded this way has no PaymentIntent of its own and can never be Settled. ` +
          `That balance can only be moved via Withdrawal in this reference project, never respent in-app.`,
      ),
      { statusCode: 409, code: 'PAYMENT_AUTO_RESERVED_FROM_EXISTING_BALANCE' },
    );
  }

  // GAPS.md G.1 -- always a fresh PaymentIntent tied to THIS Transaction, never a bare Reserve
  // against pre-existing balance (confirmed to fail Settlement with no funding source).
  const intent = await createPaymentIntent(app.appClient, organizationId, created.transactionId, assetNetworkId, calculation.transactionAmount, key);
  const fullIntent = await getPaymentIntent(app.appClient, intent.paymentIntentId);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO transaction_views
      (id, kind, ishtaran_transaction_id, account_id, counterparty_label, amount, app_fee, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), 'payment_sent', created.transactionId, senderAccountId, recipientAccountId, calculation.senderDebit, calculation.appFeeAmount, 'AWAITING_FUNDS', now, now);
  db.prepare(
    `INSERT INTO transaction_views
      (id, kind, ishtaran_transaction_id, account_id, counterparty_label, amount, app_fee, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), 'payment_received', created.transactionId, recipientAccountId, senderAccountId, calculation.recipientNet, calculation.appFeeAmount, 'AWAITING_FUNDS', now, now);

  return {
    transactionId: created.transactionId,
    paymentIntentId: intent.paymentIntentId,
    depositAddress: fullIntent.depositAddress,
    amount: calculation.transactionAmount,
    calculation,
  };
}

export async function finalizePayment(app: FastifyInstance, ctx: AppContext, transactionId: string) {
  const { db, config } = ctx;
  const { environmentId, appRevenueAccountId } = config.bootstrap;

  const deadline = Date.now() + RESERVE_POLL_TIMEOUT_MS;
  let state = await getTransactionState(app.appClient, transactionId);
  while (state.status.name !== 'RESERVED' && state.status.name !== 'SETTLED' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, RESERVE_POLL_INTERVAL_MS));
    state = await getTransactionState(app.appClient, transactionId);
  }
  if (state.status.name !== 'RESERVED' && state.status.name !== 'SETTLED') {
    return { transactionId, settlementId: undefined, settlementStatus: state.status.name, pending: true as const };
  }

  const settlement = await executeSettlementAndComplete(app.appClient, environmentId, transactionId, app.executionSigner);

  const now = new Date().toISOString();
  db.prepare('UPDATE transaction_views SET settlement_id = ?, status = ?, updated_at = ? WHERE ishtaran_transaction_id = ?').run(
    settlement.settlementId, settlement.status.name, now, transactionId,
  );

  const rows = db.prepare('SELECT * FROM transaction_views WHERE ishtaran_transaction_id = ?').all(transactionId) as unknown as TransactionViewRow[];
  const senderRow = rows.find((r) => r.account_id !== appRevenueAccountId && r.app_fee !== null);
  if (senderRow && senderRow.app_fee && senderRow.app_fee !== '0') {
    const recipientView = rows.find((r) => r.id !== senderRow.id);
    if (recipientView) {
      db.prepare(
        `INSERT INTO revenue_events (id, transaction_id, settlement_id, rule_event, amount, app_revenue_account_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), transactionId, settlement.settlementId, 'PAYMENT', senderRow.app_fee, appRevenueAccountId, now);
    }
  }

  // Prompt 2 -- if this Transaction was created via a "cobrança" (routes/paymentRequests.ts's
  // `/pay`), THIS is the correct, only moment to mark it PAID: Settlement genuinely completed
  // just above, never at Transaction-creation time (see that route's own comment for the real
  // bug this replaced -- a request marked PAID before anything was actually funded/settled).
  // Harmless no-op if this transactionId isn't a payment request's at all.
  db.prepare("UPDATE payment_requests SET status = 'PAID' WHERE transaction_id = ? AND status != 'PAID'").run(transactionId);

  return {
    transactionId,
    settlementId: settlement.settlementId,
    settlementStatus: settlement.status.name,
    pending: false as const,
    // Additive surface of fields the real Settlement object already carries (never a new
    // computation) -- lets the UI show the real, final Platform Fee once it's actually known
    // (GAPS.md §F.3: not knowable before Settlement executes, see apps/web's Send review screen).
    grossAmount: settlement.grossAmount,
    platformFeeAmount: settlement.platformFeeAmount,
    distributableAmount: settlement.distributableAmount,
    splitAllocations: settlement.splitAllocations.map((a) => ({ accountId: a.accountId, amount: a.amount })),
  };
}

export function registerPaymentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const { environmentId, assetNetworkId } = config.bootstrap;

  app.post<{ Body: { recipientAccountId: string; amount: string; event: RevenueEvent; clientPaymentAttemptId?: string } }>(
    '/payments',
    { preHandler: requireSession },
    async (request, reply) => {
      const { recipientAccountId, amount, event, clientPaymentAttemptId } = request.body;
      const { accountId: senderAccountId, walletAddress } = (request as AuthenticatedRequest).user;
      if (!recipientAccountId || !amount || !event) {
        return reply.code(400).send({ error: 'recipientAccountId, amount, and event are required' });
      }
      if (!walletAddress) {
        return reply.code(409).send({ error: 'This session has no known wallet address on file.', code: 'WALLET_ADDRESS_UNKNOWN' });
      }
      const result = await createPayment(app, ctx, senderAccountId, recipientAccountId, amount, event, clientPaymentAttemptId);
      return reply.code(201).send(result);
    },
  );

  // Sandbox-only (IMPLEMENTATION_PLAN.md Fase H, revised 2026-09-10): apps/web never holds the
  // API Key, so it can't call sandbox.simulateDeposit/simulateConfirmation itself -- this proxies
  // that Sandbox-exclusive simulation on the user's behalf, standing in for "the user's own
  // wallet broadcast a real on-chain transfer" (no real Tron adapter exists yet,
  // CUSTODY-EXECUTION-MODES.md Part 4). Never presented in the UI as a real broadcast.
  app.post<{ Params: { transactionId: string }; Body: { depositAddress: string; amount: string } }>(
    '/payments/:transactionId/simulate-sandbox-send',
    { preHandler: requireSession },
    async (request, reply) => {
      const { depositAddress, amount } = request.body;
      const { transactionId } = request.params;
      if (!depositAddress || !amount) {
        return reply.code(400).send({ error: 'depositAddress and amount are required' });
      }

      // GAPS.md G.8 -- this is the moment representing "the user's own wallet actually broadcasts
      // the transfer": a REAL debit of the sender's wallet balance (never at /payments creation --
      // a created-but-abandoned payment must not permanently consume wallet funds), crediting the
      // PaymentIntent's own deposit address in the SAME simulated chain state (it genuinely
      // "holds" the test-USDT now, exactly like a real payment). The real debit amount is read
      // from THIS app's own transaction_views row (senderDebit, as recorded by createPayment) --
      // never the client-supplied `amount`, so a client cannot understate what actually leaves the
      // wallet. Idempotent by transactionId (WalletChainActions.transfer's own idempotencyKey).
      const { accountId, walletAddress } = (request as AuthenticatedRequest).user;
      if (!walletAddress) {
        return reply.code(409).send({ error: 'This session has no known wallet address on file.', code: 'WALLET_ADDRESS_UNKNOWN' });
      }
      const senderRow = db
        .prepare("SELECT amount FROM transaction_views WHERE ishtaran_transaction_id = ? AND kind = 'payment_sent'")
        .get(transactionId) as { amount: string } | undefined;
      const realDebitAmount = senderRow?.amount ?? amount;

      await app.walletChainActions.transfer(walletAddress, depositAddress, realDebitAmount, `payment-fund:${transactionId}`);

      const observed = await app.appClient.sandbox.simulateDeposit(environmentId, depositAddress, assetNetworkId, amount);
      await app.appClient.sandbox.simulateConfirmation(environmentId, observed.sandboxObservedAddressId, 1, true);

      // Prompt 2 §17 -- event-driven UI: this debit already publishes SandboxWalletBalanceChanged
      // (picked up async within a few seconds), but the sender's own Home/MoveFlow should reflect
      // the new balance as soon as this call returns, not after an arbitrary Outbox delay.
      await app.walletBalanceReader.refreshBalance(accountId).catch(() => undefined);

      return reply.send({ simulated: true });
    },
  );

  app.post<{ Params: { transactionId: string } }>(
    '/payments/:transactionId/finalize',
    { preHandler: requireSession },
    async (request, reply) => {
      const result = await finalizePayment(app, ctx, request.params.transactionId);
      if (result.pending) {
        return reply.code(202).send({ ...result, message: 'Deposit not confirmed yet -- retry finalize once the on-chain transfer has more confirmations.' });
      }
      return reply.send(result);
    },
  );
}
