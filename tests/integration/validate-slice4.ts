// Live Sandbox validation for Slice 3 (balance) + Slice 4 (payments/RevenueEngine), run manually:
//   1. npm run setup   (fresh Org/App/Env/API Key + execution infra)
//   2. WALLET_APP_MODE=MONETIZED npm run dev:api  (in one terminal)
//   3. npx tsx tests/integration/validate-slice4.ts   (this file, in another)
//
// Validates, against REAL Sandbox, not a mock:
//   - P2P (no App Fee) between two real AccountHolders.
//   - Merchant payment WITH App Revenue.
//   - Reconciliation: @wallet-app/revenue's calculated splitPercentage/amounts against Ishtaran's
//     own real SettlementResponse.splitAllocations AND real before/after Ledger balances.
// Exits non-zero on any mismatch -- this is a correctness gate, not a demo script.
//
// GAPS.md G.1: every payment now always funds itself via a fresh PaymentIntent tied to its own
// Transaction (no "instant send from stored balance" -- confirmed unsupported under SelfCustody).
// This script simulates the sender's own wallet broadcasting on-chain via Sandbox's
// simulateDeposit/simulateConfirmation, exactly matching examples/marketplace-mercatto/
// pay-order.ts's already-proven real buyer-funding pattern -- apps/api itself never touches
// Sandbox-only methods, only this test script does (standing in for a real wallet's broadcast).
//
// GAPS.md G.2: a Settlement beneficiary's payout under SelfCustody is credited as `Delivered`,
// never `Available` (confirmed in real backend source) -- so every balance check below reads the
// full balance (via the G.2 workaround, `getFullAccountBalance`) and reconciles against
// `delivered`, never the SDK's own `ledger.getBalance().available` alone.
import { readFileSync } from 'node:fs';
import { calculateRevenue } from '@wallet-app/revenue';
import { findRevenueRule } from '@wallet-app/wallet-core';
import { createClient, deriveTronAddress, getFullAccountBalance, wallet } from '@wallet-app/ishtaran-client';
import { MONETIZED_WALLET_CONFIG } from '@wallet-app/wallet-core';

const API_BASE = process.env.WALLET_API_BASE ?? 'http://127.0.0.1:3001';
const BOOTSTRAP_PATH = new URL('../../config/.sandbox-bootstrap.json', import.meta.url);

interface Bootstrap {
  organizationId: string;
  applicationId: string;
  environmentId: string;
  apiKey: string;
  assetNetworkId: string;
  appRevenueAccountId: string;
}

const bootstrap = JSON.parse(readFileSync(BOOTSTRAP_PATH, 'utf8')) as Bootstrap;
const appClient = createClient(bootstrap.apiKey);

let failures = 0;

function assertEqual(label: string, actual: string, expected: string): void {
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

async function delivered(accountId: string): Promise<number> {
  const full = await getFullAccountBalance(bootstrap.apiKey, accountId, bootstrap.assetNetworkId);
  return Number(full.delivered);
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

interface CreatePaymentResult {
  transactionId: string;
  paymentIntentId: string;
  depositAddress: string;
  amount: string;
  calculation: { appFeeAmount: string; recipientNet: string; senderDebit: string; allocations?: { role: string; splitPercentage: string }[] };
}

interface FinalizeResult {
  transactionId: string;
  settlementId: string;
  settlementStatus: string;
  splitAllocations: { accountId: string; amount: string }[];
}

/** Full round trip: create the payment (fresh PaymentIntent) -> simulate the sender's own wallet
 * broadcasting on-chain (Sandbox-only, standing in for a real wallet) -> finalize (Settle). */
async function pay(sessionToken: string, recipientAccountId: string, amount: string, event: string): Promise<CreatePaymentResult & FinalizeResult> {
  const createRes = await fetch(`${API_BASE}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ recipientAccountId, amount, event }),
  });
  if (!createRes.ok) throw new Error(`create payment failed: ${createRes.status} ${await createRes.text()}`);
  const created = (await createRes.json()) as CreatePaymentResult;

  const observed = await appClient.sandbox.simulateDeposit(bootstrap.environmentId, created.depositAddress, bootstrap.assetNetworkId, created.amount);
  await appClient.sandbox.simulateConfirmation(bootstrap.environmentId, observed.sandboxObservedAddressId, 1, true);

  const finalizeRes = await fetch(`${API_BASE}/payments/${created.transactionId}/finalize`, {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!finalizeRes.ok) throw new Error(`finalize payment failed: ${finalizeRes.status} ${await finalizeRes.text()}`);
  const finalized = (await finalizeRes.json()) as FinalizeResult;

  return { ...created, ...finalized };
}

async function main() {
  console.log(`[validate] API_BASE=${API_BASE}`);
  const runId = Date.now();
  const alice = await signup(`alice+validate-${runId}@example.com`);
  const bob = await signup(`bob+validate-${runId}@example.com`);
  console.log(`[validate] alice.accountId=${alice.accountId} bob.accountId=${bob.accountId}`);

  // -- Scenario 1: P2P, RevenueRule = NONE (real, MONETIZED_WALLET_CONFIG's P2P rule) ------------
  console.log('\n=== Scenario 1: P2P (no App Fee) ===');
  const bobDeliveredBeforeP2P = await delivered(bob.accountId);

  const p2pResult = await pay(alice.sessionToken, bob.accountId, '50', 'P2P');
  assertEqual('P2P settlement status', p2pResult.settlementStatus, 'COMPLETED');
  assertEqual('P2P appFeeAmount computed', p2pResult.calculation.appFeeAmount, '0');
  assertTrue('P2P mechanism is NONE (no allocations)', p2pResult.calculation.allocations === undefined, JSON.stringify(p2pResult.calculation));

  const bobDeliveredAfterP2P = await delivered(bob.accountId);
  const bobDeltaP2P = (bobDeliveredAfterP2P - bobDeliveredBeforeP2P).toFixed(6);
  const p2pSettlement = await appClient.settlements.get(p2pResult.settlementId);
  console.log(`[validate] real Ledger (Delivered) delta: bob +${bobDeltaP2P} -- Ishtaran Platform Fee on this Organization: ${p2pSettlement.platformFeeAmount} (P2P has no App Fee, but the platform's own Fee, if any, still applies and is NOT part of RevenueEngine's output -- Fase F)`);
  const expectedBobP2P = (Number(p2pSettlement.distributableAmount)).toFixed(6);
  assertEqual('P2P: Bob\'s real Delivered credit equals the real Distributable Amount (single beneficiary, implicit 100%)', bobDeltaP2P, expectedBobP2P);

  // -- Scenario 2: Merchant payment, RevenueRule = PERCENTAGE(0.7%), RECEIVER-absorbs ------------
  console.log('\n=== Scenario 2: Merchant payment (App Revenue) ===');
  const rule = findRevenueRule(MONETIZED_WALLET_CONFIG, 'MERCHANT_PAYMENT');
  assertTrue('MERCHANT_PAYMENT rule exists in MONETIZED_WALLET_CONFIG', rule !== undefined, 'missing rule');

  const bobDeliveredBeforeMerchant = await delivered(bob.accountId);
  const appRevenueDeliveredBefore = await delivered(bootstrap.appRevenueAccountId);
  const localCalc = calculateRevenue({ event: 'MERCHANT_PAYMENT', grossAmount: '100', rule: rule! });

  const merchantResult = await pay(alice.sessionToken, bob.accountId, '100', 'MERCHANT_PAYMENT');
  assertEqual('Merchant: server calculation matches local @wallet-app/revenue calculation (appFeeAmount)', merchantResult.calculation.appFeeAmount, localCalc.appFeeAmount);
  assertEqual('Merchant: server calculation matches local calculation (recipientNet)', merchantResult.calculation.recipientNet, localCalc.recipientNet);
  assertEqual('Merchant settlement status', merchantResult.settlementStatus, 'COMPLETED');

  const bobDeliveredAfterMerchant = await delivered(bob.accountId);
  const appRevenueDeliveredAfter = await delivered(bootstrap.appRevenueAccountId);
  const bobDeltaMerchant = (bobDeliveredAfterMerchant - bobDeliveredBeforeMerchant).toFixed(6);
  const appRevenueDelta = (appRevenueDeliveredAfter - appRevenueDeliveredBefore).toFixed(6);
  console.log(`[validate] real Ledger (Delivered) deltas: bob +${bobDeltaMerchant}, appRevenue +${appRevenueDelta}`);

  // Real settlement.splitAllocations -- the authoritative, independently-observed economic result.
  const settlement = await appClient.settlements.get(merchantResult.settlementId);
  console.log(`[validate] real settlement: gross=${settlement.grossAmount} platformFee=${settlement.platformFeeAmount} distributable=${settlement.distributableAmount}`);
  const bobAllocation = settlement.splitAllocations.find((a) => a.accountId === bob.accountId);
  const appRevenueAllocation = settlement.splitAllocations.find((a) => a.accountId === bootstrap.appRevenueAccountId);
  assertTrue('Real settlement has a split allocation for Bob', bobAllocation !== undefined, 'missing');
  assertTrue('Real settlement has a split allocation for App Revenue', appRevenueAllocation !== undefined, 'missing');

  // The Delivered credit (real money, real Ledger) must match the settlement's own split
  // allocation exactly -- and separately, RevenueEngine's splitPercentage x real Distributable
  // Amount must match too (BR-STL-005: split runs over Distributable, never Gross -- Fase F's
  // absolute-amount worked examples assumed Platform Fee = 0 and only hold verbatim when it is).
  assertEqual('Merchant: real Delivered credit for Bob matches settlement.splitAllocations', bobDeltaMerchant, Number(bobAllocation!.amount).toFixed(6));
  assertEqual('Merchant: real Delivered credit for App Revenue matches settlement.splitAllocations', appRevenueDelta, Number(appRevenueAllocation!.amount).toFixed(6));

  const distributable = Number(settlement.distributableAmount);
  const expectedBobAmount = (distributable * Number(localCalc.allocations![0]!.splitPercentage) / 100).toFixed(6);
  const expectedAppRevenueAmount = (distributable * Number(localCalc.allocations![1]!.splitPercentage) / 100).toFixed(6);
  assertEqual('Merchant: real Bob allocation matches RevenueEngine splitPercentage x real Distributable', Number(bobAllocation!.amount).toFixed(6), expectedBobAmount);
  assertEqual('Merchant: real App Revenue allocation matches RevenueEngine splitPercentage x real Distributable', Number(appRevenueAllocation!.amount).toFixed(6), expectedAppRevenueAmount);
  if (settlement.platformFeeAmount !== '0') {
    console.log(`[validate] NOTE: this Organization's PricingPolicy charges a nonzero Platform Fee (${settlement.platformFeeAmount}) -- confirms Fase F's own caveat that its absolute-amount worked examples assumed Platform Fee = 0.`);
  }

  console.log(`\n[validate] ${failures === 0 ? 'ALL RECONCILIATIONS PASSED' : `${failures} RECONCILIATION FAILURE(S)`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('[validate] Fatal error:', error);
  process.exitCode = 1;
});
