// Named-operation wrapper over @ishtaran/sdk -- the app backend's ONLY door into Ishtaran
// (PRODUCT_SPEC.md Auth model: an AccountHolder session can never call a financial route
// directly, GAPS.md F.10, IMPLEMENTATION_PLAN.md Fase A1/G). Every function here is a thin,
// named pass-through to one real SDK call (or, for `completePayment`, the documented
// Reserve+Settle+SelfCustody-completion sequence) -- nothing invents a platform capability, and
// nothing here decides product policy (fee amounts, who pays what) -- that's `@wallet-app/revenue`.
import type { IshtaranClient, ParticipantInput } from '@ishtaran/sdk';
import { createClient } from './client.js';
import { completeSelfCustodySettlement, type ExecutionSigner } from './selfCustody.js';

// -- Member session (GAPS.md F.9 -- AuthorizeAccountForApplication rejects the API Key) ---------

export interface MemberRefreshTokenStore {
  get(): string;
  /** Called with the freshly rotated refreshToken immediately after a successful refresh --
   * `POST /v1/auth/refresh` rotates the token on every use (confirmed live: reusing a token
   * already spent this way is rejected 401), so the caller MUST persist this before the next call. */
  set(refreshToken: string): void | Promise<void>;
}

/**
 * A handful of real Ishtaran operations only accept a Member JWT, never the Application API
 * Key (F.9). apps/api is a long-running process, so it never caches a short-lived Member access
 * token -- it re-derives a fresh one from the Organization Owner's refresh token (captured once
 * by scripts/setup.ts) on every call that needs it, immediately persisting the rotated token via
 * `tokenStore` so the next call doesn't try to reuse an already-spent one.
 */
export async function withMemberSession<T>(tokenStore: MemberRefreshTokenStore, fn: (owner: IshtaranClient) => Promise<T>): Promise<T> {
  const owner = createClient();
  const refreshed = await owner.auth.refresh(tokenStore.get());
  if (!refreshed.success) {
    throw new Error(`Failed to refresh the Member session (errorCode=${refreshed.errorCode}) -- re-run "npm run setup".`);
  }
  if (refreshed.refreshToken) {
    await tokenStore.set(refreshed.refreshToken);
  }
  return fn(owner);
}

// -- AccountHolder identity (end-user signup/login; never used for financial routes) -----------

export function signUpAccountHolder(accountHolder: IshtaranClient, email: string, password: string) {
  return accountHolder.accountHolders.signUp(email, password);
}

export function loginAccountHolder(accountHolder: IshtaranClient, email: string, password: string) {
  return accountHolder.accountHolders.login(email, password);
}

export function getAccountHolderMe(accountHolder: IshtaranClient) {
  return accountHolder.accountHolders.me();
}

export function signUpAndClaimAccountHolderInvitation(
  accountHolder: IshtaranClient,
  plainTextToken: string,
  email: string,
  password: string,
) {
  return accountHolder.accountHolders.signUpAndClaimInvitation(plainTextToken, email, password);
}

export function claimAccountHolderInvitation(accountHolder: IshtaranClient, plainTextToken: string) {
  return accountHolder.accountHolders.claimInvitation(plainTextToken);
}

// -- Account provisioning (Member/API-Key client, never the AccountHolder session) --------------

export function createAccountHolderInvitation(app: IshtaranClient, organizationId: string, externalId?: string) {
  return app.accounts.createAccountHolderInvitation(organizationId, externalId);
}

/** Member-JWT-only today (GAPS.md F.9) -- must be called with a Member session client, not the API Key client. */
export function authorizeAccountForApplication(
  owner: IshtaranClient,
  organizationId: string,
  accountId: string,
  applicationId: string,
) {
  return owner.accounts.authorizeApplication(organizationId, accountId, applicationId);
}

// -- Execution infrastructure (one-time App-level bootstrap, CUSTODY-EXECUTION-MODES.md Part 3) -

/** Every beneficiary Account needs one of these registered before a Settlement can ever pay it
 * (the backend fails fast, pre-Signing, if none exists) -- Section 3bis's ExecutionDestination. */
export function registerExecutionDestination(app: IshtaranClient, organizationId: string, accountId: string, assetNetworkId: string, address: string) {
  return app.executionDestinations.register(organizationId, accountId, assetNetworkId, address);
}

/** Required once per (organizationId, assetNetworkId) before the first SelfCustody Settlement/Withdrawal on it. */
export function registerNetworkCostPayerAccount(app: IshtaranClient, organizationId: string, assetNetworkId: string, accountId: string) {
  return app.networkCostPayerAccounts.register(organizationId, assetNetworkId, accountId);
}

export function allocateDepositAddress(app: IshtaranClient, applicationId: string, networkId: string) {
  return app.wallets.allocateDepositAddress(applicationId, networkId);
}

/** Required, together with a NetworkCostPayerAccount, before the first SelfCustody Withdrawal on
 * an AssetNetwork (CUSTODY-EXECUTION-MODES.md Part 3bis) -- the pooled origin Withdrawals sign
 * from, first-registration-wins per (organizationId, environmentId, assetNetworkId). */
export function registerExecutionSource(
  app: IshtaranClient,
  organizationId: string,
  environmentId: string,
  assetNetworkId: string,
  walletId: string,
  derivationReference: number,
  address: string | null,
) {
  return app.executionSources.register(organizationId, environmentId, assetNetworkId, walletId, derivationReference, address);
}

// -- Balance (read-only) --------------------------------------------------------------------------

export function getAccountBalance(app: IshtaranClient, accountId: string, assetNetworkId: string) {
  return app.ledger.getBalance(accountId, assetNetworkId);
}

export function listLedgerEntries(
  app: IshtaranClient,
  accountId: string,
  assetNetworkId: string,
  options: { skip: number; take: number },
) {
  return app.ledger.listEntries(accountId, assetNetworkId, options);
}

// -- Payment (P2P / Merchant / Payment Request -- all real CreateTransaction + Reserve + Settle) -

export interface CreatePaymentTransactionInput {
  organizationId: string;
  applicationId: string;
  environmentId: string;
  assetNetworkId: string;
  /** The real Transaction.amount -- already fee-adjusted by @wallet-app/revenue when the rule is
   * SENDER-payer (extra on top); unchanged when RECEIVER-payer (absorbed) or fee-free. */
  amount: string;
  participants: ParticipantInput[];
  idempotencyKey?: string;
}

export function createPaymentTransaction(app: IshtaranClient, input: CreatePaymentTransactionInput) {
  return app.transactions.create(
    input.organizationId,
    input.applicationId,
    input.environmentId,
    null,
    input.assetNetworkId,
    input.amount,
    input.participants,
    input.idempotencyKey,
  );
}

export function reserveTransaction(app: IshtaranClient, transactionId: string) {
  return app.transactions.reserve(transactionId);
}

export function getTransaction(app: IshtaranClient, transactionId: string) {
  return app.transactions.get(transactionId);
}

export function getTransactionState(app: IshtaranClient, transactionId: string) {
  return app.transactions.getState(transactionId);
}

/**
 * Reserve is assumed already done (immediately after `createPaymentTransaction`, per
 * IMPLEMENTATION_PLAN.md Fase I) -- this settles the full reserved amount and, when the
 * Settlement has anything to execute on-chain, drives the real SelfCustody signing protocol to
 * completion before returning. Never call this without a real `signer` for the Application's
 * registered execution wallet -- there is no other way to authorize the on-chain leg.
 */
export async function executeSettlementAndComplete(
  app: IshtaranClient,
  environmentId: string,
  transactionId: string,
  signer: ExecutionSigner,
  idempotencyKey?: string,
) {
  const { settlementId } = await app.settlements.executeSettlement(transactionId, undefined, idempotencyKey);
  return completeSelfCustodySettlement(app, environmentId, settlementId, signer);
}

export function getSettlement(app: IshtaranClient, settlementId: string) {
  return app.settlements.get(settlementId);
}

// -- Funding (deposit) -- real "Add funds" primitive, never Sandbox-only -------------------------

/**
 * A real on-chain top-up: a Transaction whose only real party is the funder (payer), plus a
 * harmless placeholder beneficiary -- this Transaction only exists to give `CreatePaymentIntent`
 * something to attach to, its own Settlement is never intended to run.
 *
 * IMPORTANT, confirmed live (never assumed): once a confirmed deposit brings this Transaction's
 * payer to >= this Transaction's own declared `amount`, the platform auto-reserves it -- WITHOUT
 * an explicit `ReserveTransactionBalance` call, synchronously if the balance was already
 * sufficient at creation, or asynchronously (a few seconds later) once a pending deposit confirms.
 * That auto-reserve locks funds up to `amount`, not "whatever is Available" -- so pass an `amount`
 * SMALLER than the real deposit you intend to make (matches `examples/marketplace-mercatto`'s own
 * `fundAccountViaOverfundedDeposit`, which calls this exact pattern "overfunding"): the surplus
 * (`createPaymentIntent`'s own `amount` minus this `amount`) is what actually stays spendable in
 * Available. Passing the SAME value for both locks 100% of the deposit away as unusable Reserved
 * balance against a Transaction nobody will ever Settle -- a real mistake this project's own
 * Slice 4 validation hit and fixed, not a hypothetical.
 */
export async function createFundingTransaction(
  app: IshtaranClient,
  input: {
    organizationId: string;
    applicationId: string;
    environmentId: string;
    assetNetworkId: string;
    funderAccountId: string;
    placeholderBeneficiaryAccountId: string;
    amount: string;
    idempotencyKey?: string;
  },
) {
  const participants: ParticipantInput[] = [
    { accountId: input.funderAccountId, role: 'funder', isPayer: true },
    { accountId: input.placeholderBeneficiaryAccountId, role: 'unused-placeholder', isPayer: false, splitPercentage: '100' },
  ];
  return app.transactions.create(
    input.organizationId,
    input.applicationId,
    input.environmentId,
    null,
    input.assetNetworkId,
    input.amount,
    participants,
    input.idempotencyKey,
  );
}

export function createPaymentIntent(
  app: IshtaranClient,
  organizationId: string,
  transactionId: string,
  assetNetworkId: string,
  amount: string,
  idempotencyKey?: string,
) {
  return app.deposits.createPaymentIntent(organizationId, transactionId, assetNetworkId, amount, undefined, idempotencyKey);
}

export function getPaymentIntent(app: IshtaranClient, paymentIntentId: string) {
  return app.deposits.getPaymentIntent(paymentIntentId);
}

// -- Refund (pre-Settlement only -- GAPS.md F.2: no clawback after a full Settlement) -----------

export function executeRefund(app: IshtaranClient, transactionId: string, reason?: string, idempotencyKey?: string) {
  return app.refunds.executeRefund(transactionId, undefined, reason, idempotencyKey);
}

// -- Withdrawal (real cooldowns respected -- never bypassed) -------------------------------------

export function getWithdrawalQuote(
  app: IshtaranClient,
  organizationId: string,
  environmentId: string,
  accountId: string,
  withdrawalDestinationId: string,
  assetNetworkId: string,
  amount: string,
) {
  return app.withdrawals.quote(organizationId, environmentId, accountId, withdrawalDestinationId, assetNetworkId, amount);
}

export function createWithdrawalDestination(app: IshtaranClient, organizationId: string, address: string, assetNetworkId: string) {
  return app.withdrawals.createDestination(organizationId, address, assetNetworkId);
}

export function requestWithdrawal(
  app: IshtaranClient,
  organizationId: string,
  environmentId: string,
  accountId: string,
  withdrawalDestinationId: string,
  assetNetworkId: string,
  amount: string,
  idempotencyKey?: string,
) {
  return app.withdrawals.request(organizationId, environmentId, accountId, withdrawalDestinationId, assetNetworkId, amount, idempotencyKey);
}

export function getWithdrawal(app: IshtaranClient, withdrawalId: string) {
  return app.withdrawals.get(withdrawalId);
}

export function listWithdrawals(app: IshtaranClient, organizationId: string) {
  return app.withdrawals.list(organizationId);
}
