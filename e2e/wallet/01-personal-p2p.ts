// Scenario 1 (IMPLEMENTATION_PLAN.md Fase N) -- Personal P2P, RevenueRule = NONE. Self-custody
// signing is exercised on the real payout leg (packages/ishtaran-client's
// completeSelfCustodySettlement, driven by apps/api's own registered execution wallet -- the end
// user never touches SigningRequest/SubmitSignedTransaction, PRODUCT_SPEC.md Section 9).
import { getFullAccountBalance } from '@wallet-app/ishtaran-client';
import { appClient, bootstrap, createPayment, depositDemoFunds, mustEqual, signup, simulateSandboxSendAndFinalize } from './_shared.js';

export async function run(): Promise<void> {
  const alice = await signup('alice-p2p');
  const bob = await signup('bob-p2p');
  await depositDemoFunds(alice.sessionToken, '100'); // GAPS.md G.5 -- real "Simular depósito" step, never bypassed.

  const bobBefore = await getFullAccountBalance(bootstrap.apiKey, bob.accountId, bootstrap.assetNetworkId);

  const created = await createPayment(alice.sessionToken, bob.accountId, '50', 'P2P');
  mustEqual('P2P calculation has no App Fee', created.body.calculation.appFeeAmount, '0');
  mustEqual('P2P mechanism is NONE', created.body.calculation.mechanism, 'NONE');

  const finalized = await simulateSandboxSendAndFinalize(alice.sessionToken, created.body);
  mustEqual('P2P settlement reaches COMPLETED', finalized.settlementStatus, 'COMPLETED');

  const settlement = await appClient.settlements.get(finalized.settlementId!);
  const bobAfter = await getFullAccountBalance(bootstrap.apiKey, bob.accountId, bootstrap.assetNetworkId);
  const bobDelta = (Number(bobAfter.delivered) - Number(bobBefore.delivered)).toFixed(6);

  mustEqual('Bob delivered balance += exactly the real Distributable Amount', bobDelta, Number(settlement.distributableAmount).toFixed(6));
  console.log(`[01-personal-p2p] Bob += ${bobDelta} USDT, Platform Fee = ${settlement.platformFeeAmount}, App Revenue untouched.`);
}
