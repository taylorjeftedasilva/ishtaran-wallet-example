// Scenario 3 (IMPLEMENTATION_PLAN.md Fase N) -- Receiver absorbs fee. Uses the generic `PAYMENT`
// rule (MONETIZED_WALLET_CONFIG: PERCENTAGE 1%, RECEIVER-absorbs) to prove the recipient's amount
// is REDUCED by the App Fee, never added on top -- the sender's own transactionAmount is
// unaffected by the fee (Fase F "receiver absorbs" formula).
import { getFullAccountBalance } from '@wallet-app/ishtaran-client';
import { bootstrap, createPayment, depositDemoFunds, must, mustEqual, signup, simulateSandboxSendAndFinalize } from './_shared.js';

export async function run(): Promise<void> {
  const alice = await signup('alice-absorb');
  const bob = await signup('bob-absorb');
  await depositDemoFunds(alice.sessionToken, '250'); // GAPS.md G.5

  const bobBefore = await getFullAccountBalance(bootstrap.apiKey, bob.accountId, bootstrap.assetNetworkId);

  const created = await createPayment(alice.sessionToken, bob.accountId, '200', 'PAYMENT');
  mustEqual('PAYMENT gross amount unaffected by receiver-absorbed fee (transactionAmount == gross)', created.body.amount, '200');
  mustEqual('Recipient net is gross minus the 1% App Fee', created.body.calculation.recipientNet, '198');
  mustEqual('senderDebit equals the unmodified gross (sender never pays extra)', created.body.calculation.senderDebit, '200');

  const finalized = await simulateSandboxSendAndFinalize(alice.sessionToken, created.body);
  mustEqual('Settlement reaches COMPLETED', finalized.settlementStatus, 'COMPLETED');

  const bobAfter = await getFullAccountBalance(bootstrap.apiKey, bob.accountId, bootstrap.assetNetworkId);
  const bobDelta = Number(bobAfter.delivered) - Number(bobBefore.delivered);
  must(bobDelta < 200, `Bob's real credit (${bobDelta}) must be less than the gross (200) -- the fee was absorbed from his side, not added to Alice's`);
  console.log(`[03-receiver-absorbs-fee] Bob received ${bobDelta.toFixed(6)} of a 200 gross payment (fee absorbed from his side).`);
}
