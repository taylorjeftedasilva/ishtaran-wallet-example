// Scenario 5 (IMPLEMENTATION_PLAN.md Fase N) -- Payment request. Bob creates a request; Alice
// pays it via the SAME real CreateTransaction+CreatePaymentIntent+ExecuteSettlement flow as any
// other payment (routes/paymentRequests.ts reuses routes/payments.ts's createPayment). Asserts
// amount, recipient, status transitions (ACTIVE -> still ACTIVE right after /pay creates the
// Transaction, only PAID once Settlement actually completes -- Prompt 2 correctness fix, a
// request must never be marked PAID before anything real settled), payment completion, and that
// replaying the SAME request id for /pay does not double-charge (idempotency -- the request is
// already PAID).
import { getFullAccountBalance } from '@wallet-app/ishtaran-client';
import { apiGet, apiPost, bootstrap, depositDemoFunds, mustEqual, signup, simulateSandboxSendAndFinalize } from './_shared.js';

interface PaymentRequestRow {
  id: string;
  requester_account_id: string;
  amount: string;
  description: string;
  status: string;
}

export async function run(): Promise<void> {
  const bob = await signup('bob-request');
  const alice = await signup('alice-request');
  await depositDemoFunds(alice.sessionToken, '50'); // GAPS.md G.5 -- Alice is the payer here.

  const createReq = await apiPost<{ id: string; amount: string; status: string }>('/wallet/payment-requests', bob.sessionToken, {
    amount: '15',
    description: 'Coffee',
  });
  mustEqual('Payment request created', createReq.status, 201);
  mustEqual('Payment request starts ACTIVE', createReq.body.status, 'ACTIVE');

  const fetched = await apiGet<PaymentRequestRow>(`/wallet/payment-requests/${createReq.body.id}`, alice.sessionToken);
  mustEqual('Fetched request has the real requester accountId', fetched.body.requester_account_id, bob.accountId);
  mustEqual('Fetched request has the real amount', fetched.body.amount, '15');

  const bobBefore = await getFullAccountBalance(bootstrap.apiKey, bob.accountId, bootstrap.assetNetworkId);

  const pay = await apiPost<{ transactionId: string; depositAddress: string; amount: string; calculation: unknown }>(
    `/wallet/payment-requests/${createReq.body.id}/pay`,
    alice.sessionToken,
  );
  mustEqual('Paying the request creates a real payment', pay.status, 201);

  // Prompt 2 correctness fix: `/pay` only creates the real Transaction + PaymentIntent (needed so
  // the review screen can show the real fee split) -- it must NEVER mark PAID before anything is
  // actually funded/settled. Status stays ACTIVE right here; only the finalize call below (real
  // Settlement completion) is allowed to flip it.
  const afterCreate = await apiGet<PaymentRequestRow>(`/wallet/payment-requests/${createReq.body.id}`, alice.sessionToken);
  mustEqual('Request status stays ACTIVE right after payment creation -- nothing settled yet', afterCreate.body.status, 'ACTIVE');

  const finalized = await simulateSandboxSendAndFinalize(alice.sessionToken, pay.body as never);
  mustEqual('Payment request settlement reaches COMPLETED', finalized.settlementStatus, 'COMPLETED');

  const afterFinalize = await apiGet<PaymentRequestRow>(`/wallet/payment-requests/${createReq.body.id}`, alice.sessionToken);
  mustEqual('Request status becomes PAID only once Settlement actually completes', afterFinalize.body.status, 'PAID');

  const bobAfter = await getFullAccountBalance(bootstrap.apiKey, bob.accountId, bootstrap.assetNetworkId);
  const delta = Number(bobAfter.delivered) - Number(bobBefore.delivered);
  console.log(`[05-payment-request] Bob (requester) received ${delta.toFixed(6)} USDT for his 15 USDT request.`);

  const replay = await apiPost<{ error: string; code: string }>(`/wallet/payment-requests/${createReq.body.id}/pay`, alice.sessionToken);
  mustEqual('Replaying /pay on an already-PAID request is rejected, never double-charges', replay.status, 409);
  mustEqual('Replay rejection carries the real code', replay.body.code, 'PAYMENT_REQUEST_NOT_ACTIVE');
}
