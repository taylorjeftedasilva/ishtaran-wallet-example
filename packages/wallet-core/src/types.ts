// Shared domain types -- the App Database's own read-model records (PRODUCT_SPEC.md §20).
// Never the economic source of truth: every balance/state figure a real user sees must trace
// back to a live Ishtaran aggregate read, these are projections/UI conveniences only.

export interface AppUser {
  id: string;
  email: string;
  accountHolderId: string;
  /** The one real, global Ishtaran Account this person has (IMPLEMENTATION_PLAN.md Fase A1 --
   * AccountHolder resolves to a single, Organization-independent accountId). */
  accountId: string;
  createdAt: string;
}

export type PaymentRequestStatus = 'DRAFT' | 'ACTIVE' | 'PAID' | 'EXPIRED' | 'CANCELLED';

export interface PaymentRequest {
  id: string;
  requesterAccountId: string;
  requesterUserId: string;
  amount: string;
  description: string;
  status: PaymentRequestStatus;
  /** Set once a payer has acted on this request. */
  transactionId?: string;
  createdAt: string;
  expiresAt: string;
}

export type PaymentViewState =
  | 'CREATED'
  | 'RESERVED'
  | 'SIGNING'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RECONCILIATION';

export interface RevenueEventRecord {
  id: string;
  transactionId: string;
  settlementId?: string;
  ruleEvent: string;
  amount: string;
  appRevenueAccountId: string;
  createdAt: string;
}

export type TransactionKind = 'payment_sent' | 'payment_received' | 'merchant_payment' | 'app_revenue' | 'withdrawal' | 'refund';

export interface TransactionView {
  id: string;
  kind: TransactionKind;
  ishtaranTransactionId: string;
  settlementId?: string;
  withdrawalId?: string;
  refundId?: string;
  accountId: string;
  counterpartyLabel?: string;
  amount: string;
  appFee?: string;
  networkFee?: string;
  status: PaymentViewState | 'REFUNDED';
  technicalReference?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryState {
  deliveryId: string;
  processedAt: string;
}
