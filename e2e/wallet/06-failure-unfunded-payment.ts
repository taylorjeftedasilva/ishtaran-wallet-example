// Scenario 6 (IMPLEMENTATION_PLAN.md Fase N) -- Failure / no partial economic effect. Attempts to
// finalize a payment whose deposit was never confirmed (the real analogue of "insufficient
// balance" under the corrected fresh-funding-per-Transaction model, GAPS.md G.1 -- there is no
// pre-existing balance to be insufficient; the real failure mode is an unfunded Transaction).
// Asserts the correct real state surfaces (never settles early) and zero Ledger movement occurs.
import { getFullAccountBalance } from '@wallet-app/ishtaran-client';
import { apiPost, bootstrap, createPayment, depositDemoFunds, mustEqual, signup } from './_shared.js';

export async function run(): Promise<void> {
  const alice = await signup('alice-unfunded');
  const bob = await signup('bob-unfunded');
  // GAPS.md G.5 -- Alice needs demo funds to pass the NEW pre-creation gate this scenario is NOT
  // about; this scenario's real subject is a DIFFERENT failure mode (an Ishtaran deposit that's
  // created but never confirmed on-chain), asserted below by skipping simulate-sandbox-send.
  await depositDemoFunds(alice.sessionToken, '50');

  const bobBefore = await getFullAccountBalance(bootstrap.apiKey, bob.accountId, bootstrap.assetNetworkId);

  const created = await createPayment(alice.sessionToken, bob.accountId, '30', 'P2P');

  // Deliberately skip simulate-sandbox-send -- the deposit is never confirmed.
  const finalize = await apiPost<{ status: string; pending?: boolean }>(`/payments/${created.body.transactionId}/finalize`, alice.sessionToken);
  mustEqual('Finalize on an unfunded Transaction never settles early', finalize.status, 202);
  mustEqual('Real status is reported (not fabricated as COMPLETED)', finalize.body.pending, true);

  const bobAfter = await getFullAccountBalance(bootstrap.apiKey, bob.accountId, bootstrap.assetNetworkId);
  mustEqual('No partial economic effect -- Bob\'s real Delivered balance is unchanged', bobAfter.delivered, bobBefore.delivered);
  console.log('[06-failure-unfunded-payment] Unfunded payment correctly stayed pending with zero Ledger movement.');
}
