// Fastify app builder -- separated from server.ts so integration tests can build/exercise the
// app in-process (Fastify `inject()`) without binding a real port.
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { createClient, type ExecutionSigner, type MemberRefreshTokenStore } from '@wallet-app/ishtaran-client';
import { IshtaranError } from '@ishtaran/sdk';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from './config.js';
import { restoreExecutionSigner } from './executionSigner.js';
import { createMemberTokenStore } from './memberTokenStore.js';
import {
  createWalletBalanceReader,
  createWalletChainActions,
  type WalletBalanceReader,
  type WalletChainActions,
} from './walletBalance/index.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerLedgerPositionRoutes } from './routes/ledgerPosition.js';
import { registerWalletBalanceRoutes } from './routes/walletBalance.js';
import { registerHistoryRoutes } from './routes/history.js';
import { registerOwnerRoutes } from './routes/owner.js';
import { registerPaymentRequestRoutes } from './routes/paymentRequests.js';
import { registerPaymentRoutes } from './routes/payments.js';
import { registerRefundRoutes } from './routes/refunds.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerWithdrawalRoutes } from './routes/withdrawals.js';

export interface AppContext {
  config: AppConfig;
  db: DatabaseSync;
}

export function buildApp(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Never log the API Key, webhook secrets, or auth headers (IMPLEMENTATION_PLAN.md Fase Q).
      redact: {
        paths: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers["x-webhook-signature"]', '*.apiKey', '*.password'],
        censor: '[REDACTED]',
      },
    },
  });

  // apps/web (Vite dev server, a different origin) is the only real caller -- allow it explicitly
  // rather than a wildcard, matching "this app never accepts arbitrary cross-origin traffic."
  app.register(cors, { origin: process.env.WALLET_WEB_ORIGIN ?? 'http://localhost:5173' });

  const appClient = createClient(ctx.config.bootstrap.apiKey);
  app.decorate('appClient', appClient);
  app.decorate('config', ctx.config);
  app.decorate('db', ctx.db);
  app.decorate('memberTokenStore', createMemberTokenStore(ctx.config.bootstrapPath, ctx.config.bootstrap.memberRefreshToken));
  app.decorate('executionSigner', restoreExecutionSigner(ctx.config.bootstrap.executionWalletMnemonic));
  // Prompt 2 -- reads go through Ishtaran's official WalletBalance capability (client.walletBalance),
  // environment-agnostic from this app's point of view. Chain-mutating actions (credit/transfer)
  // still pick Sandbox vs. Production explicitly -- the one place that selection happens.
  app.decorate(
    'walletBalanceReader',
    createWalletBalanceReader(appClient, ctx.config.bootstrap.environmentId, ctx.config.bootstrap.assetNetworkId),
  );
  app.decorate(
    'walletChainActions',
    createWalletChainActions(ctx.config.wallet.environment, appClient, ctx.config.bootstrap.environmentId, ctx.config.bootstrap.assetNetworkId),
  );

  // A real IshtaranError already carries the platform's own httpStatus/code/message -- surface
  // it as-is rather than collapsing every upstream failure into a generic 500. 401/403 from
  // Ishtaran (e.g. a wrong AccountHolder password) become the SAME status here, never silently
  // reinterpreted.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof IshtaranError) {
      const details = error.details as { errorCode?: string } | undefined;
      reply.code(error.httpStatus ?? 502).send({ error: error.message, code: details?.errorCode ?? error.code });
      return;
    }
    // Route-level domain errors thrown as `Object.assign(new Error(...), { statusCode, code })`
    // (e.g. payments.ts's PAYMENT_AUTO_RESERVED_FROM_EXISTING_BALANCE) -- surfaced the same
    // structured way as a real IshtaranError, never collapsed to a generic 500.
    const withStatus = error as Error & { statusCode?: number; code?: string };
    if (withStatus.statusCode) {
      reply.code(withStatus.statusCode).send({ error: withStatus.message, code: withStatus.code });
      return;
    }
    reply.send(error);
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // Public, no secrets -- just the already-loaded wallet.config.ts fields the frontend needs to
  // render itself correctly (app name, whether Revenue/Payment-Request/Withdrawal are enabled in
  // THIS mode). Never the API Key or anything from config.bootstrap.
  app.get('/config', async () => ({
    mode: ctx.config.wallet.mode,
    appName: ctx.config.wallet.branding.appName,
    paymentRequestEnabled: ctx.config.wallet.paymentRequest.enabled,
    withdrawalEnabled: ctx.config.wallet.withdrawal.enabled,
    // Prompt 2 §10 -- the frontend needs this to decide whether a client-side chain read-only
    // check is even meaningful (Production has a real public chain to query independently;
    // Sandbox's "chain" is simulated entirely inside Ishtaran, so there is nothing independent to
    // read -- see clientSideBalanceDetector.ts). Not a secret, just which mode this deployment runs.
    environment: ctx.config.wallet.environment,
  }));

  app.register(async (instance) => {
    registerAuthRoutes(instance, ctx);
    registerLedgerPositionRoutes(instance, ctx);
    registerWalletBalanceRoutes(instance, ctx);
    registerPaymentRoutes(instance, ctx);
    registerPaymentRequestRoutes(instance, ctx);
    registerRefundRoutes(instance, ctx);
    registerWithdrawalRoutes(instance, ctx);
    registerHistoryRoutes(instance, ctx);
    registerOwnerRoutes(instance, ctx);
  });

  // Its own top-level registration -- the raw-body content-type parser override inside
  // registerWebhookRoutes must never leak into the JSON routes above (Fastify plugin
  // encapsulation keeps it scoped to this child only).
  registerWebhookRoutes(app, ctx);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    appClient: ReturnType<typeof createClient>;
    config: AppConfig;
    db: DatabaseSync;
    memberTokenStore: MemberRefreshTokenStore;
    executionSigner: ExecutionSigner;
    walletBalanceReader: WalletBalanceReader;
    walletChainActions: WalletChainActions;
  }
}
