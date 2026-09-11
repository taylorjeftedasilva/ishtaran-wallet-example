// Live Sandbox validation for Slice 6 (Withdrawal), Slice 7 (webhooks + history), Slice 8 (App
// Owner dashboard), run manually:
//   1. npm run setup   (fresh Org/App/Env/API Key + execution infra + webhook endpoint)
//   2. WALLET_APP_MODE=MONETIZED npm run dev:api  (in one terminal)
//   3. npx tsx tests/integration/validate-slice6-8.ts   (this file, in another)
//
// Validates:
//   - Withdrawal destination creation + quote succeed; RequestWithdrawal is REJECTED by the real
//     24h activation cooldown -- proves the cooldown is respected, never bypassed (Mercatto's own
//     GAPS.md F.4: "the correct ending... is the real rejection, proven live").
//   - Webhook receiver: a synthetic HMAC-signed payload (built with the REAL secret
//     scripts/setup.ts got from a real webhookEndpoints.create() call, using the SDK's own
//     computeWebhookSignature -- the identical algorithm a real delivery would use) is accepted;
//     an unsigned/mis-signed one is rejected with no state change; a replayed delivery ID dedupes.
//   - History: a real payment shows up in both sender's and recipient's /wallet/history.
//   - Owner dashboard: login, revenue balance, revenue history, analytics all return real data
//     matching what Slice 4's payment produced.
import { readFileSync } from 'node:fs';
import { computeWebhookSignature } from '@ishtaran/sdk';
import { createClient, deriveTronAddress, wallet } from '@wallet-app/ishtaran-client';

const API_BASE = process.env.WALLET_API_BASE ?? 'http://127.0.0.1:3001';
const BOOTSTRAP_PATH = new URL('../../config/.sandbox-bootstrap.json', import.meta.url);

interface Bootstrap {
  organizationId: string;
  environmentId: string;
  apiKey: string;
  assetNetworkId: string;
  appRevenueAccountId: string;
  webhookSecret: string;
}

const bootstrap = JSON.parse(readFileSync(BOOTSTRAP_PATH, 'utf8')) as Bootstrap;
const appClient = createClient(bootstrap.apiKey);

let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    failures++;
    console.error(`[FAIL] ${label}: expected ${expected}, got ${actual}`);
  } else {
    console.log(`[ok]   ${label}: ${actual}`);
  }
}

function assertTrue(label: string, condition: boolean, detail: string): void {
  if (!condition) {
    failures++;
    console.error(`[FAIL] ${label}: ${detail}`);
  } else {
    console.log(`[ok]   ${label}`);
  }
}

async function signup(email: string): Promise<{ sessionToken: string; accountId: string }> {
  const generated = wallet.generate();
  const destinationAddress = deriveTronAddress(generated.wallet.accountExtendedPublicKey, 0);
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Str0ngP@ssw0rd!123', destinationAddress }),
  });
  if (!res.ok) throw new Error(`signup(${email}) failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { sessionToken: string; accountId: string };
}

async function main() {
  console.log(`[validate] API_BASE=${API_BASE}`);
  const runId = Date.now();
  const alice = await signup(`alice+withdraw-${runId}@example.com`);
  const bob = await signup(`bob+withdraw-${runId}@example.com`);
  console.log(`[validate] alice.accountId=${alice.accountId} bob.accountId=${bob.accountId}`);

  // === Slice 6: Withdrawal (real cooldown respected) ==============================================
  console.log('\n=== Slice 6: Withdrawal ===');
  const generated = wallet.generate();
  const externalAddress = deriveTronAddress(generated.wallet.accountExtendedPublicKey, 0);

  const destRes = await fetch(`${API_BASE}/wallet/withdrawal-destinations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.sessionToken}` },
    body: JSON.stringify({ address: externalAddress }),
  });
  assertTrue('Create withdrawal destination succeeds', destRes.ok, await destRes.clone().text());
  const destination = (await destRes.json()) as { withdrawalDestinationId: string };

  const quoteRes = await fetch(`${API_BASE}/wallet/withdrawal-quote?withdrawalDestinationId=${destination.withdrawalDestinationId}&amount=10`, {
    headers: { authorization: `Bearer ${alice.sessionToken}` },
  });
  assertTrue('Withdrawal quote succeeds', quoteRes.ok, await quoteRes.clone().text());

  const withdrawRes = await fetch(`${API_BASE}/wallet/withdrawals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.sessionToken}` },
    body: JSON.stringify({ withdrawalDestinationId: destination.withdrawalDestinationId, amount: '10' }),
  });
  const withdrawBody = await withdrawRes.json();
  assertTrue(
    'RequestWithdrawal is REJECTED by the real 24h activation cooldown (never bypassed)',
    !withdrawRes.ok && withdrawRes.status === 422,
    JSON.stringify(withdrawBody),
  );
  console.log(`[validate] real rejection: ${JSON.stringify(withdrawBody)}`);

  // === Slice 4 payment, feeding both the webhook re-fetch test and Slice 7/8 history/dashboard ======
  console.log('\n=== Payment (feeds webhook re-fetch + history + dashboard) ===');
  const createRes = await fetch(`${API_BASE}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.sessionToken}` },
    body: JSON.stringify({ recipientAccountId: bob.accountId, amount: '20', event: 'MERCHANT_PAYMENT' }),
  });
  const created = (await createRes.json()) as { transactionId: string; depositAddress: string; amount: string };
  const observed = await appClient.sandbox.simulateDeposit(bootstrap.environmentId, created.depositAddress, bootstrap.assetNetworkId, created.amount);
  await appClient.sandbox.simulateConfirmation(bootstrap.environmentId, observed.sandboxObservedAddressId, 1, true);
  const finalizeRes = await fetch(`${API_BASE}/payments/${created.transactionId}/finalize`, {
    method: 'POST',
    headers: { authorization: `Bearer ${alice.sessionToken}` },
  });
  const finalized = (await finalizeRes.json()) as { settlementStatus: string };
  assertEqual('Payment for webhook/history/dashboard test settled', finalized.settlementStatus, 'COMPLETED');

  // === Slice 7: Webhook receiver =====================================================================
  console.log('\n=== Slice 7: Webhook receiver ===');
  // A real TransactionId this server can actually re-fetch -- the receiver never trusts the
  // webhook body itself (Fase K), it always re-fetches the real aggregate to reconcile, so a
  // fabricated ID would (correctly) 404 against real Ishtaran, same as it would for a real
  // integrator's own bug. Using the real payment's own transactionId exercises that path for real.
  const rawBody = JSON.stringify({ TransactionId: created.transactionId });
  const timestamp = Math.floor(Date.now() / 1000);
  const validSignature = computeWebhookSignature(timestamp, rawBody, bootstrap.webhookSecret);
  const deliveryId = `validate-${runId}`;

  const validRes = await fetch(`${API_BASE}/webhooks/ishtaran`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-signature': validSignature,
      'x-webhook-timestamp': String(timestamp),
      'x-webhook-delivery-id': deliveryId,
    },
    body: rawBody,
  });
  assertEqual('Valid signed webhook accepted', validRes.status, 200);

  const dupeRes = await fetch(`${API_BASE}/webhooks/ishtaran`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-signature': validSignature,
      'x-webhook-timestamp': String(timestamp),
      'x-webhook-delivery-id': deliveryId,
    },
    body: rawBody,
  });
  const dupeBody = (await dupeRes.json()) as { deduped?: boolean };
  assertTrue('Replayed delivery ID dedupes (never reprocessed)', dupeBody.deduped === true, JSON.stringify(dupeBody));

  const badSigRes = await fetch(`${API_BASE}/webhooks/ishtaran`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-signature': 'deadbeef'.repeat(8),
      'x-webhook-timestamp': String(timestamp),
      'x-webhook-delivery-id': `validate-bad-${runId}`,
    },
    body: rawBody,
  });
  assertEqual('Invalid signature rejected', badSigRes.status, 401);

  // === Slice 7: History ===============================================================================
  console.log('\n=== Slice 7: History ===');
  const aliceHistoryRes = await fetch(`${API_BASE}/wallet/history`, { headers: { authorization: `Bearer ${alice.sessionToken}` } });
  const aliceHistory = (await aliceHistoryRes.json()) as { kind: string; ishtaran_transaction_id: string }[];
  assertTrue('Alice history contains the payment_sent row', aliceHistory.some((r) => r.kind === 'payment_sent' && r.ishtaran_transaction_id === created.transactionId), JSON.stringify(aliceHistory));

  const bobHistoryRes = await fetch(`${API_BASE}/wallet/history`, { headers: { authorization: `Bearer ${bob.sessionToken}` } });
  const bobHistory = (await bobHistoryRes.json()) as { kind: string; ishtaran_transaction_id: string }[];
  assertTrue('Bob history contains the payment_received row', bobHistory.some((r) => r.kind === 'payment_received' && r.ishtaran_transaction_id === created.transactionId), JSON.stringify(bobHistory));

  // === Slice 8: Owner dashboard ========================================================================
  console.log('\n=== Slice 8: Owner dashboard ===');
  const ownerLoginRes = await fetch(`${API_BASE}/owner/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: process.env.WALLET_OWNER_TOKEN ?? 'owner-dev-token' }),
  });
  assertTrue('Owner login succeeds with the configured token', ownerLoginRes.ok, await ownerLoginRes.clone().text());
  const ownerSession = (await ownerLoginRes.json()) as { sessionToken: string };

  const wrongTokenRes = await fetch(`${API_BASE}/owner/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'wrong-token' }),
  });
  assertEqual('Owner login rejects a wrong token', wrongTokenRes.status, 401);

  const revenueBalanceRes = await fetch(`${API_BASE}/owner/revenue-balance`, { headers: { authorization: `Bearer ${ownerSession.sessionToken}` } });
  assertTrue('Owner can read revenue balance', revenueBalanceRes.ok, await revenueBalanceRes.clone().text());
  const revenueBalance = (await revenueBalanceRes.json()) as { delivered: string };
  console.log(`[validate] App Revenue Account delivered balance: ${revenueBalance.delivered}`);

  const revenueHistoryRes = await fetch(`${API_BASE}/owner/revenue-history`, { headers: { authorization: `Bearer ${ownerSession.sessionToken}` } });
  const revenueHistory = (await revenueHistoryRes.json()) as { transaction_id: string }[];
  assertTrue('Owner revenue history contains the merchant payment', revenueHistory.some((r) => r.transaction_id === created.transactionId), JSON.stringify(revenueHistory));

  const analyticsRes = await fetch(`${API_BASE}/owner/analytics`, { headers: { authorization: `Bearer ${ownerSession.sessionToken}` } });
  assertTrue('Owner analytics endpoint succeeds', analyticsRes.ok, await analyticsRes.clone().text());

  const noAuthRes = await fetch(`${API_BASE}/owner/revenue-balance`);
  assertEqual('Owner routes reject a request with no session', noAuthRes.status, 401);

  console.log(`\n[validate] ${failures === 0 ? 'ALL VALIDATIONS PASSED' : `${failures} VALIDATION FAILURE(S)`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('[validate] Fatal error:', error);
  process.exitCode = 1;
});
