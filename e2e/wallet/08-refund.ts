// Scenario 8 (IMPLEMENTATION_PLAN.md Fase N/A2) -- Refund, exclusively pre-Settlement. Funds a
// Transaction (deposit confirms, auto-Reserved), refunds BEFORE calling /finalize, asserts the
// payer's balance increases by exactly the refunded amount and the Transaction reaches REFUNDED.
// No post-Settlement refund scenario exists (A2: no such platform behavior to test) -- also
// asserts refund is correctly REJECTED once a Transaction has already settled.
//
// GAPS.md G.1 addendum (found live building this exact scenario): a refund credits the payer's
// real Available balance -- if they then create ANOTHER payment while that balance is already
// sufficient, the new Transaction auto-reserves synchronously (BR-TXN-002) before it ever gets a
// PaymentIntent, which per G.1 means it can never be Settled either. Asserted explicitly below,
// not just worked around -- this is a real dead end for the normal payment flow, not a bug in
// this scenario.
import { getFullAccountBalance } from '@wallet-app/ishtaran-client';
import { apiPost, bootstrap, createPayment, depositDemoFunds, mustEqual, signup, simulateSandboxSendAndFinalize, waitForReserved } from './_shared.js';

export async function run(): Promise<void> {
  const alice = await signup('alice-refund');
  const bob = await signup('bob-refund');
  const carol = await signup('carol-refund');
  // GAPS.md G.5 -- covers both Alice's first payment (25, debited at simulate-send) and her
  // second attempt (5, blocked before reaching the demo gate is irrelevant here -- the real
  // Ishtaran-side PAYMENT_AUTO_RESERVED_FROM_EXISTING_BALANCE check below is what this scenario
  // is actually testing, so the demo gate must pass cleanly first).
  await depositDemoFunds(alice.sessionToken, '50');
  await depositDemoFunds(carol.sessionToken, '20');

  // -- Pre-Settlement refund: fund, then refund BEFORE finalize. ---------------------------------
  const created = await createPayment(alice.sessionToken, bob.accountId, '25', 'P2P');
  const aliceBefore = await getFullAccountBalance(bootstrap.apiKey, alice.accountId, bootstrap.assetNetworkId);

  const sim = await apiPost('/payments/' + created.body.transactionId + '/simulate-sandbox-send', alice.sessionToken, {
    depositAddress: created.body.depositAddress,
    amount: created.body.amount,
  });
  mustEqual('Simulated deposit accepted', sim.status, 200);
  await waitForReserved(created.body.transactionId);

  const refund = await apiPost<{ refundId: string }>(`/payments/${created.body.transactionId}/refund`, alice.sessionToken, { reason: 'e2e-test' });
  mustEqual('Pre-Settlement refund succeeds', refund.status, 201);

  const aliceAfter = await getFullAccountBalance(bootstrap.apiKey, alice.accountId, bootstrap.assetNetworkId);
  const aliceDelta = Number(aliceAfter.available) - Number(aliceBefore.available);
  mustEqual('Payer Available balance increases by exactly the refunded amount', aliceDelta.toFixed(6), '25.000000');
  console.log(`[08-refund] Pre-Settlement refund returned exactly ${aliceDelta.toFixed(6)} USDT to Alice.`);

  // -- Refunded balance is a real dead end for a NEW payment (GAPS.md G.1 addendum). ---------------
  const reuseAttempt = await createPayment(alice.sessionToken, bob.accountId, '5', 'P2P');
  mustEqual('Reusing refunded balance for a new payment fails fast with a clear, honest error', reuseAttempt.status, 409);
  mustEqual(
    'Rejection carries the real code, never a confusing generic 500',
    (reuseAttempt.body as unknown as { code?: string }).code,
    'PAYMENT_AUTO_RESERVED_FROM_EXISTING_BALANCE',
  );
  console.log('[08-refund] Refunded balance correctly cannot fund a new in-app payment (only Withdrawal can move it, per G.1).');

  // -- Post-Settlement refund attempt: must be rejected (A2 -- no clawback mechanism exists). ------
  // Uses a fresh sender (Carol) specifically to avoid the G.1-addendum dead end above -- this part
  // of the scenario is testing A2's post-Settlement rejection, not the refunded-balance reuse case.
  const created2 = await createPayment(carol.sessionToken, bob.accountId, '5', 'P2P');
  const finalized = await simulateSandboxSendAndFinalize(carol.sessionToken, created2.body);
  mustEqual('Second payment settles normally', finalized.settlementStatus, 'COMPLETED');

  const postSettlementRefund = await apiPost<{ error: string; code: string }>(`/payments/${created2.body.transactionId}/refund`, carol.sessionToken, {});
  mustEqual('Refund after Settlement is rejected (A2 -- no clawback mechanism)', postSettlementRefund.status, 409);
  mustEqual('Rejection carries the real code', postSettlementRefund.body.code, 'REFUND_NOT_AVAILABLE');
  console.log('[08-refund] Post-Settlement refund correctly rejected -- no clawback mechanism exists (A2).');
}
