// Prompt 2 -- the wallet's OWN balance, read via Ishtaran's official WalletBalance capability
// (`app.walletBalanceReader`, wrapping `client.walletBalance`), never the Ishtaran Ledger
// (routes/ledgerPosition.ts) and never a local App Database figure. `/wallet/balance` is the
// number Home shows as the primary "how much USDT does my wallet have" answer; `/wallet/balance/
// refresh` asks Ishtaran to check authoritatively right now (used by the manual "atualizar"
// button and by the client-side change detector once it independently suspects a change --
// Prompt 2 §8); `/wallet/balances` is the multi-asset/multi-network aggregate view (Prompt 2 §5/
// §6); `/wallet/simulate-deposit` is "Simular depósito"; `/wallet/transfer` is "Enviar" -- a
// direct, sender-initiated wallet-to-wallet movement, entirely distinct from Payment
// (routes/payments.ts, still Transaction/PaymentIntent/Settlement-based, untouched by this file,
// see GAPS.md G.1/G.7 "Transfer != Payment != Settlement").
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireSession, type AuthenticatedRequest } from './auth.js';

interface AppUserRow {
  id: string;
  account_id: string;
  wallet_address: string | null;
}

function requireWalletAddress(walletAddress: string | null): string {
  if (!walletAddress) {
    throw Object.assign(
      new Error('This session has no known wallet address on file -- log out and back in from a device with the local wallet set up.'),
      { statusCode: 409, code: 'WALLET_ADDRESS_UNKNOWN' },
    );
  }
  return walletAddress;
}

export function registerWalletBalanceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  // Cheap -- never calls a blockchain/RPC provider, only the last known snapshot (kept fresh
  // server-side by event-driven refresh + ~10min background reconciliation, Prompt 1.1). Safe to
  // call on every Home mount/foreground-return/30s-poll tick.
  app.get('/wallet/balance', { preHandler: requireSession }, async (request) => {
    const { accountId } = (request as AuthenticatedRequest).user;
    return app.walletBalanceReader.getBalance(accountId);
  });

  // Authoritative -- asks Ishtaran to actually check the chain (or Sandbox-simulated chain) right
  // now. The platform's own 30s freshness/single-flight guard applies server-side regardless of
  // how often this is called -- `refreshSuppressed` on the response tells the caller whether a
  // real provider call happened or the guard answered from cache. Never an error either way.
  app.post('/wallet/balance/refresh', { preHandler: requireSession }, async (request) => {
    const { accountId } = (request as AuthenticatedRequest).user;
    return app.walletBalanceReader.refreshBalance(accountId);
  });

  // Multi-asset/multi-network aggregate (Prompt 2 §5/§6) -- today always returns exactly one
  // entry (USDT, aggregated over its one supported network, TRON), but the shape is already
  // generic: the frontend never hardcodes "there is exactly one asset."
  app.get('/wallet/balances', { preHandler: requireSession }, async (request) => {
    const { accountId } = (request as AuthenticatedRequest).user;
    return { assets: await app.walletBalanceReader.getAssetBalances(accountId) };
  });

  app.post<{ Body: { amount: string; idempotencyKey?: string } }>(
    '/wallet/simulate-deposit',
    { preHandler: requireSession },
    async (request, reply) => {
      const { amount, idempotencyKey } = request.body;
      if (!amount || Number(amount) <= 0) {
        return reply.code(400).send({ error: 'amount must be a positive number', code: 'INVALID_DEPOSIT_AMOUNT' });
      }
      const { accountId, walletAddress } = (request as AuthenticatedRequest).user;
      const address = requireWalletAddress(walletAddress);

      const key = idempotencyKey ?? `deposit:${accountId}:${randomUUID()}`;
      const balanceAfterCredit = await app.walletChainActions.creditExternalDeposit(address, amount, key);

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO transaction_views
          (id, kind, account_id, counterparty_label, amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), 'wallet_deposit', accountId, 'Simulated external deposit', amount, 'COMPLETED', now, now);

      // The Sandbox credit already published `SandboxWalletBalanceChanged` (event-driven refresh,
      // Prompt 1.1) -- best-effort nudge so the platform's own persistent snapshot (what every
      // OTHER read of this wallet sees) catches up without waiting on the ~5s Outbox dispatch
      // latency. This can be legitimately suppressed by the platform's own 30s guard if a refresh
      // happened moments ago for any reason -- that is correct, expected behavior, NOT a sign the
      // deposit failed to land. Because of that, the `balance` returned to THIS caller always
      // comes from `balanceAfterCredit` (the direct, authoritative result of the mutation this
      // request itself just performed), never from a snapshot read that might still be suppressed.
      const snapshot = await app.walletBalanceReader
        .refreshBalance(accountId)
        .catch(() => app.walletBalanceReader.getBalance(accountId));

      return reply.code(201).send({ ...snapshot, balance: balanceAfterCredit });
    },
  );

  app.post<{ Body: { toAddress: string; amount: string; idempotencyKey?: string } }>(
    '/wallet/transfer',
    { preHandler: requireSession },
    async (request, reply) => {
      const { toAddress, amount, idempotencyKey } = request.body;
      if (!toAddress || !amount || Number(amount) <= 0) {
        return reply.code(400).send({ error: 'toAddress and a positive amount are required', code: 'INVALID_TRANSFER_REQUEST' });
      }
      const { accountId, walletAddress } = (request as AuthenticatedRequest).user;
      const fromAddress = requireWalletAddress(walletAddress);

      const key = idempotencyKey ?? `transfer:${accountId}:${randomUUID()}`;
      const outcome = await app.walletChainActions.transfer(fromAddress, toAddress, amount, key);

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO transaction_views
          (id, kind, account_id, counterparty_label, amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), 'wallet_transfer_sent', accountId, toAddress, amount, 'COMPLETED', now, now);

      // If the recipient address belongs to a known app_user, mirror the receive side into THEIR
      // history too -- a real wallet-to-wallet transfer has no Ishtaran-side record to read this
      // from later (it never touches Ishtaran at all), so this app-local projection is the only
      // place either side can ever see it.
      const recipient = db.prepare('SELECT id, account_id, wallet_address FROM app_users WHERE wallet_address = ?').get(toAddress) as AppUserRow | undefined;
      if (recipient) {
        db.prepare(
          `INSERT INTO transaction_views
            (id, kind, account_id, counterparty_label, amount, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), 'wallet_transfer_received', recipient.account_id, fromAddress, amount, 'COMPLETED', now, now);
      }

      // Same reasoning as simulate-deposit above -- nudge the platform's own persistent snapshot
      // for both sides (best-effort; can be legitimately suppressed by the 30s guard, which is
      // correct, not a failure). The `balance` returned to THIS caller always comes from
      // `outcome.fromBalance` (the direct, authoritative result of the transfer this request
      // itself just performed) -- a guard-suppressed snapshot read must never make a sender's own
      // successful transfer look like it didn't happen.
      const [senderSnapshot] = await Promise.all([
        app.walletBalanceReader.refreshBalance(accountId).catch(() => app.walletBalanceReader.getBalance(accountId)),
        recipient ? app.walletBalanceReader.refreshBalance(recipient.account_id).catch(() => undefined) : Promise.resolve(undefined),
      ]);

      return reply.code(201).send({ balance: { ...senderSnapshot, balance: outcome.fromBalance } });
    },
  );
}
