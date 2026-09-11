// Scenario 7 (IMPLEMENTATION_PLAN.md Fase N/L) -- Webhook duplicate. Redelivers the same
// X-Webhook-Delivery-Id twice; asserts the projection processes it exactly once (dedupe table
// checked). Uses the SDK's own real `computeWebhookSignature` against the webhook secret
// scripts/setup.ts issued (GAPS.md G.3: a real Ishtaran-issued secret when WALLET_WEBHOOK_URL is
// a real public URL, a clearly-labeled local test-only one otherwise -- either way, this is the
// real signature-verification code path, never mocked).
import { computeWebhookSignature } from '@ishtaran/sdk';
import { API_BASE, bootstrap, createPayment, depositDemoFunds, mustEqual, signup, simulateSandboxSendAndFinalize } from './_shared.js';

export async function run(): Promise<void> {
  const alice = await signup('alice-webhook');
  const bob = await signup('bob-webhook');
  await depositDemoFunds(alice.sessionToken, '20'); // GAPS.md G.5

  const created = await createPayment(alice.sessionToken, bob.accountId, '5', 'P2P');
  await simulateSandboxSendAndFinalize(alice.sessionToken, created.body);

  const rawBody = JSON.stringify({ TransactionId: created.body.transactionId });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = computeWebhookSignature(timestamp, rawBody, bootstrap.webhookSecret);
  const deliveryId = `e2e-${Date.now()}`;

  const headers = {
    'content-type': 'application/json',
    'x-webhook-signature': signature,
    'x-webhook-timestamp': String(timestamp),
    'x-webhook-delivery-id': deliveryId,
  };

  const first = await fetch(`${API_BASE}/webhooks/ishtaran`, { method: 'POST', headers, body: rawBody });
  mustEqual('First delivery accepted and processed', first.status, 200);
  const firstBody = (await first.json()) as { received?: boolean; deduped?: boolean };
  mustEqual('First delivery is NOT reported as a dedupe', firstBody.deduped, undefined);

  const redelivered = await fetch(`${API_BASE}/webhooks/ishtaran`, { method: 'POST', headers, body: rawBody });
  mustEqual('Redelivered (same delivery id) accepted', redelivered.status, 200);
  const redeliveredBody = (await redelivered.json()) as { received?: boolean; deduped?: boolean };
  mustEqual('Redelivery is reported as deduped -- processed exactly once', redeliveredBody.deduped, true);

  console.log('[07-webhook-duplicate] Same X-Webhook-Delivery-Id processed exactly once.');
}
