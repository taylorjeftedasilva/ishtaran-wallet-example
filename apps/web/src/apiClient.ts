// The ONLY thing apps/web ever talks to -- apps/api's own HTTP surface. Never an Ishtaran API Key
// or Member/AccountHolder JWT here (IMPLEMENTATION_PLAN.md Fase G); only this app's own opaque
// session token, which cannot call anything financial on its own -- apps/api resolves it and acts
// on the user's behalf.
const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:3001';
const SESSION_STORAGE_KEY = 'wallet.sessionToken';
const OWNER_SESSION_STORAGE_KEY = 'wallet.ownerSessionToken';

export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_STORAGE_KEY);
}
export function setSessionToken(token: string): void {
  localStorage.setItem(SESSION_STORAGE_KEY, token);
}
export function clearSessionToken(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function getOwnerSessionToken(): string | null {
  return localStorage.getItem(OWNER_SESSION_STORAGE_KEY);
}
export function setOwnerSessionToken(token: string): void {
  localStorage.setItem(OWNER_SESSION_STORAGE_KEY, token);
}
export function clearOwnerSessionToken(): void {
  localStorage.removeItem(OWNER_SESSION_STORAGE_KEY);
}

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit, tokenOverride?: string | null): Promise<T> {
  const token = tokenOverride !== undefined ? tokenOverride : getSessionToken();
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  // Fastify's default JSON parser rejects a request with content-type: application/json but no
  // body (FST_ERR_CTP_EMPTY_JSON_BODY) -- only set it when there's actually a body to parse.
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('network');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error ?? `Request to ${path} failed with ${res.status}`, body.code);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// -- App config (public) -----------------------------------------------------------------------

export interface AppPublicConfig {
  mode: 'PERSONAL' | 'MONETIZED';
  appName: string;
  paymentRequestEnabled: boolean;
  withdrawalEnabled: boolean;
  environment: 'sandbox' | 'production';
}

export function getAppConfig(): Promise<AppPublicConfig> {
  return request('/config');
}

// -- Auth -----------------------------------------------------------------------------------

export interface SessionResult {
  sessionToken: string;
  userId: string;
  accountId: string;
  email: string;
}

export function signup(email: string, password: string, destinationAddress: string): Promise<SessionResult> {
  return request('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, destinationAddress }) });
}

export function login(email: string, password: string, address?: string): Promise<SessionResult> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, address }) });
}

// -- Wallet balance (Prompt 1/1.1 core capability, integrated Prompt 2) --------------------------
// The wallet's OWN on-chain balance -- read via Ishtaran's official WalletBalance capability
// (apps/api's walletBalanceReader, wrapping `client.walletBalance`). NEVER a local table, NEVER
// the Ishtaran Ledger. This is the number Home shows as "how much USDT does my wallet have" --
// what Send/Pay actually spend.

/** Mirrors apps/api's WalletBalanceSnapshot -- the platform's own freshness/provenance fields, never invented client-side. */
export interface WalletBalanceSnapshot {
  address: string;
  balance: string;
  observedAt: string | null;
  stale: boolean;
  source: string | null;
  refreshSuppressed: boolean;
  refreshFailureReason: string | null;
  nextRefreshAllowedAt: string | null;
}

export interface WalletNetworkBalance {
  assetNetworkId: string;
  networkCode: string;
  balance: string;
  observedAt: string | null;
  stale: boolean;
}

export interface WalletAssetBalance {
  assetId: string;
  assetSymbol: string;
  aggregateBalance: string;
  networkBalances: WalletNetworkBalance[];
}

/** Cheap -- last known snapshot, never a blockchain/RPC call. Safe to call on every mount/foreground-return/30s tick. */
export function getWalletBalance(): Promise<WalletBalanceSnapshot> {
  return request('/wallet/balance');
}

/** Authoritative -- asks Ishtaran to actually check the chain right now, subject to its own 30s freshness/single-flight guard server-side (check `refreshSuppressed` on the result, never an error either way). */
export function refreshWalletBalance(): Promise<WalletBalanceSnapshot> {
  return request('/wallet/balance/refresh', { method: 'POST' });
}

/** Multi-asset/multi-network aggregate (today always exactly one entry -- USDT/TRON -- but the shape is already generic; never hardcode "there is exactly one asset"). */
export function getWalletAssetBalances(): Promise<{ assets: WalletAssetBalance[] }> {
  return request('/wallet/balances');
}

/** "Simular depósito" -- a real external deposit landing at this wallet's own address, recorded by the real Sandbox (never a local counter). Returns the freshly-confirmed snapshot. */
export function simulateDeposit(amount: string): Promise<WalletBalanceSnapshot> {
  return request('/wallet/simulate-deposit', { method: 'POST', body: JSON.stringify({ amount }) });
}

/** "Enviar" -- a direct wallet-to-wallet transfer, entirely distinct from Pagar/Payment (never a Transaction/PaymentIntent/Settlement). Returns the sender's freshly-confirmed snapshot. */
export function transferToAddress(toAddress: string, amount: string): Promise<{ balance: WalletBalanceSnapshot }> {
  return request('/wallet/transfer', { method: 'POST', body: JSON.stringify({ toAddress, amount }) });
}

// -- Ishtaran Ledger / economic position ---------------------------------------------------------
// Ishtaran's own real economic position for this account -- available/pending/reserved/payable/
// reservedForPayout/delivered. A fundamentally different concept from the wallet balance above --
// never summed, never presented as if it were the same number (see Home's "Ishtaran economic
// position" secondary section).

export interface LedgerPosition {
  available: string;
  pending: string;
  reserved: string;
  payable: string;
  reservedForPayout: string;
  delivered: string;
}

export function getLedgerPosition(): Promise<LedgerPosition> {
  return request('/wallet/ledger-position');
}

export type TransactionKind =
  | 'payment_sent'
  | 'payment_received'
  | 'merchant_payment'
  | 'app_revenue'
  | 'withdrawal'
  | 'refund'
  | 'wallet_deposit'
  | 'wallet_transfer_sent'
  | 'wallet_transfer_received';

export interface TransactionViewRow {
  id: string;
  kind: TransactionKind;
  ishtaran_transaction_id: string | null;
  settlement_id: string | null;
  withdrawal_id: string | null;
  refund_id: string | null;
  account_id: string;
  counterparty_label: string | null;
  amount: string;
  app_fee: string | null;
  network_fee: string | null;
  status: string;
  technical_reference: string | null;
  created_at: string;
  updated_at: string;
}

export function getHistory(): Promise<TransactionViewRow[]> {
  return request('/wallet/history');
}

// -- Payments ---------------------------------------------------------------------------------

export interface PaymentCalculation {
  appFeeAmount: string;
  recipientNet: string;
  senderDebit: string;
  mechanism?: string;
}

export interface CreatePaymentResult {
  transactionId: string;
  paymentIntentId: string;
  depositAddress: string;
  amount: string;
  calculation: PaymentCalculation;
}

export function createPayment(recipientAccountId: string, amount: string, event: string): Promise<CreatePaymentResult> {
  return request('/payments', { method: 'POST', body: JSON.stringify({ recipientAccountId, amount, event }) });
}

export function simulateSandboxSend(transactionId: string, depositAddress: string, amount: string): Promise<{ simulated: true }> {
  return request(`/payments/${transactionId}/simulate-sandbox-send`, { method: 'POST', body: JSON.stringify({ depositAddress, amount }) });
}

export interface FinalizeResult {
  transactionId: string;
  settlementId?: string;
  settlementStatus: string;
  pending: boolean;
  grossAmount?: string;
  platformFeeAmount?: string;
  distributableAmount?: string;
  splitAllocations?: { accountId: string; amount: string }[];
  message?: string;
}

export function finalizePayment(transactionId: string): Promise<FinalizeResult> {
  return request(`/payments/${transactionId}/finalize`, { method: 'POST' });
}

// -- Payment requests ---------------------------------------------------------------------------

export type PaymentRequestStatus = 'DRAFT' | 'ACTIVE' | 'PAID' | 'EXPIRED' | 'CANCELLED';

export interface PaymentRequestRow {
  id: string;
  requester_account_id: string;
  requester_user_id: string;
  amount: string;
  description: string;
  status: PaymentRequestStatus;
  transaction_id: string | null;
  created_at: string;
  expires_at: string;
}

export function createPaymentRequest(amount: string, description?: string, expiryMinutes?: number): Promise<PaymentRequestRow> {
  return request('/wallet/payment-requests', { method: 'POST', body: JSON.stringify({ amount, description, expiryMinutes }) });
}

export function listPaymentRequests(): Promise<PaymentRequestRow[]> {
  return request('/wallet/payment-requests');
}

export function getPaymentRequest(id: string): Promise<PaymentRequestRow> {
  return request(`/wallet/payment-requests/${id}`);
}

/** Pure, no side effects -- computes the real fee split without creating any Transaction. Safe to show on a review screen before the payer has confirmed anything. */
export function previewPaymentRequestFees(id: string): Promise<{ calculation: PaymentCalculation }> {
  return request(`/wallet/payment-requests/${id}/preview-fees`);
}

export function payPaymentRequest(id: string): Promise<CreatePaymentResult> {
  return request(`/wallet/payment-requests/${id}/pay`, { method: 'POST' });
}

/** Only while ACTIVE -- purely a local App Database concept until paid, so cancelling is always safe. */
export function cancelPaymentRequest(id: string): Promise<{ id: string; status: 'CANCELLED' }> {
  return request(`/wallet/payment-requests/${id}/cancel`, { method: 'POST' });
}

/** Only for an EXPIRED/CANCELLED request that never became a real payment -- a PAID one can never be removed here. */
export function deletePaymentRequest(id: string): Promise<void> {
  return request(`/wallet/payment-requests/${id}`, { method: 'DELETE' });
}

// -- Withdrawals --------------------------------------------------------------------------------

export interface WithdrawalQuote {
  requestedAmount: string;
  estimatedRecipientAmount: string;
  networkExecutionCost: string;
}

export function createWithdrawalDestination(address: string): Promise<{ withdrawalDestinationId: string }> {
  return request('/wallet/withdrawal-destinations', { method: 'POST', body: JSON.stringify({ address }) });
}

export function getWithdrawalQuote(withdrawalDestinationId: string, amount: string): Promise<WithdrawalQuote> {
  return request(`/wallet/withdrawal-quote?withdrawalDestinationId=${encodeURIComponent(withdrawalDestinationId)}&amount=${encodeURIComponent(amount)}`);
}

export function requestWithdrawal(withdrawalDestinationId: string, amount: string): Promise<{ withdrawalId: string; status: { name: string } }> {
  return request('/wallet/withdrawals', { method: 'POST', body: JSON.stringify({ withdrawalDestinationId, amount }) });
}

// -- Owner / Revenue (MONETIZED mode, separate credential) ----------------------------------------

export function ownerLogin(token: string): Promise<{ sessionToken: string }> {
  return request('/owner/login', { method: 'POST', body: JSON.stringify({ token }) });
}

export interface RevenueBalance {
  available: string;
  pending: string;
  reserved: string;
  delivered: string;
}

/** `ownerSessionToken` is the token `ownerLogin()` returned -- never the raw owner token itself. */
export function getRevenueBalance(ownerSessionToken: string): Promise<RevenueBalance> {
  return request('/owner/revenue-balance', undefined, ownerSessionToken);
}

/** The App Owner's real wallet -- its registered self-custody address and actual on-chain balance, via the official WalletBalance capability. A different question from getRevenueBalance above, never summed with it. */
export function getOwnerWalletBalance(ownerSessionToken: string): Promise<WalletBalanceSnapshot> {
  return request('/owner/wallet-balance', undefined, ownerSessionToken);
}

export interface RevenueEventRow {
  id: string;
  transaction_id: string;
  settlement_id: string | null;
  rule_event: string;
  amount: string;
  app_revenue_account_id: string;
  created_at: string;
}

export function getRevenueHistory(ownerSessionToken: string): Promise<RevenueEventRow[]> {
  return request('/owner/revenue-history', undefined, ownerSessionToken);
}

export interface RevenueAnalytics {
  byEvent: { rule_event: string; count: number; totalRevenue: number }[];
  totalPayments: number;
}

export function getRevenueAnalytics(ownerSessionToken: string): Promise<RevenueAnalytics> {
  return request('/owner/analytics', undefined, ownerSessionToken);
}
