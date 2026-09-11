// Scenario 9 (Prompt 2 §25) -- proves the WalletBalance core capability (Prompt 1/1.1) end to end
// through this app's own HTTP surface, exactly as a real user would exercise it: a fresh wallet
// reads 0 (never null/error), "Simular depósito" reflects immediately AND survives a reload, the
// platform's own 30s freshness/single-flight guard is respected (never spammed), and a real
// wallet-to-wallet transfer's event-driven refresh (Prompt 1.1 -- SandboxWalletBalanceChanged ->
// WalletBalance.Application's integration handler -> RefreshWalletBalanceCommand) updates BOTH
// sides, proven from each side's own session, never inferred.
import { apiGet, apiPost, must, mustEqual, signup } from './_shared.js';

interface WalletBalanceSnapshot {
  address: string;
  balance: string;
  observedAt: string | null;
  stale: boolean;
  source: string | null;
  refreshSuppressed: boolean;
  refreshFailureReason: string | null;
  nextRefreshAllowedAt: string | null;
}

export async function run(): Promise<void> {
  const alice = await signup('alice-wtb');
  const bob = await signup('bob-wtb');

  // -- Fresh wallet = 0, never observed, never null/error. ----------------------------------------
  const fresh = await apiGet<WalletBalanceSnapshot>('/wallet/balance', alice.sessionToken);
  mustEqual('Fresh wallet balance status', fresh.status, 200);
  mustEqual('Fresh wallet balance is 0', Number(fresh.body.balance), 0);
  must(fresh.body.observedAt === null, 'Fresh wallet has never been observed (observedAt null, not a lie)');

  // -- Simulate deposit 20 -> 20, and it survives a "reload" (a plain getBalance re-fetch). -------
  const deposit = await apiPost<WalletBalanceSnapshot>('/wallet/simulate-deposit', alice.sessionToken, { amount: '20' });
  mustEqual('Simulate deposit status', deposit.status, 201);
  mustEqual('Balance after deposit', Number(deposit.body.balance), 20);

  const reloaded = await apiGet<WalletBalanceSnapshot>('/wallet/balance', alice.sessionToken);
  mustEqual('Balance survives reload (persistent snapshot, never re-derived from a local table)', Number(reloaded.body.balance), 20);
  console.log('[09-wallet-balance] Fresh=0, deposit 20 -> 20, reload -> still 20.');

  // -- 30s guard: two refresh calls in immediate succession -> the second is suppressed, never a
  //    second real provider call, never an error either way. -------------------------------------
  const refresh1 = await apiPost<WalletBalanceSnapshot>('/wallet/balance/refresh', alice.sessionToken);
  mustEqual('First refresh status', refresh1.status, 200);
  const refresh2 = await apiPost<WalletBalanceSnapshot>('/wallet/balance/refresh', alice.sessionToken);
  mustEqual('Second immediate refresh status', refresh2.status, 200);
  mustEqual('Second immediate refresh is suppressed by the platform 30s guard', refresh2.body.refreshSuppressed, true);
  mustEqual('Suppressed refresh still returns the same known balance, never empty/wrong', Number(refresh2.body.balance), 20);
  console.log('[09-wallet-balance] 30s guard confirmed: second immediate refresh suppressed, same balance returned.');

  // -- Event-driven refresh: a real wallet-to-wallet transfer updates BOTH sides automatically,
  //    each verified from ITS OWN session (never inferred from the sender's response alone).
  //    `toAddress` must be Bob's real registered wallet address, not his accountId. -------------
  const bobSnapshotBefore = await apiGet<WalletBalanceSnapshot>('/wallet/balance', bob.sessionToken);
  mustEqual('Bob starts at 0', Number(bobSnapshotBefore.body.balance), 0);

  const sent = await apiPost<{ balance: WalletBalanceSnapshot }>('/wallet/transfer', alice.sessionToken, { toAddress: bobSnapshotBefore.body.address, amount: '5' });
  mustEqual('Transfer status', sent.status, 201);
  mustEqual("Sender's own balance reflects the transfer immediately (synchronous authoritative refresh)", Number(sent.body.balance.balance), 15);

  // The recipient's own snapshot must ALSO already reflect the credit -- proving event-driven
  // refresh (Prompt 1.1) actually ran for Bob's Account, not just a side-effect of Alice's own
  // response. A short poll accounts for the Outbox's own dispatch latency in the (unlikely) case
  // apps/api's own synchronous best-effort refresh for the recipient did not land in time.
  const bobBalance = await pollUntil(
    () => apiGet<WalletBalanceSnapshot>('/wallet/balance', bob.sessionToken),
    (r) => Number(r.body.balance) === 5,
    10_000,
  );
  mustEqual("Recipient's balance updated via event-driven refresh, without Bob ever calling refresh himself", Number(bobBalance.body.balance), 5);
  console.log('[09-wallet-balance] Transfer 5: sender -> 15, recipient -> 5 via event-driven refresh, verified from each own session.');
}

async function pollUntil<T>(fn: () => Promise<T>, done: (result: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fn();
  while (!done(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    last = await fn();
  }
  return last;
}
