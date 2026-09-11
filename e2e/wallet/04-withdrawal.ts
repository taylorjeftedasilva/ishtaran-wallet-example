// Scenario 4 (IMPLEMENTATION_PLAN.md Fase N) -- Withdrawal. Scope note, stated plainly: this
// exercises PLAIN Withdrawal only (destination creation, quote, real-cooldown-respecting
// request). Withdrawal APP FEE composition is NOT built -- GAPS.md's carried-forward note (under
// G.1) leaves open whether a fee-collection Settlement can run without asking the user to fund it
// a second time; that needs its own live Sandbox check before being implemented, not assumed
// here. This scenario never bypasses the real 24h/168h WithdrawalDestination cooldown (Mercatto's
// own GAPS.md F.4): a successful RequestWithdrawal cannot be demonstrated in one fast CI-style
// run, so this asserts the REAL rejection instead, marked WAITING_REAL_COOLDOWN below --
// exactly the honest split IMPLEMENTATION_PLAN.md's own Fase N calls for.
import { deriveTronAddress, wallet } from '@wallet-app/ishtaran-client';
import { apiGet, apiPost, must, mustEqual, signup } from './_shared.js';

export async function run(): Promise<void> {
  const alice = await signup('alice-withdraw');

  const generated = wallet.generate();
  const externalAddress = deriveTronAddress(generated.wallet.accountExtendedPublicKey, 0);

  const destination = await apiPost<{ withdrawalDestinationId: string }>('/wallet/withdrawal-destinations', alice.sessionToken, { address: externalAddress });
  mustEqual('Withdrawal destination created', destination.status, 201);

  const quote = await apiGet<{ requestedAmount: string; estimatedRecipientAmount: string; networkExecutionCost: string | null }>(
    `/wallet/withdrawal-quote?withdrawalDestinationId=${destination.body.withdrawalDestinationId}&amount=10`,
    alice.sessionToken,
  );
  mustEqual('Withdrawal quote succeeds', quote.status, 200);
  console.log(`[04-withdrawal] quote: requested=${quote.body.requestedAmount} estimatedRecipient=${quote.body.estimatedRecipientAmount}`);

  const withdrawal = await apiPost<{ error: string; code: string }>('/wallet/withdrawals', alice.sessionToken, {
    withdrawalDestinationId: destination.body.withdrawalDestinationId,
    amount: '10',
  });

  // READY_TO_RUN / WAITING_REAL_COOLDOWN split (Fase N.4): a freshly created destination is
  // always inside its real 24h activation cooldown -- this branch is what every fast/CI run
  // actually exercises and asserts. The success branch (destination already past cooldown) is
  // WAITING_REAL_COOLDOWN -- not exercised by this run, never faked.
  if (withdrawal.status === 422 && withdrawal.body.code === 'WITHDRAWAL_DESTINATION_NOT_USABLE') {
    console.log('[04-withdrawal] READY_TO_RUN branch: real cooldown correctly rejected the withdrawal (never bypassed).');
    return;
  }
  must(withdrawal.status === 201, `unexpected withdrawal response: ${withdrawal.status} ${JSON.stringify(withdrawal.body)}`);
  console.log('[04-withdrawal] WAITING_REAL_COOLDOWN branch reached: destination was already past cooldown, real withdrawal request accepted.');
}
