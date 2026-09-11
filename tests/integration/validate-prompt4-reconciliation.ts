// Prompt 4 -- Economic reconciliation table for the 3 principal financial scenarios (P2P fee 0,
// monetized merchant, receiver absorbs). Every column is read from real Ishtaran state (Settlement
// response + real Ledger Delivered/Available deltas) -- nothing here is computed locally except
// where explicitly labeled "(local calc)" for side-by-side comparison against the real result.
import { readFileSync } from 'node:fs';
import { calculateRevenue } from '@wallet-app/revenue';
import { findRevenueRule, MONETIZED_WALLET_CONFIG } from '@wallet-app/wallet-core';
import { createClient, deriveTronAddress, getFullAccountBalance, wallet } from '@wallet-app/ishtaran-client';

const API_BASE = process.env.WALLET_API_BASE ?? 'http://127.0.0.1:3001';
const bootstrap = JSON.parse(readFileSync(new URL('../../config/.sandbox-bootstrap.json', import.meta.url), 'utf8'));
const appClient = createClient(bootstrap.apiKey);

interface Row {
  scenario: string;
  gross: string;
  platformFee: string;
  distributable: string;
  recipient: string;
  appRevenue: string;
  networkCost: string;
  ledgerReconciled: boolean;
}

async function signup(prefix: string) {
  const slug = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const generated = wallet.generate();
  const destinationAddress = deriveTronAddress(generated.wallet.accountExtendedPublicKey, 0);
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${slug}-${Date.now()}@example.com`, password: 'Str0ngP@ssw0rd!123', destinationAddress }),
  });
  if (!res.ok) throw new Error(`signup(${prefix}) failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { sessionToken: string; accountId: string };
}

async function payAndFinalize(sessionToken: string, recipientAccountId: string, amount: string, event: string) {
  const createRes = await fetch(`${API_BASE}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ recipientAccountId, amount, event }),
  });
  const created = (await createRes.json()) as { transactionId: string; depositAddress: string; amount: string };
  const observed = await appClient.sandbox.simulateDeposit(bootstrap.environmentId, created.depositAddress, bootstrap.assetNetworkId, created.amount);
  await appClient.sandbox.simulateConfirmation(bootstrap.environmentId, observed.sandboxObservedAddressId, 1, true);
  const finalizeRes = await fetch(`${API_BASE}/payments/${created.transactionId}/finalize`, { method: 'POST', headers: { authorization: `Bearer ${sessionToken}` } });
  const finalized = (await finalizeRes.json()) as { settlementId: string; settlementStatus: string };
  return finalized;
}

async function runScenario(name: string, event: string, amount: string): Promise<Row> {
  const alice = await signup(`recon-alice-${name}`);
  const bob = await signup(`recon-bob-${name}`);

  const recipientBefore = await getFullAccountBalance(bootstrap.apiKey, bob.accountId, bootstrap.assetNetworkId);
  const revenueBefore = await getFullAccountBalance(bootstrap.apiKey, bootstrap.appRevenueAccountId, bootstrap.assetNetworkId);

  const finalized = await payAndFinalize(alice.sessionToken, bob.accountId, amount, event);
  const settlement = await appClient.settlements.get(finalized.settlementId);

  const recipientAfter = await getFullAccountBalance(bootstrap.apiKey, bob.accountId, bootstrap.assetNetworkId);
  const revenueAfter = await getFullAccountBalance(bootstrap.apiKey, bootstrap.appRevenueAccountId, bootstrap.assetNetworkId);

  const recipientDelta = (Number(recipientAfter.delivered) - Number(recipientBefore.delivered)).toFixed(6);
  const appRevenueDeliveredDelta = (Number(revenueAfter.delivered) - Number(revenueBefore.delivered)).toFixed(6);
  // Network Execution Cost is billed separately against the NetworkCostPayerAccount's own
  // Available balance (never part of Settlement's own response fields) -- isolated here as the
  // Available-balance drain net of any Delivered credit the SAME account received as a
  // beneficiary in this scenario (App Revenue Account is both NetworkCostPayerAccount and, when
  // monetized, a real Settlement beneficiary in the same call).
  const revenueAvailableDelta = Number(revenueBefore.available) - Number(revenueAfter.available);
  const networkCost = revenueAvailableDelta.toFixed(6);

  const bobAllocation = settlement.splitAllocations.find((a) => a.accountId === bob.accountId);
  const revenueAllocation = settlement.splitAllocations.find((a) => a.accountId === bootstrap.appRevenueAccountId);

  const ledgerReconciled =
    finalized.settlementStatus === 'COMPLETED' &&
    (bobAllocation === undefined || recipientDelta === Number(bobAllocation.amount).toFixed(6)) &&
    (revenueAllocation === undefined || appRevenueDeliveredDelta === Number(revenueAllocation.amount).toFixed(6));

  return {
    scenario: name,
    gross: settlement.grossAmount,
    platformFee: settlement.platformFeeAmount,
    distributable: settlement.distributableAmount,
    recipient: recipientDelta,
    appRevenue: appRevenueDeliveredDelta,
    networkCost,
    ledgerReconciled,
  };
}

async function main() {
  const rows: Row[] = [];

  rows.push(await runScenario('P2P (fee 0)', 'P2P', '50'));

  const merchantRule = findRevenueRule(MONETIZED_WALLET_CONFIG, 'MERCHANT_PAYMENT')!;
  const merchantLocal = calculateRevenue({ event: 'MERCHANT_PAYMENT', grossAmount: '100', rule: merchantRule });
  console.log(`[local calc] merchant: appFee=${merchantLocal.appFeeAmount} recipientNet=${merchantLocal.recipientNet}`);
  rows.push(await runScenario('Monetized merchant', 'MERCHANT_PAYMENT', '100'));

  const paymentRule = findRevenueRule(MONETIZED_WALLET_CONFIG, 'PAYMENT')!;
  const receiverAbsorbsLocal = calculateRevenue({ event: 'PAYMENT', grossAmount: '200', rule: paymentRule });
  console.log(`[local calc] receiver-absorbs: appFee=${receiverAbsorbsLocal.appFeeAmount} recipientNet=${receiverAbsorbsLocal.recipientNet}`);
  rows.push(await runScenario('Receiver absorbs fee', 'PAYMENT', '200'));

  console.log('\n| Scenario | Gross | Platform Fee | Distributable | Recipient | App Revenue | Network Cost | Ledger Reconciled |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(`| ${r.scenario} | ${r.gross} | ${r.platformFee} | ${r.distributable} | ${r.recipient} | ${r.appRevenue} | ${r.networkCost} | ${r.ledgerReconciled ? 'YES' : 'NO'} |`);
  }

  const allReconciled = rows.every((r) => r.ledgerReconciled);
  console.log(`\n[validate] ECONOMIC RECONCILIATION: ${allReconciled ? 'PASS' : 'FAIL'}`);
  process.exitCode = allReconciled ? 0 : 1;
}

main().catch((error) => {
  console.error('[validate] Fatal error:', error);
  process.exitCode = 1;
});
