// Slice 2 (IMPLEMENTATION_PLAN.md Fase V/G) -- AccountHolder signup/login, invitation claim, and
// AuthorizeAccountForApplication. The end user never receives an Ishtaran token of any kind: the
// AccountHolder JWT can't call a financial route anyway (GAPS.md F.10), so apps/api never hands
// it out -- it issues its own opaque app-level session instead, exactly the boundary
// IMPLEMENTATION_PLAN.md Fase G draws ("every financial call is the App Backend acting on behalf
// of the user").
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authorizeAccountForApplication,
  claimAccountHolderInvitation,
  createAccountHolderInvitation,
  createClient,
  getAccountHolderMe,
  loginAccountHolder,
  registerExecutionDestination,
  signUpAndClaimAccountHolderInvitation,
  withMemberSession,
} from '@wallet-app/ishtaran-client';
import type { AppContext } from '../app.js';

interface AppUserRow {
  id: string;
  email: string;
  account_holder_id: string;
  account_id: string;
  wallet_address: string | null;
  created_at: string;
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const { organizationId, applicationId } = config.bootstrap;

  app.post<{ Body: { email: string; password: string; destinationAddress: string } }>('/auth/signup', async (request, reply) => {
    const { email, password, destinationAddress } = request.body;
    if (!email || !password) return reply.code(400).send({ error: 'email and password are required' });
    if (!destinationAddress) {
      return reply.code(400).send({
        error:
          'destinationAddress is required -- the address of the wallet this account will receive funds at ' +
          '(client-derived from the end user\'s own self-custody wallet; a Settlement can never pay an Account with none registered).',
      });
    }

    const existing = db.prepare('SELECT * FROM app_users WHERE email = ?').get(email) as AppUserRow | undefined;
    if (existing) return reply.code(409).send({ error: 'An account with this email already exists -- use /auth/login.' });

    const invitation = await app.appClient.accounts.createAccountHolderInvitation(organizationId, email);
    const accountHolderClient = createClient();
    const claim = await signUpAndClaimAccountHolderInvitation(accountHolderClient, invitation.plainTextToken, email, password);
    if (!claim.success) {
      return reply.code(422).send({ error: `Could not create the account: ${claim.errorCode}` });
    }

    const me = await getAccountHolderMe(accountHolderClient);
    await withMemberSession(app.memberTokenStore, (owner) =>
      authorizeAccountForApplication(owner, organizationId, me.accountId, applicationId),
    );
    await registerExecutionDestination(app.appClient, organizationId, me.accountId, config.bootstrap.assetNetworkId, destinationAddress);

    const userId = randomUUID();
    db.prepare(
      'INSERT INTO app_users (id, email, account_holder_id, account_id, wallet_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userId, email, me.accountHolderId, me.accountId, destinationAddress, new Date().toISOString());

    return reply.code(201).send(issueSession(db, userId, me.accountId, email));
  });

  app.post<{ Body: { email: string; password: string; address?: string } }>('/auth/login', async (request, reply) => {
    const { email, password, address } = request.body;
    if (!email || !password) return reply.code(400).send({ error: 'email and password are required' });

    const accountHolderClient = createClient();
    const login = await loginAccountHolder(accountHolderClient, email, password);
    if (!login.success) return reply.code(401).send({ error: `Invalid credentials: ${login.errorCode}` });

    const me = await getAccountHolderMe(accountHolderClient);
    let row = db.prepare('SELECT * FROM app_users WHERE account_holder_id = ?').get(me.accountHolderId) as AppUserRow | undefined;

    if (!row) {
      // Real identity, first time seen locally (A1: AccountHolder/Account is global -- the App
      // Database may simply have never recorded this person, e.g. after a local DB reset).
      // Self-heals by claiming a fresh invitation from this Organization and authorizing it,
      // rather than failing a login that Ishtaran itself just confirmed is valid.
      const invitation = await app.appClient.accounts.createAccountHolderInvitation(organizationId, email);
      const claim = await claimAccountHolderInvitation(accountHolderClient, invitation.plainTextToken);
      if (!claim.success) return reply.code(500).send({ error: `Could not re-link existing identity: ${claim.errorCode}` });
      await withMemberSession(app.memberTokenStore, (owner) =>
        authorizeAccountForApplication(owner, organizationId, me.accountId, applicationId),
      );
      const userId = randomUUID();
      db.prepare(
        'INSERT INTO app_users (id, email, account_holder_id, account_id, wallet_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(userId, email, me.accountHolderId, me.accountId, address ?? null, new Date().toISOString());
      row = { id: userId, email, account_holder_id: me.accountHolderId, account_id: me.accountId, wallet_address: address ?? null, created_at: new Date().toISOString() };
    } else if (address && row.wallet_address !== address) {
      // GAPS.md G.8 -- backfills wallet_address for accounts created before this column existed,
      // and keeps it current if the device's local wallet ever changes (e.g. restore-from-phrase
      // on a fresh device re-deriving the same or a different address).
      db.prepare('UPDATE app_users SET wallet_address = ? WHERE id = ?').run(address, row.id);
      row = { ...row, wallet_address: address };
    }

    return reply.send(issueSession(db, row.id, row.account_id, row.email));
  });

  app.get<{ Querystring: { address?: string } }>('/auth/me', { preHandler: requireSession }, async (request) => {
    const user = (request as AuthenticatedRequest).user;
    const { address } = request.query;

    // Self-heals the same wallet_address gap login's backfill (above) handles -- but this is the
    // path a returning user actually hits on every app boot (`walletExists && token`, App.tsx),
    // so without this, an account whose row predates the wallet_address column (or was created
    // via the self-heal INSERT before a device's local wallet was available) could stay
    // permanently WALLET_ADDRESS_UNKNOWN: login only fires when there's no stored session token.
    if (address && user.walletAddress !== address) {
      db.prepare('UPDATE app_users SET wallet_address = ? WHERE id = ?').run(address, user.userId);
      user.walletAddress = address;
    }

    return { userId: user.userId, accountId: user.accountId, email: user.email, walletAddress: user.walletAddress };
  });
}

function issueSession(db: AppContext['db'], userId: string, accountId: string, email: string) {
  const sessionToken = randomUUID();
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(sessionToken, userId, new Date().toISOString());
  return { sessionToken, userId, accountId, email };
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string; accountId: string; email: string; walletAddress: string | null };
}

/** Reusable Fastify preHandler for every route from Slice 3 onward that needs a logged-in user. */
export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const app = request.server;
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) {
    await reply.code(401).send({ error: 'Missing Authorization: Bearer <sessionToken>' });
    return;
  }
  const session = app.db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as { user_id: string } | undefined;
  if (!session) {
    await reply.code(401).send({ error: 'Invalid or expired session' });
    return;
  }
  const user = app.db.prepare('SELECT * FROM app_users WHERE id = ?').get(session.user_id) as AppUserRow | undefined;
  if (!user) {
    await reply.code(401).send({ error: 'Session refers to a user that no longer exists' });
    return;
  }
  (request as AuthenticatedRequest).user = { userId: user.id, accountId: user.account_id, email: user.email, walletAddress: user.wallet_address };
}
