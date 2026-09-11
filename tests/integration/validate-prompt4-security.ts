// Prompt 4 -- Security Gate additions not already covered by e2e/wallet/07-webhook-duplicate.ts:
// duplicate financial request safety (same idempotency key fired concurrently -> exactly one real
// Transaction). Run manually against a running `WALLET_APP_MODE=MONETIZED npm run dev:api`.
import { readFileSync } from 'node:fs';
import { createClient } from '@wallet-app/ishtaran-client';

const API_BASE = process.env.WALLET_API_BASE ?? 'http://127.0.0.1:3001';
const bootstrap = JSON.parse(readFileSync(new URL('../../config/.sandbox-bootstrap.json', import.meta.url), 'utf8'));
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

async function signup(prefix: string) {
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${prefix}-${Date.now()}@example.com`, password: 'Str0ngP@ssw0rd!123', destinationAddress: 'TQn9Y2khEsLMG6XwFqO8fL8EnA1kUnQq2p' }),
  });
  return (await res.json()) as { sessionToken: string; accountId: string };
}

async function main() {
  console.log('=== Security: duplicate financial request (concurrent, same idempotency key) ===');
  const alice = await signup('sec-alice');
  const bob = await signup('sec-bob');
  const clientPaymentAttemptId = `security-test-${Date.now()}`;
  const body = JSON.stringify({ recipientAccountId: bob.accountId, amount: '3', event: 'P2P', clientPaymentAttemptId });

  const [r1, r2] = await Promise.all([
    fetch(`${API_BASE}/payments`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.sessionToken}` }, body }),
    fetch(`${API_BASE}/payments`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.sessionToken}` }, body }),
  ]);
  const [b1, b2] = await Promise.all([r1.json(), r2.json()]) as [{ transactionId?: string }, { transactionId?: string }];
  console.log(`[validate] concurrent call statuses: ${r1.status}, ${r2.status}`);
  console.log(`[validate] transactionIds: ${b1.transactionId}, ${b2.transactionId}`);

  const successfulTxIds = [b1.transactionId, b2.transactionId].filter((id): id is string => Boolean(id));
  const uniqueTxIds = new Set(successfulTxIds);
  assertEqual('Concurrent identical requests never produce more than one distinct real Transaction', uniqueTxIds.size <= 1, true);

  if (uniqueTxIds.size === 1) {
    const txId = [...uniqueTxIds][0]!;
    const transaction = await appClient.transactions.get(txId);
    assertEqual('The one real Transaction has the expected amount (never double-charged)', transaction.amount, '3.000000000000000000');
  }

  console.log(`\n[validate] ${failures === 0 ? 'ALL SECURITY CHECKS PASSED' : `${failures} SECURITY CHECK FAILURE(S)`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('[validate] Fatal error:', error);
  process.exitCode = 1;
});
