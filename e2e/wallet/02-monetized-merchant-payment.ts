// Scenario 2 (IMPLEMENTATION_PLAN.md Fase N) -- Monetized merchant payment. Asserts, from real
// Ledger reads (never trusting apps/api's own response alone): Gross, Platform Fee,
// Distributable, Bob's amount, App Owner's revenue -- each independently, never summed together.
import { getFullAccountBalance } from '@wallet-app/ishtaran-client';
import { appClient, bootstrap, createPayment, depositDemoFunds, must, mustEqual, signup, simulateSandboxSendAndFinalize } from './_shared.js';

export async function run(): Promise<void> {
  const alice = await signup('alice-merchant');
  const bob = await signup('bob-merchant');
  await depositDemoFunds(alice.sessionToken, '150'); // GAPS.md G.5

  const bobBefore = await getFullAccountBalance(bootstrap.apiKey, bob.accountId, bootstrap.assetNetworkId);
  const revenueBefore = await getFullAccountBalance(bootstrap.apiKey, bootstrap.appRevenueAccountId, bootstrap.assetNetworkId);

  const created = await createPayment(alice.sessionToken, bob.accountId, '100', 'MERCHANT_PAYMENT');
  mustEqual('Merchant calculation has App Fee', created.body.calculation.appFeeAmount, '0.7');
  mustEqual('Merchant mechanism is SPLIT_PARTICIPANT', created.body.calculation.mechanism, 'SPLIT_PARTICIPANT');

  const finalized = await simulateSandboxSendAndFinalize(alice.sessionToken, created.body);
  mustEqual('Merchant settlement reaches COMPLETED', finalized.settlementStatus, 'COMPLETED');

  const settlement = await appClient.settlements.get(finalized.settlementId!);
  must(Number(settlement.grossAmount) === 100, `gross should be 100, got ${settlement.grossAmount}`);
  must(Number(settlement.distributableAmount) === Number(settlement.grossAmount) - Number(settlement.platformFeeAmount), 'distributable = gross - platformFee');

  const bobAfter = await getFullAccountBalance(bootstrap.apiKey, bob.accountId, bootstrap.assetNetworkId);
  const revenueAfter = await getFullAccountBalance(bootstrap.apiKey, bootstrap.appRevenueAccountId, bootstrap.assetNetworkId);
  const bobDelta = (Number(bobAfter.delivered) - Number(bobBefore.delivered)).toFixed(6);
  const revenueDelta = (Number(revenueAfter.delivered) - Number(revenueBefore.delivered)).toFixed(6);

  const bobAllocation = settlement.splitAllocations.find((a) => a.accountId === bob.accountId);
  const revenueAllocation = settlement.splitAllocations.find((a) => a.accountId === bootstrap.appRevenueAccountId);
  must(bobAllocation !== undefined, 'Bob must have a real split allocation');
  must(revenueAllocation !== undefined, 'App Revenue must have a real split allocation');

  mustEqual('Bob delivered delta matches his real split allocation', bobDelta, Number(bobAllocation!.amount).toFixed(6));
  mustEqual('App Revenue delivered delta matches its real split allocation', revenueDelta, Number(revenueAllocation!.amount).toFixed(6));

  console.log(
    `[02-monetized-merchant-payment] gross=${settlement.grossAmount} platformFee=${settlement.platformFeeAmount} ` +
      `distributable=${settlement.distributableAmount} bob+=${bobDelta} appRevenue+=${revenueDelta}`,
  );
}
