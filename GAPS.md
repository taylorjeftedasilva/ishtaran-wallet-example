# Wallet / Payment App -- known platform gaps

Same audit convention as `examples/marketplace-mercatto/GAPS.md`: **BUG** / **CONTRACT GAP** /
**DOMAIN GAP** / **DX GAP** / **EXPECTED BEHAVIOR** / **FUTURE CAPABILITY**. Each entry is a real,
confirmed-in-code (or confirmed live against Sandbox) finding, never worked around with a fake
helper or a bypass -- a gap is documented, never invented away.

## G.1 -- A Transaction can only be Settled under SelfCustody if it has its OWN confirmed PaymentIntent -- **DOMAIN GAP, product-shaping**

**Confirmed live** (Slice 3/4 validation, `tests/integration/validate-slice4.ts`, 2026-09-10):
funded Alice's Account via a real confirmed deposit (a *different*, throwaway Transaction, per
the "overfunded deposit" pattern `examples/marketplace-mercatto` already uses for test fixtures).
Alice's Ledger `Available` balance genuinely increased. Created a brand-new P2P Transaction
(Alice -> Bob, `amount=50`), which the platform auto-reserved synchronously (she already had
enough `Available`). Calling `ExecuteSettlement` on it failed:

```
422 SETTLEMENT_NO_CONFIRMED_FUNDING_SOURCE
"Settlement '...': nenhuma origem de funding confirmada encontrada para a Transaction '...' --
impossível montar uma SigningRequest real sob SelfCustody."
```

**Confirmed in source** (`src/Modules/Settlement/Settlement.Application/ExecutionStrategies/
SelfCustodySettlementExecutionStrategy.cs:91-95` and `src/Modules/Deposits/Deposits.Application/
Queries/GetSelfCustodyFundingSourcesQueryHandler.cs:19-30`): resolving *where* to sign a
Settlement's on-chain legs from is done by
`paymentIntentRepository.GetByTransactionIdAsync(transaction.TransactionId)` -- it looks up
**PaymentIntents belonging to that exact Transaction**, sums their `Confirmed` deposits, and uses
those as the SigningRequest's origin address(es). It never consults the payer Account's aggregate
Ledger balance or any other Transaction's deposit history. If the Transaction being settled was
never funded by a PaymentIntent of its own -- e.g. its payer already had sufficient `Available`
balance from an earlier, unrelated deposit, and simply auto-reserved against that -- the query
returns zero sources and `ExecuteSettlement` fails closed, every time, unconditionally. This is
not a timing/propagation issue and not something a longer wait or a retry fixes.

**What this means, stated plainly**: under the platform's real, current SelfCustody execution
model, there is no "spend from a previously-deposited, freely re-spendable stored balance" for a
*new* Transaction. Every Transaction that will actually be Settled on-chain must be funded by ITS
OWN `CreatePaymentIntent` + confirmed deposit. `examples/marketplace-mercatto` never demonstrates
otherwise: its `fundAccountViaOverfundedDeposit`/`self-funding` helper is used exclusively to
raise an Account's `Available` balance for **Ledger-only balance checks that never require a
Settlement** (`NetworkCostPayerAccount` sufficiency; F.18's own doc comment says outright "this
Transaction is deliberately never released/settled"). No Mercatto scenario ever pays a buyer's
order out of a balance left over from an earlier, different Transaction -- `pay-order.ts` always
opens a fresh `PaymentIntent` tied to the exact order Transaction being settled.

**Direct consequence for `PRODUCT_SPEC.md`/`IMPLEMENTATION_PLAN.md`**: Fase I flow 1 ("P2P payment
(existing balance): ... `CreateTransaction` -> `ReserveTransactionBalance` -> `ExecuteSettlement`")
and flow 2 (merchant payment, same shape) as currently specified **cannot be executed against real
Sandbox** the moment the sender's balance did not arrive via a PaymentIntent tied to that specific
payment Transaction. This is not a RevenueEngine calculation bug -- `@wallet-app/revenue` was
never reached; the platform rejects the Settlement before any split/fee math runs. Every fee
formula and split-precision case in `packages/revenue` remains independently correct and unit-
tested; what's wrong is the *transaction-funding* assumption underneath the payment flow, not the
revenue math on top of it.

**Not fixed here, not worked around**: no backend/SDK/contract change was made or considered (out
of scope per the ABSOLUTE RULES). No fake balance-pooling shim was added to the wallet's own code.
This is structural, real, current platform behavior -- not a bug in this reference project, and
not fixable by writing different application code against the same platform version.

**Addendum, found live building Slice 9's E2E battery (`e2e/wallet/08-refund.ts`)**: a refund
credits the payer's real Ledger `Available` balance via `EntryNature.Available` (the normal
Refund path, not `Delivered`). If the payer then creates a NEW payment while that balance is
already sufficient, `CreateTransaction` auto-reserves it synchronously (`BR-TXN-002`) before a
`PaymentIntent` is ever attached -- and `CreatePaymentIntent` on an already-`Reserved` Transaction
is correctly rejected (`TRANSACTION_NOT_ELIGIBLE_FOR_FUNDING`). Per this same G.1 finding, a
Transaction with no `PaymentIntent` of its own can never be Settled either -- so a refund's
credited balance is a genuine dead end for the normal payment flow, not just for a stored-balance
"instant send." `apps/api/src/routes/payments.ts`'s `createPayment` checks the Transaction's real
state immediately after creation and fails fast with `PAYMENT_AUTO_RESERVED_FROM_EXISTING_BALANCE`
(409) instead of chaining into that confusing rejection. Product consequence: refunded balance can
only be moved via Withdrawal in V1 (a real, working pooled-balance mechanism via `ExecutionSource`
-- unaffected by this finding), never respent in-app.

**Owner decision (2026-09-10)**: redesign every payment flow (P2P, Merchant, Payment Request) to
always fund itself via a fresh `CreatePaymentIntent` at send time -- the sender's own self-custody
wallet broadcasts a real on-chain transfer to the returned deposit address for THAT specific
payment Transaction, every time. There is no "instant send from a pre-existing stored balance" in
V1. The Balance screen becomes a real, historical Ledger view (received/spent), never a "tap to
instantly resend" pool. `PRODUCT_SPEC.md` and `IMPLEMENTATION_PLAN.md` are updated accordingly
(see their own revision notes, dated 2026-09-10, citing this entry).

**Carried forward to Slice 6 (Withdrawal), not yet resolved**: `PRODUCT_SPEC.md` Section 13's
Withdrawal App Fee composition has the exact same underlying constraint -- it wants to move money
the user *already has* into the App Revenue Account before withdrawing the remainder, but per this
same finding, a Transaction only produces a real Settlement-usable funding source via its own
`PaymentIntent`. Whether a fee-collection Settlement can execute here without asking the user to
fund it a second time is a real, empirically-unverified open question -- needs its own live
Sandbox check before Withdrawal App Fee is implemented, not assumed solved by extrapolation from
this entry.

## G.2 -- TypeScript SDK's `GetAccountBalance` silently drops `delivered`/`payable`/`reservedForPayout` -- **CONTRACT GAP (SDK), not a backend gap, not a bug in this example**

**Confirmed live** (Slice 4 reconciliation, 2026-09-10): Bob's real Ledger `available` balance
showed a `0.000000` delta immediately after a Settlement that, per `settlement.splitAllocations`,
genuinely paid him `49.55`/`98.4063` USDT (both amounts matching `@wallet-app/revenue`'s
calculation exactly). Pulled his raw `ledger.listEntries(...)` directly: both credits are real,
dated exactly at Settlement completion, with `nature: { name: "UNKNOWN", rawValue: 3 }`.

**Confirmed in real backend source** (`src/Modules/Ledger/Ledger.Domain/Enums/EntryNature.cs`):
`rawValue: 3` is `EntryNature.Delivered` (`DEC-040`, 2026-08-30) -- "entitlement já entregue
fisicamente on-chain... estruturalmente inerte a Reserve/Release/Withdrawal, nunca tratado como
saldo sacável." The TypeScript SDK's own `EntryNature` enum
(`sdks/typescript/src/model/enums.ts:33`) only defines `AVAILABLE/PENDING/RESERVED` -- it was
never updated for `Delivered`/`Payable`/`ReservedForPayout` (`SPEC-024/025`), so any of those
natures always render as `{name: 'UNKNOWN', rawValue: N}` via the SDK's own graceful-degradation
path, never a crash, but also never identifiable by name.

**Confirmed the real HTTP contract already carries this** (`src/Modules/Ledger/Ledger.Contracts/
Responses/BalanceResponse.cs`): `GetAccountBalance`'s real response has included `payable`,
`reservedForPayout`, and `delivered` (all additive, defaulted `0m`) since the same 2026-08-30
change. The TypeScript SDK's `mapBalanceResponse`
(`sdks/typescript/src/model/dataPlane.ts:138-144`) only ever reads `available`/`pending`/
`reserved` off that same JSON body -- it silently discards the other three fields the backend is
already sending. **This is an SDK mapping gap, not a backend gap** -- the real API was already
fixed; the SDK's typed model just never caught up.

**Direct consequence, stated plainly**: under SelfCustody, once a Settlement beneficiary has a
registered `ExecutionDestination`, their payout is delivered directly to *their own* external
on-chain address -- it is credited as `Delivered`, which `GetAccountBalance`'s typed SDK response
(`available`/`pending`/`reserved`) can **never** show, by design (`Delivered` is deliberately
"never read by any balance Handler to decide spendable balance"). A Wallet screen that shows only
`ledger.getBalance().available` will show `0` for every P2P/merchant payment a user has ever
received -- not because the money isn't real, but because the SDK convenience method structurally
cannot see it.

**Not fixed in the SDK** (out of scope per the ABSOLUTE RULES -- `sdks/typescript` is never
altered). Worked around entirely in `packages/ishtaran-client/src/fullBalance.ts`: an explicit,
clearly-commented raw HTTP call to the exact same real endpoint the SDK's own
`LedgerResource.getBalance` calls (`GET /v1/accounts/{accountId}/balance`, `X-Api-Key` header,
confirmed against `authenticatingTransport.ts`), parsing all six real response fields instead of
three. This is a workaround for a confirmed SDK contract-mapping bug, not a platform limitation --
flagged here so it is never mistaken for one, and so the SDK's own maintainers have a precise,
cited repro if `sdks/typescript`'s `EntryNature`/`mapBalanceResponse` are ever revisited.

**Owner decision (2026-09-10), formally recorded**: registered as a real SDK gap --
`sdks/typescript`'s `GetAccountBalance` mapper (`mapBalanceResponse`,
`sdks/typescript/src/model/dataPlane.ts:138-144`) drops `delivered`/`payable`/`reservedForPayout`
even though the real HTTP response already includes them (`Ledger.Contracts.Responses.
BalanceResponse.cs`, since 2026-08-30). **The SDK itself is not touched on this front** -- per the
ABSOLUTE RULES, no fix lands in `sdks/typescript` as part of the Wallet reference project. The
local workaround in `packages/ishtaran-client/src/fullBalance.ts` is **approved as a temporary
solution** and must stay clearly documented as one everywhere it's used (`apps/api/src/routes/
balance.ts`, `tests/integration/validate-slice4.ts`) -- never presented as if it were the SDK's
own supported surface.

## G.3 -- `WebhookEndpoints.create` rejects private/loopback/link-local URLs -- **EXPECTED BEHAVIOR (real SSRF protection), local-dev consequence documented**

**Confirmed live** (Slice 7, 2026-09-10): `scripts/setup.ts` first attempted a real
`webhookEndpoints.create(organizationId, 'http://127.0.0.1:3001/webhooks/ishtaran')` (Member-JWT,
matching Mercatto's own registration convention). Rejected outright:

```
400 VALIDATION_ERROR -- "Url não pode resolver para um endereço IP privado/loopback/link-local."
```

This is real, correct platform behavior (SSRF protection on a Member-supplied webhook URL), not a
bug -- registered here only because it has a real, unavoidable consequence for **local development
of any Ishtaran integrator**, not just this reference project: a webhook endpoint can never be
registered against `localhost`/a private IP, so no real Ishtaran-issued secret and no real
delivery are obtainable without a public URL (an `ngrok`-style tunnel or a real deployment).

**Not worked around by weakening any check** -- `scripts/setup.ts` only attempts real registration
when `WALLET_WEBHOOK_URL` is explicitly set to a real public URL (empty by default in local dev).
Otherwise it falls back to a **locally generated, clearly-labeled test-only secret**
(`crypto.randomBytes(32)`, never claimed to be Ishtaran-issued), sufficient to exercise the
receiver's real signature-verification logic (`apps/api/src/routes/webhooks.ts`, using the SDK's
own real `verifyWebhookSignature`/`computeWebhookSignature` -- the identical algorithm a real
delivery would use) end-to-end in `tests/integration/validate-slice6-8.ts`, without ever
pretending a real delivery was received.

**Carried forward**: whether `Withdrawal`'s own `ExecutionSource` (a genuinely POOLED,
per-Organization/Environment/AssetNetwork origin, *not* scoped to one Transaction --
`CUSTODY-EXECUTION-MODES.md` Part 3bis) offers a usable path for the App Owner's own revenue
withdrawal (Fase I flow 7) is unaffected by this finding -- `ExecutionSource` is a real, separate,
already-working mechanism for Withdrawals specifically, never consulted by Settlement.

## G.4 -- Mercatto's own real E2E fails cold against public Sandbox (`marketplace-mercatto`'s own gap, found during Prompt 4 shared-RC validation, NOT a Wallet issue) -- **cross-referenced only, never fixed here**

**Confirmed live, 2026-09-10, `npm run e2e:marketplace`** (`e2e/run-shared.ts`, this project's own
shared-RC orchestrator -- never modifies `examples/marketplace-mercatto` itself): running
Mercatto's real `npm run test:happy-path` and `npm run test:scenarios` fresh against the real
public Sandbox (the zero-config default `examples/marketplace-mercatto/README.md` documents) hits
the same real `NETWORK_EXECUTION_FEE_INSUFFICIENT_BALANCE` condition this project's own `GAPS.md`
already found and fixed for itself (`scripts/setup.ts`'s funding step) -- 5 of 12
`test:scenarios` cases and the full `test:happy-path` release gate fail on it; a 6th
(`payout-batch-manual`) separately fails on a missing `MERCATTO_PLATFORM_OWNER_API_KEY`.

**This is Mercatto's own, pre-existing, already-documented gap, not a Wallet-caused regression** --
confirmed by `git status`/`git diff` showing **zero** changes to `examples/marketplace-mercatto`,
`sdks/`, or `src/` anywhere in this session. Mercatto's own `README.md` already states the real
prerequisite plainly: a cold run needs either the local `tools/e2e-environment` stack ("what CI
uses") or additional Platform-Owner bootstrap (a Global PricingPolicy, a
`NetworkResourceReserve`/`TronResourceCostTable` step, explicitly called out as "not yet built" for
`mercatto-e2e`'s first real CI run) -- neither of which this session has credentials/infra to
provide (`tools/e2e-environment`'s own README additionally documents a real topology
incompatibility with Mercatto's migrations, unresolved, out of scope here). Mercatto's own
`README.md`'s "confirmed stable... 2026-08-26" claim reflects a different bootstrap state than a
brand-new Organization created today against the current public Sandbox.

**Not fixed here** -- fixing Mercatto's own setup/CI prerequisites is Mercatto's own maintenance,
out of scope for the Wallet reference project, and never attempted (no admin bootstrap, no
Platform-Owner action taken on Mercatto's behalf). Recorded here only so this cross-project
finding isn't lost -- Mercatto's own `GAPS.md`/`README.md` are the authoritative place for it if
adopted, never silently edited by this project.

## G.5 -- A zero-funded account could "send" successfully -- no local concept of the user's own external wallet balance existed at all -- **BUG (demo-fidelity), fixed in this project only**

**Root cause, confirmed by reading `routes/payments.ts` as it existed before this fix**: under real
SelfCustody, G.1 (above) already establishes that there is no "spend from a stored Ishtaran
balance" primitive -- every payment always creates a brand-new Transaction + a fresh
`PaymentIntent`. `POST /payments/:id/simulate-sandbox-send` (the app's stand-in for "the user's own
wallet broadcasts a real on-chain transfer", since no real Tron adapter exists yet) then
unconditionally called `sandbox.simulateDeposit`/`simulateConfirmation` for whatever amount the
flow declared -- with **no check against any balance concept at all**, because none existed
locally and none exists to check on the Ishtaran side either (G.1). A brand-new account, funded
with nothing, could complete a full send successfully. Not a platform bug -- Ishtaran was never
asked to enforce a balance that, by its own real architecture, isn't a thing to check. The gap was
entirely in this reference project: it never modeled "how much test crypto does the user's own
external wallet hold" at all.

**Fixed, entirely within `wallet-payment-app`**: a new, purely local "demo wallet balance"
(`apps/api/src/demoWallet.ts`, tables `demo_wallets`/`demo_wallet_debits`) -- never read from or
written to Ishtaran, standing in for the user's own external wallet holdings. Starts at 0 for every
account. The only way it increases is the explicit `POST /wallet/demo-deposit` ("Simular
depósito", Settings > Sandbox Tools) -- a real, user-initiated, honestly-labeled action, never
auto-granted at signup. `routes/payments.ts`'s `createPayment` now checks
`hasSufficientDemoBalance` against the real `calculation.senderDebit` BEFORE creating any real
Ishtaran Transaction (so an under-funded attempt never creates a doomed, orphaned Transaction);
`simulate-sandbox-send` performs the actual debit, atomically and idempotently keyed by the real
Ishtaran `transactionId` (never the client-supplied amount -- the real `senderDebit` recorded at
creation is what's charged), at the moment representing "the wallet actually broadcasts" --
deliberately not at creation time, so an abandoned/never-finalized payment never permanently
consumes demo funds. `e2e/wallet/_shared.ts`'s `depositDemoFunds` + every scenario that sends a
payment were updated to call it first, the same real action a real user takes -- never bypassed,
never auto-funded to hide the gate from its own regression coverage.

**Superseded by G.8 (2026-09-10)**: the purely-local `demo_wallets`/`demo_wallet_debits` fix
described above was itself a stopgap -- it fixed the zero-balance-can-send bug, but the balance it
enforced was still a local SQLite fiction, never Sandbox/chain state. `demoWallet.ts` and the
`demo_wallets`/`demo_wallet_debits` tables (and `POST /wallet/demo-deposit`) no longer exist --
replaced entirely by the real `SandboxWalletBalance` platform capability (G.8). This entry is kept
for history (the zero-balance bug it fixed was real and the fix was correct for its time), not as
a description of current code.

## G.6 -- Sandbox `ORGANIZATION_SETTLEMENT_RESTRICTED` (BR-ORG-003/DEC-033) hit live during this session's own testing -- **EXPECTED BEHAVIOR (real platform safety rule), self-inflicted via dev-workflow restarts, not a bug**

**Confirmed live, 2026-09-10**: a manual, isolated reproduction (signup → real
`POST /wallet/demo-deposit` succeeding with 100 → `POST /payments` for 50) failed with:

```
422 ORGANIZATION_SETTLEMENT_RESTRICTED
"Organization '...' possui 3 Execution(s) overdue (limite: 2) — regularize antes de criar novo Payment."
```

**Confirmed in source** (`Deposits.Domain/Exceptions/OrganizationSettlementRestrictedException.cs`,
`Transactions.Application/Queries/GetOrganizationSettlementEligibilityQueryHandler.cs`,
`Transactions.Infrastructure/Repositories/ExecutionRepository.cs`,
`Transactions.Domain/Entities/ExecutionPolicy.cs`): a real, working-as-intended safety rule. An
`Execution` (a SelfCustody signing sequence) that stays `AwaitingSignature` past its grace period
(`DefaultGracePeriodHours = 2`) flips to `Overdue` via a background scanner
(`ExecutionOverdueScannerWorker`); once an Organization has `>= DefaultMaxOverdueExecutions` (2)
Overdue Executions, **every** new Payment is blocked org-wide (`CreatePaymentIntentCommandHandler`)
until they're resolved. `IsRestricted` is always derived, never a persisted flag -- it clears
itself automatically the moment the real overdue count drops, no admin action needed in principle.

**Root cause, not guessed**: this Organization is a single, persistent fixture
(`config/.sandbox-bootstrap.json`, created once by `npm run setup`) reused across every local test
run -- unlike `examples/marketplace-mercatto`, which mints a fresh Organization per run specifically
to avoid this class of accumulated state. `apps/api` runs under `tsx watch`, which restarts the
process on every source-file save; this session saved `apps/api` files many times while iterating
on G.5. If a restart landed mid-`finalizePayment` (mid real signing), the in-flight JS call simply
dies, but the real Ishtaran-side Execution is left exactly where it was -- `AwaitingSignature`
forever, invisible to this app's own local DB (the row is only written after the call returns).
Very plausibly self-inflicted by this session's own dev-restart cadence, not a pre-existing
condition or anything caused by the G.5 logic itself (confirmed: the failure happens strictly
AFTER the new demo-balance check passes, inside Ishtaran's own `CreatePaymentIntent`).

**Not bypassed, not worked around**: no seed, no direct DB write against Ishtaran, no attempt to
force the restricted Organization to accept a Payment. Resolution used: a fresh `npm run setup`
rebootstrap (the project's own documented, real mechanism) for a clean Organization, explicitly
authorized by the platform owner for this session (see G.7 for why the alternative -- finding and
completing the specific stuck Executions -- was not practically possible).

## G.7 -- Outstanding/Overdue Execution discoverability and recovery -- **PLATFORM CAPABILITY GAP, confirmed by exhaustive source search, not an SDK gap**

Found while trying to resolve G.6 without a full Organization rebootstrap: once
`ORGANIZATION_SETTLEMENT_RESTRICTED` fires, its own remediation message says "regularize" the
overdue Execution(s) -- but there is no way for an integrator (or this session, with full API-key
access) to discover *which* Execution(s)/SigningRequest(s) are overdue if their ids were never
independently persisted client-side (exactly what happens after a crash/restart mid-signing, see
G.6). `GetOrganizationSettlementEligibilityQuery`/`CountOverdueByOrganizationAsync` return a COUNT
only, never the identities.

**Confirmed by exhaustive search, not inferred**:
- `src/CompositionRoot/EndpointMapping/ExecutionCustodyEndpoints.cs` -- the module's entire real
  HTTP surface, read in full. The only read route for a SigningRequest is
  `GET /v1/signing-requests/{signingRequestId}` (by id, one at a time). No
  `GET /v1/organizations/{organizationId}/signing-requests`, no `/executions`, no filter-by-status
  route of any kind exists.
- `grep -rl "class.*List.*Execution\|class.*List.*SigningRequest\|ListExecutions"` across the
  entire `src/` tree returns **zero** results -- not just a missing HTTP route on an existing
  capability (the pattern already found and fixed for Mercatto's own F.19/F.20/F.23, where the
  Command/Query existed in `*.Contracts` but was never mapped to HTTP): here, no such Query class
  exists in ANY layer (`Transactions.Contracts`, `Transactions.Application`,
  `ExecutionCustody.Contracts`). The capability itself was never built, not merely left
  unexposed -- so this is classified **PLATFORM CAPABILITY GAP**, not an SDK/DX parity gap. The
  TypeScript SDK's `SigningRequestsResource` (`get`/`create`/`submitSignedTransaction` only, no
  `list`) correctly reflects the backend -- there is nothing for it to expose.

**Practical consequence**: `BR-ORG-003`'s own "regularize" instruction is not actionable today for
an integrator who has lost track of the specific Execution id(s) involved (the realistic case after
any crash, restart, or process interruption mid-signing) -- the only two paths that actually work
are (a) already knowing every SigningRequest id and probing each with `GET .../signing-requests/{id}`
one at a time, hoping to reconstruct which ones are stuck, or (b) a full Organization rebootstrap
(what this session did for G.6). Neither is a real "regularize", just a workaround for the
discoverability gap.

**Not fixed here** -- core platform change (a real List/Query capability plus, likely, a
Platform-Owner-facing admin route in the same family as Mercatto's F.19/F.20/F.23 fixes) is out of
scope for this task and was never attempted. Flagged for the platform owner with the minimal
suggested shape: a `GetOverdueExecutionsByOrganizationQuery` (Transactions.Contracts) returning
`{executionId, transactionId, signingRequestId, awaitingSignatureSince}[]`, exposed via
`GET /v1/organizations/{organizationId}/executions?status=Overdue` (or a Platform-Owner-only admin
route, if never meant to be integrator-facing) -- mirrors the shape of every other list endpoint
already in this codebase, no new architectural pattern required.

## G.8 -- Wallet balance was a local-demo-economy fiction, never the wallet's real Sandbox/chain state -- **fixed this session, real Sandbox capability shipped and deployed**

**The problem, confirmed live**: before this fix, "Home balance" was a SQLite counter
(`demo_wallets`/`demo_wallet_debits`) maintained entirely inside `apps/api`, never observed or
enforced by Ishtaran or by any simulated blockchain state. A fresh wallet could show a balance,
Send could debit it, but none of this corresponded to anything Ishtaran (Sandbox or Production)
actually tracks -- Sandbox/Production parity ("Sandbox replaces external infra, never business
logic") did not hold, because the infra being replaced (a wallet-address balance) never existed on
the Ishtaran side to replace in the first place.

**Root cause, confirmed by exhaustive search**: `IBlockchainConnector`
(`BlockchainConnector.Domain`) -- the only port isolating the financial core from blockchain/SDK
protocol details, used by both Production and Sandbox connectors -- has exactly 3 methods
(`ObserveAddressAsync`, `BroadcastTransactionAsync`, `GetConfirmationStatusAsync`). No
balance-by-address method exists anywhere in Ishtaran's real architecture, by design: the platform
models economic state via the Ledger/Account (Accounts.Domain, `recordEntry`-only mutation), never
a wallet-address balance lookup. `Sandbox.Domain`'s pre-existing `SandboxObservedAddress` aggregate
has no balance field (`LastObservedReference`/`LastConfirmationCount` only -- deposits are pure
observation events); `SandboxTreasuryObservedBalance` is a global, manually-set, per-AssetNetwork
figure, not per-address.

**Fixed**: a new Sandbox-only, per-address `SandboxWalletBalance` capability
(`Sandbox.Domain/Aggregates/SandboxWalletBalance.cs`, composite key
EnvironmentId+AssetNetworkId+normalized Address, `numeric(38,18)`, DB-level `balance >= 0` CHECK
constraint) plus `SandboxWalletOperation` (idempotency-record-first pattern, PK = caller-supplied
IdempotencyKey, inserted BEFORE any balance mutation -- retries never double-apply). Atomic
conditional `ExecuteUpdateAsync` updates for credit/debit (never read-then-write); `TryTransferAsync`
wraps a same-address-pair debit+credit in a real DB transaction. Exposed via 3 new endpoints under
`/v1/environments/{environmentId}/sandbox/wallet-balance` (`GET`, `POST .../credit`,
`POST .../transfer`), matching the existing Sandbox endpoint conventions exactly (same
`SandboxSimulate` permission/rate-limit policy). New TypeScript SDK methods
(`creditWalletBalance`/`transferWalletBalance`/`getWalletBalance` on `SandboxResource`), tested.

**`apps/api`'s local demo economy removed for real**, not just unused: `demo_wallets`/
`demo_wallet_debits` tables dropped (`db.ts`, `DROP TABLE IF EXISTS` for pre-existing local dev
DBs), `demoWallet.ts` files deleted. A `WalletBalanceProvider` port
(`apps/api/src/walletBalance/WalletBalanceProvider.ts`) with `SandboxWalletBalanceProvider` (calls
the new Sandbox capability via the SDK) and `ProductionWalletBalanceProvider` (queries TronGrid's
real public REST API directly for TRC-20 USDT balance by address -- Ishtaran itself has no
balance-by-address concept even in Production, confirmed above, so Production correctly bypasses
Ishtaran entirely for this one read) -- UI/business logic never knows which is active.
`ProductionWalletBalanceProvider.creditExternalDeposit`/`.transfer` throw clear, honest
"not applicable in Production" errors (no simulation concept for a real deposit; a real transfer
must be signed client-side, `apps/api` never holds a private key) rather than pretending Production
support exists.

**Deployed and verified live against the real public Sandbox** (`sandbox-api.ishtaran.com`,
2026-09-10, commit `9dd9374`, image tag `9dd9374af05e`, via the documented `terraform/` pipeline --
see `terraform/README.md` §Runbook): fresh wallet = 0 USDT, simulate-deposit 20 -> 20, direct X->Y
wallet transfer correctly debits/credits both sides atomically (idempotent retry confirmed
non-double-debiting), insufficient-funds correctly rejected (402
`INSUFFICIENT_SANDBOX_WALLET_BALANCE`), and a full Payment (Transaction -> PaymentIntent -> funding
via the new wallet-balance transfer primitive -> Settlement) completed with correct Platform Fee
and App Revenue reconciliation -- confirmed both by direct HTTP reproduction and by
`e2e/wallet/run.ts`'s formal scenario suite (01/02/03/04/05 of 8 passing cleanly; 06/07/08 hit the
pre-existing, already-documented G.6/G.7 `ORGANIZATION_SETTLEMENT_RESTRICTED` condition, unrelated
to this capability -- see G.6/G.7, not a regression from this work).

**Dedicated unit coverage added (2026-09-10, commit `9160563`)**: 24 new tests --
`Sandbox.Domain.Tests` (`SandboxWalletBalanceTests`/`SandboxWalletOperationTests`, 9 tests: factory
validation, address normalization) and `Sandbox.Application.Tests`
(`CreditSandboxWalletBalanceCommandHandlerTests`/`TransferSandboxWalletBalanceCommandHandlerTests`/
`GetSandboxWalletBalanceQueryHandlerTests`, 15 tests: positive-amount validation, same-address
transfer rejection, insufficient-balance rejection, idempotent-retry-never-double-applies for both
credit and transfer). All 22/22 and 29/29 green respectively (full module suites, not just the new
tests). **Not done here** (out of scope, tracked separately): the general SDK `BalanceResponse`
parity gap across the four SDKs.

**Superseded by G.9 below (Prompt 2, 2026-09-11):** everything above describes the architecture
correctly for its own time, but it predates the real, formal Ishtaran core-platform WalletBalance
capability (Prompt 1/1.1, `client.walletBalance` -- persistent `WalletBalanceSnapshot`, 30s
freshness/single-flight guard, event-driven refresh, background reconciliation, all server-side).
`WalletBalanceProvider.getBalance` querying `client.sandbox.getWalletBalance`/TronGrid directly was
the correct integration BEFORE that capability existed; it is not any more. See G.9.

## G.9 -- `apps/api` integrated with Ishtaran's official WalletBalance capability, replacing the pre-capability G.8 query path -- **fixed this session (Prompt 2)**

**The gap, confirmed live**: G.8 shipped a real Sandbox-backed wallet balance BEFORE Ishtaran's own
core-platform WalletBalance capability (Prompt 1/1.1: persistent snapshot, 30s guard, event-driven
refresh, background reconciliation, `client.walletBalance`) existed. `apps/api`'s
`WalletBalanceProvider.getBalance` queried `client.sandbox.getWalletBalance` (a low-level
chain-simulation read, no snapshot/guard/staleness tracking at all) directly, and
`ProductionWalletBalanceProvider.getBalance` queried TronGrid directly, bypassing Ishtaran
entirely for the read -- both reasoned, correctly at the time, that Ishtaran had no
balance-by-address concept to integrate with. That premise became outdated the moment Prompt 1
shipped.

**Fixed**: `WalletBalanceProvider.ts` split into two interfaces -- `WalletBalanceReader` (reads,
now via `client.walletBalance.getBalance`/`refreshBalance`/`getAssetBalances`, ONE implementation,
environment-agnostic -- Ishtaran itself already resolves Sandbox vs. Production server-side) and
`WalletChainActions` (chain-mutating actions -- Sandbox credit/transfer, still environment-specific,
unchanged in spirit from G.8). New endpoints: `POST /wallet/balance/refresh` (authoritative,
respects the platform's 30s guard) and `GET /wallet/balances` (multi-asset/multi-network aggregate,
Prompt 2 §5/§6 -- today always exactly one entry, USDT/TRON, never hardcoded as if there could only
ever be one). `simulate-deposit`/`transfer`/`simulate-sandbox-send` now call `refreshBalance`
synchronously right after their chain mutation (never relying solely on the async ~5s Outbox
dispatch latency for the caller's own immediate UI feedback), while ALSO benefiting from real
event-driven refresh (`SandboxWalletBalanceChanged` -> `WalletBalance.Application`'s integration
handler) for any OTHER session/device watching the same wallet.

**Frontend**: `useWalletBalance.ts` (new hook) -- initial fetch, foreground-return + ~30s polling
(always the cheap `getBalance`, never the expensive `refreshBalance`), stops completely in
background, and a client-side change detector (`clientSideBalanceDetector.ts`) that independently
re-checks the real chain in Production ONLY (TronGrid public REST, no key, same technique already
proven server-side) -- correctly INERT in Sandbox (no independent public chain exists to read
there; faking a check by calling Ishtaran again would defeat the entire optimization -- see that
file's own header for the full reasoning). Home redesigned around the new snapshot (freshness
label, manual refresh, show/hide toggle, multi-asset carousel, per-network breakdown).

**Verified live against the real deployed Sandbox** (`e2e/wallet/09-wallet-balance-integration.ts`,
new): fresh wallet = 0, simulate-deposit 20 -> 20 and survives a reload, the platform's 30s guard
suppresses a second immediate refresh (same balance returned, never an error), and a real
wallet-to-wallet transfer's event-driven refresh updates BOTH sides -- verified independently from
each side's own session, not inferred from the sender's response alone.

**New gap found live, NOT fixed here (out of scope for Prompt 2 -- Ledger/Refund core logic, not
WalletBalance)**: `e2e/wallet/08-refund.ts` -- previously blocked entirely by G.6/G.7 (never
actually executed against a clean Organization before this session) -- now runs and fails a real
assertion: a pre-Settlement refund of a 25 USDT payment increases the payer's Ledger `Available`
balance by 50, not 25. Confirmed via direct HTTP reproduction, not a scenario-harness artifact.
Entirely a Ledger/Refund-module question (`client.ledger.getBalance`'s `available` field) --
nothing in this Prompt touched Refund/Ledger code. Flagged for the core backlog, not investigated
further here.
