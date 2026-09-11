// Shared helpers for the Wallet's 8 canonical E2E scenarios (IMPLEMENTATION_PLAN.md Fase N).
// Every scenario drives apps/api's real HTTP surface (never the SDK directly, unlike Mercatto's
// own scenarios) -- this suite tests the FULL real stack, not just Ishtaran. Prerequisite: a real
// Sandbox bootstrap (`npm run setup`) and `WALLET_APP_MODE=MONETIZED npm run dev:api` already
// running (Fase O -- apps/api is out of process, this runner never starts it itself).
import { readFileSync } from 'node:fs';
import { createClient, deriveTronAddress, wallet, type IshtaranClient } from '@wallet-app/ishtaran-client';

export const API_BASE = process.env.WALLET_API_BASE ?? 'http://127.0.0.1:3001';
const BOOTSTRAP_PATH = new URL('../../config/.sandbox-bootstrap.json', import.meta.url);

export interface Bootstrap {
  organizationId: string;
  environmentId: string;
  apiKey: string;
  assetNetworkId: string;
  appRevenueAccountId: string;
  webhookSecret: string;
}

export const bootstrap: Bootstrap = JSON.parse(readFileSync(BOOTSTRAP_PATH, 'utf8'));
export const appClient: IshtaranClient = createClient(bootstrap.apiKey);

export function must(condition: boolean, label: string): void {
  if (!condition) throw new Error(`assertion failed -- ${label}`);
}

export function mustEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`assertion failed -- ${label}: expected ${expected}, got ${actual}`);
}

export interface Session {
  sessionToken: string;
  accountId: string;
  email: string;
}

export async function signup(emailPrefix: string): Promise<Session> {
  const runId = Date.now();
  const email = `${emailPrefix}-${runId}@example.com`;
  const generated = wallet.generate();
  const destinationAddress = deriveTronAddress(generated.wallet.accountExtendedPublicKey, 0);
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Str0ngP@ssw0rd!123', destinationAddress }),
  });
  if (!res.ok) throw new Error(`signup(${email}) failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { sessionToken: string; accountId: string };
  return { ...body, email };
}

export interface CreatePaymentResult {
  transactionId: string;
  paymentIntentId: string;
  depositAddress: string;
  amount: string;
  calculation: {
    appFeeAmount: string;
    recipientNet: string;
    senderDebit: string;
    mechanism: string;
    allocations?: { role: string; splitPercentage: string }[];
  };
}

export interface FinalizeResult {
  transactionId: string;
  settlementId?: string;
  settlementStatus: string;
  splitAllocations?: { accountId: string; amount: string }[];
  pending?: boolean;
}

export async function apiPost<T>(path: string, sessionToken: string, body?: unknown): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { authorization: `Bearer ${sessionToken}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as T };
}

export async function apiGet<T>(path: string, sessionToken: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${sessionToken}` } });
  return { status: res.status, body: (await res.json()) as T };
}

/**
 * Every scenario that calls this expects a real, successful Payment creation (201) -- even
 * scenario 06 ("failure-unfunded-payment"), whose actual failure subject is a later step
 * (finalize on an unconfirmed deposit), never payment creation itself. Throws with the real
 * response body on any other status -- found live 2026-09-11: `apiPost` returning `{status,
 * body}` unconditionally meant a genuine backend rejection (e.g. `422
 * ORGANIZATION_SETTLEMENT_RESTRICTED`) silently reached call sites as `created.body.calculation
 * === undefined`, crashing on `.appFeeAmount` with a message that pointed nowhere near the real
 * cause.
 */
export async function createPayment(sessionToken: string, recipientAccountId: string, amount: string, event: string): Promise<{ status: number; body: CreatePaymentResult }> {
  const result = await apiPost<CreatePaymentResult>('/payments', sessionToken, { recipientAccountId, amount, event });
  if (result.status !== 201) {
    throw new Error(`createPayment(amount=${amount}, event=${event}) failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result;
}

/**
 * GAPS.md G.8 -- every wallet starts at 0 USDT, backed by the real Sandbox SandboxWalletBalance
 * capability (never a local table). Every scenario that sends a payment must explicitly fund the
 * sender first, the same real action a real user takes via Settings > Sandbox Tools > "Simular
 * depósito" -- never bypassed, never auto-granted at signup (that would silently defeat the whole
 * point of this gate in the one place meant to prove it works).
 */
export async function depositDemoFunds(sessionToken: string, amount: string): Promise<void> {
  const res = await apiPost<{ balance: string }>('/wallet/simulate-deposit', sessionToken, { amount });
  must(res.status === 201, `depositDemoFunds(${amount}) failed: ${JSON.stringify(res.body)}`);
}

/** CREATED -> AWAITING_FUNDS -> FUNDED -> RESERVED are real, distinct, non-instantaneous
 * transitions (confirmed live, matches examples/marketplace-mercatto/pay-order.ts's own comment:
 * "a confirmed deposit does not always reach RESERVED in the same tick"). Scenarios that need to
 * act on a Transaction while it's still RESERVED (e.g. a pre-Settlement refund) must wait for
 * this explicitly rather than assuming simulateSandboxSend's response means it already arrived. */
export async function waitForReserved(transactionId: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let state = await appClient.transactions.getState(transactionId);
  while (state.status.name !== 'RESERVED' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    state = await appClient.transactions.getState(transactionId);
  }
  must(state.status.name === 'RESERVED', `Transaction ${transactionId} did not reach RESERVED within ${timeoutMs}ms (last status=${state.status.name})`);
}

/** Sandbox-only, proxied through apps/api (never a direct Sandbox call from this "client" role in
 * a real deployment) -- stands in for "the sender's own wallet broadcast a real on-chain
 * transfer" (GAPS.md, no real Tron adapter exists yet). */
export async function simulateSandboxSendAndFinalize(sessionToken: string, payment: CreatePaymentResult): Promise<FinalizeResult> {
  const sim = await apiPost('/payments/' + payment.transactionId + '/simulate-sandbox-send', sessionToken, {
    depositAddress: payment.depositAddress,
    amount: payment.amount,
  });
  must(sim.status === 200, `simulate-sandbox-send failed: ${JSON.stringify(sim.body)}`);
  const finalize = await apiPost<FinalizeResult>(`/payments/${payment.transactionId}/finalize`, sessionToken);
  return finalize.body;
}
