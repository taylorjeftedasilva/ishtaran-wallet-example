// Wallet E2E runner (IMPLEMENTATION_PLAN.md Fase N/O) -- the 8 canonical scenarios, run against
// apps/api's real HTTP surface. Prerequisite (not started by this runner): `npm run setup` then
// `WALLET_APP_MODE=MONETIZED npm run dev:api` already running. Each scenario is independent --
// one failure never blocks the rest -- with a final pass/fail summary, matching
// examples/marketplace-mercatto/tests/scenarios.e2e.ts's own proven shape exactly.
import { run as personalP2p } from './01-personal-p2p.js';
import { run as monetizedMerchantPayment } from './02-monetized-merchant-payment.js';
import { run as receiverAbsorbsFee } from './03-receiver-absorbs-fee.js';
import { run as withdrawal } from './04-withdrawal.js';
import { run as paymentRequest } from './05-payment-request.js';
import { run as failureUnfundedPayment } from './06-failure-unfunded-payment.js';
import { run as webhookDuplicate } from './07-webhook-duplicate.js';
import { run as refund } from './08-refund.js';
import { run as walletBalanceIntegration } from './09-wallet-balance-integration.js';

const scenarios: Array<{ name: string; run: () => Promise<void> }> = [
  { name: '01-personal-p2p', run: personalP2p },
  { name: '02-monetized-merchant-payment', run: monetizedMerchantPayment },
  { name: '03-receiver-absorbs-fee', run: receiverAbsorbsFee },
  { name: '04-withdrawal', run: withdrawal },
  { name: '05-payment-request', run: paymentRequest },
  { name: '06-failure-unfunded-payment', run: failureUnfundedPayment },
  { name: '07-webhook-duplicate', run: webhookDuplicate },
  { name: '08-refund', run: refund },
  { name: '09-wallet-balance-integration', run: walletBalanceIntegration },
];

async function main() {
  const results: Array<{ name: string; ok: boolean; error?: string }> = [];

  for (const scenario of scenarios) {
    console.log(`\n=== ${scenario.name} ===`);
    try {
      await scenario.run();
      results.push({ name: scenario.name, ok: true });
    } catch (err) {
      console.error(`[${scenario.name}] FAILED: ${err instanceof Error ? err.message : err}`);
      results.push({ name: scenario.name, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log('\n=== Wallet E2E Summary ===');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? `  -- ${r.error}` : ''}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nWallet: ${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length > 0) process.exitCode = 1;
}

main();
