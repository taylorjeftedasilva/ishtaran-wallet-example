// Slice 8 (IMPLEMENTATION_PLAN.md Fase I flow 7, Section 19 Analytics) -- App Owner Dashboard.
// V1 simplification, loudly documented (Fase G): a single shared owner token gates these routes,
// never full Member-JWT SSO -- a real production dashboard would authenticate the App Owner via
// their own Member login. The API Key itself never leaves apps/api regardless.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createWithdrawalDestination, getFullAccountBalance, getWithdrawalQuote, requestWithdrawal } from '@wallet-app/ishtaran-client';
import type { AppContext } from '../app.js';

export function registerOwnerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const { organizationId, environmentId, assetNetworkId, appRevenueAccountId, apiKey } = config.bootstrap;

  app.post<{ Body: { token: string } }>('/owner/login', async (request, reply) => {
    if (request.body.token !== config.ownerToken) {
      return reply.code(401).send({ error: 'Invalid owner token' });
    }
    const sessionToken = randomUUID();
    db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(sessionToken, 'owner', new Date().toISOString());
    return reply.send({ sessionToken });
  });

  app.register(async (instance) => {
    instance.addHook('preHandler', requireOwnerSession);

    instance.get('/owner/revenue-balance', async () => {
      return getFullAccountBalance(apiKey, appRevenueAccountId, assetNetworkId);
    });

    // Prompt 2 -- the App Owner asking "what IS my wallet, and how much USDT does it actually
    // have" is a different question from `/owner/revenue-balance` above (Ishtaran's own Ledger
    // Available/Payable/etc): this is the real on-chain (or Sandbox-simulated) balance at the App
    // Revenue Account's registered self-custody address, via the official WalletBalance
    // capability -- never summed with the Ledger figure, shown as its own section.
    instance.get('/owner/wallet-balance', async () => {
      return app.walletBalanceReader.getBalance(appRevenueAccountId);
    });

    instance.get('/owner/revenue-history', async () => {
      return db.prepare('SELECT * FROM revenue_events ORDER BY created_at DESC LIMIT 100').all();
    });

    instance.get('/owner/analytics', async () => {
      const totals = db
        .prepare('SELECT rule_event, COUNT(*) as count, SUM(CAST(amount AS REAL)) as totalRevenue FROM revenue_events GROUP BY rule_event')
        .all();
      const paymentCount = db.prepare("SELECT COUNT(*) as count FROM transaction_views WHERE kind = 'payment_sent'").get() as { count: number };
      return { byEvent: totals, totalPayments: paymentCount.count };
    });

    instance.post<{ Body: { address: string } }>('/owner/withdrawal-destinations', async (request, reply) => {
      const { address } = request.body;
      if (!address) return reply.code(400).send({ error: 'address is required' });
      const destination = await createWithdrawalDestination(app.appClient, organizationId, address, assetNetworkId);
      return reply.code(201).send(destination);
    });

    instance.get<{ Querystring: { withdrawalDestinationId: string; amount: string } }>('/owner/withdrawal-quote', async (request, reply) => {
      const { withdrawalDestinationId, amount } = request.query;
      if (!withdrawalDestinationId || !amount) return reply.code(400).send({ error: 'withdrawalDestinationId and amount are required' });
      const quote = await getWithdrawalQuote(app.appClient, organizationId, environmentId, appRevenueAccountId, withdrawalDestinationId, assetNetworkId, amount);
      return reply.send(quote);
    });

    instance.post<{ Body: { withdrawalDestinationId: string; amount: string } }>('/owner/withdrawals', async (request, reply) => {
      const { withdrawalDestinationId, amount } = request.body;
      if (!withdrawalDestinationId || !amount) return reply.code(400).send({ error: 'withdrawalDestinationId and amount are required' });
      const idempotencyKey = `owner:${withdrawalDestinationId}:${amount}`;
      const withdrawal = await requestWithdrawal(app.appClient, organizationId, environmentId, appRevenueAccountId, withdrawalDestinationId, assetNetworkId, amount, idempotencyKey);
      return reply.code(201).send(withdrawal);
    });
  });
}

async function requireOwnerSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const app = request.server;
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) {
    await reply.code(401).send({ error: 'Missing Authorization: Bearer <sessionToken>' });
    return;
  }
  const session = app.db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as { user_id: string } | undefined;
  if (!session || session.user_id !== 'owner') {
    await reply.code(401).send({ error: 'Invalid or non-owner session' });
    return;
  }
}
