// Sandbox bootstrap (Implementation Plan Fase P/V Slice 1 + execution infrastructure needed by
// Slice 4) -- mirrors examples/marketplace-mercatto's own setup.ts -> register-execution-wallet.ts
// -> seller-onboarding.ts (revenue account) -> register-network-cost-payer-account.ts pipeline,
// adapted to the wallet's own vocabulary. One real `POST /v1/auth/signup` provisions the
// Organization/Application/Environment/API Key; the rest registers the one-time SelfCustody
// execution primitives every real Settlement needs (CUSTODY-EXECUTION-MODES.md Part 3/3bis):
// an execution Wallet, the App Revenue Account + its ExecutionDestination, and a
// NetworkCostPayerAccount. Run with `npm run setup`. Writes config/.sandbox-bootstrap.json (never
// committed -- see .gitignore) for apps/api to read at startup; apps/web never sees this file.
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allocateDepositAddress,
  createClient,
  createFundingTransaction,
  createPaymentIntent,
  DerivationScheme,
  getPaymentIntent,
  registerExecutionDestination,
  registerExecutionSource,
  registerNetworkCostPayerAccount,
  resolveUsdtTronAssetNetworkId,
  wallet,
} from '@wallet-app/ishtaran-client';
import { BOOTSTRAP_PASSWORD, newRunId, ownerEmail } from './fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'config', '.sandbox-bootstrap.json');
const APP_REVENUE_EXTERNAL_ID = 'app-revenue';

async function main() {
  const runId = newRunId();

  const owner = createClient();
  const signup = await owner.auth.signUp(`Wallet Reference App ${runId}`, ownerEmail(runId), BOOTSTRAP_PASSWORD);
  if (!signup.apiKeyPlainText) {
    throw new Error('Signup succeeded but returned no API Key -- cannot continue bootstrap.');
  }
  if (!signup.token.refreshToken) {
    throw new Error('Signup succeeded but returned no Member refreshToken -- cannot continue bootstrap.');
  }

  const { organizationId, applicationId, environmentId } = signup;
  const app = createClient(signup.apiKeyPlainText);

  const { assetNetworkId, networkId } = await resolveUsdtTronAssetNetworkId(owner);

  // The App's own execution wallet -- the wallet that physically holds every payer's confirmed
  // deposit, and the one whose signer authorizes every real Settlement leg. Private key/mnemonic
  // never leaves this process except to be persisted locally for apps/api's own later use (a
  // long-running server, unlike Mercatto's one-shot scenario scripts) -- see SECURITY.md caveat.
  const generatedWallet = wallet.generate();
  const registeredWallet = await app.wallets.register(
    applicationId,
    networkId,
    DerivationScheme.TRON_BIP44_HARDENED_ACCOUNT!,
    generatedWallet.wallet.accountExtendedPublicKey,
  );

  // App Revenue Account -- an Organization-provisioned Account (accounts.create, no AccountHolder
  // login), authorized for this Application, receiving funds at an address allocated from the
  // App's own execution wallet (same mechanism a deposit address uses -- DEC-037: "just another
  // address this Wallet controls").
  const appRevenueAccountId = (await app.accounts.create(organizationId, `${APP_REVENUE_EXTERNAL_ID}-${runId}`)).accountId;
  await owner.accounts.authorizeApplication(organizationId, appRevenueAccountId, applicationId);
  const appRevenueAllocation = await allocateDepositAddress(app, applicationId, networkId);
  await registerExecutionDestination(app, organizationId, appRevenueAccountId, assetNetworkId, appRevenueAllocation.address);

  // Who pays for on-chain resource (Energy/Bandwidth) cost -- the App's own revenue account,
  // matching Mercatto's own business decision (its commission account pays network cost).
  const networkCostPayerAccount = await registerNetworkCostPayerAccount(app, organizationId, assetNetworkId, appRevenueAccountId);

  // ExecutionSource -- required before the first SelfCustody Withdrawal on this AssetNetwork
  // (CUSTODY-EXECUTION-MODES.md Part 3bis): the pooled origin address Withdrawals sign from. A
  // fresh address allocated from the App's own execution wallet, same mechanism as any deposit
  // address -- "just another address this Wallet controls."
  const executionSourceAllocation = await allocateDepositAddress(app, applicationId, networkId);
  const executionSource = await registerExecutionSource(
    app, organizationId, environmentId, assetNetworkId,
    registeredWallet.walletId, executionSourceAllocation.derivationReference, executionSourceAllocation.address,
  );

  // The NetworkCostPayerAccount needs its OWN Available balance to cover the real Network
  // Execution Fee of every Settlement leg it's charged for (confirmed live:
  // NETWORK_EXECUTION_FEE_INSUFFICIENT_BALANCE otherwise -- "Um Deposit normal nesta Account...
  // cobre a diferença", i.e. this is a real, ordinary Deposit, never a separate "gas wallet"
  // concept). Sandbox-only seeding (simulateDeposit/simulateConfirmation) -- a real deployment
  // requires the App Owner to actually fund this Account.
  // "Overfunded deposit" pattern (see createFundingTransaction's own doc comment for why): the
  // dummy Transaction's declared amount must be SMALLER than the real deposit, or the platform's
  // auto-reserve locks the entire deposit away as unusable Reserved balance.
  const declaredAmount = '2';
  const depositAmount = '1000';
  const expectedAvailable = (Number(depositAmount) - Number(declaredAmount)).toString();
  const fundingTx = await createFundingTransaction(app, {
    organizationId, applicationId, environmentId, assetNetworkId,
    funderAccountId: appRevenueAccountId,
    placeholderBeneficiaryAccountId: appRevenueAccountId,
    amount: declaredAmount,
    idempotencyKey: `wallet-setup-fund-app-revenue-${runId}`,
  });
  const fundingIntent = await createPaymentIntent(app, organizationId, fundingTx.transactionId, assetNetworkId, depositAmount);
  const fullFundingIntent = await getPaymentIntent(app, fundingIntent.paymentIntentId);
  const observedDeposit = await app.sandbox.simulateDeposit(environmentId, fullFundingIntent.depositAddress!, assetNetworkId, depositAmount);
  await app.sandbox.simulateConfirmation(environmentId, observedDeposit.sandboxObservedAddressId, 1, true);
  await waitForAvailableBalance(app, appRevenueAccountId, assetNetworkId, expectedAvailable);

  // Webhook endpoint -- attempts a REAL registration (Member-JWT-only, WebhookEndpointsResource),
  // which would give a REAL Ishtaran-issued secret. Confirmed live: the platform validates the URL
  // at registration time and rejects private/loopback/link-local addresses outright
  // (`VALIDATION_ERROR`, "Url não pode resolver para um endereço IP privado/loopback/link-local"
  // -- real SSRF protection, not a bug). Local dev has no public URL, so registration itself
  // cannot succeed here, not just delivery -- set WALLET_WEBHOOK_URL to a real public tunnel
  // (ngrok etc.) to get a genuine registration + secret. Falls back to a LOCALLY generated,
  // clearly-labeled test-only secret otherwise, so the receiver's signature-verification logic
  // (real SDK `verifyWebhookSignature`/`computeWebhookSignature`, GAPS.md-documented) is still
  // fully exercisable in tests/integration -- never presented as an Ishtaran-issued secret.
  const webhookUrl = process.env.WALLET_WEBHOOK_URL;
  let webhookEndpointId = 'local-only';
  let webhookSecret: string;
  if (webhookUrl) {
    const webhookEndpoint = await owner.webhookEndpoints.create(organizationId, webhookUrl);
    if (!webhookEndpoint.secret) {
      throw new Error('Webhook endpoint registration succeeded but returned no secret -- cannot continue bootstrap.');
    }
    webhookEndpointId = webhookEndpoint.webhookEndpointId;
    webhookSecret = webhookEndpoint.secret;
  } else {
    webhookSecret = randomBytes(32).toString('hex');
    console.log('[setup] No WALLET_WEBHOOK_URL set -- Ishtaran rejects private/loopback URLs at registration (real SSRF protection, GAPS.md G.3). Using a LOCAL test-only webhook secret instead of a real Ishtaran-issued one.');
  }

  const bootstrap = {
    runId,
    organizationId,
    applicationId,
    environmentId,
    apiKey: signup.apiKeyPlainText,
    // Member-JWT-only operations (GAPS.md F.9, e.g. AuthorizeAccountForApplication) can never be
    // called with the API Key -- apps/api re-derives a fresh Member access token from this on
    // demand (packages/ishtaran-client's withMemberSession) rather than caching a short-lived one.
    memberRefreshToken: signup.token.refreshToken,
    assetNetworkId,
    networkId,
    executionWalletId: registeredWallet.walletId,
    // Reference-project simplification, loudly documented (SECURITY.md): a real production
    // deployment would hold this in an HSM/KMS, never a local file. This is the APP's own
    // execution wallet (server-side custody of the app's operating funds), a different concern
    // from an end user's own self-custody wallet, which is generated and held client-side only
    // (Fase H) and never touches apps/api at all.
    executionWalletMnemonic: generatedWallet.mnemonic,
    appRevenueAccountId,
    networkCostPayerAccountId: networkCostPayerAccount.networkCostPayerAccountId,
    executionSourceId: executionSource.executionSourceId,
    webhookEndpointId,
    webhookSecret,
    createdAt: new Date().toISOString(),
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(bootstrap, null, 2)}\n`, 'utf8');

  console.log(`[setup] Organization ${bootstrap.organizationId} provisioned (runId=${runId}).`);
  console.log(`[setup] Application ${bootstrap.applicationId}, Environment ${bootstrap.environmentId}.`);
  console.log(`[setup] USDT/Tron assetNetworkId=${assetNetworkId}, networkId=${networkId}.`);
  console.log(`[setup] Execution wallet ${bootstrap.executionWalletId} registered (private key/mnemonic never left this process's memory except to the local bootstrap file).`);
  console.log(`[setup] App Revenue Account ${appRevenueAccountId}, NetworkCostPayerAccount ${bootstrap.networkCostPayerAccountId}, ${expectedAvailable} USDT available for Network Execution Fees.`);
  console.log(`[setup] ExecutionSource ${executionSource.executionSourceId} registered (required for the first SelfCustody Withdrawal on this AssetNetwork).`);
  console.log(
    webhookUrl
      ? `[setup] Webhook endpoint ${webhookEndpointId} registered at ${webhookUrl} (real secret issued; no real delivery will reach a local URL, see GAPS.md).`
      : `[setup] No real webhook endpoint registered (no public WALLET_WEBHOOK_URL) -- using a local test-only secret, see GAPS.md.`,
  );
  console.log(`[setup] Wrote ${OUTPUT_PATH} (contains a real API Key and execution wallet mnemonic -- never commit this file).`);
}

async function waitForAvailableBalance(app: ReturnType<typeof createClient>, accountId: string, assetNetworkId: string, minAmount: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let balance = await app.ledger.getBalance(accountId, assetNetworkId);
  while (Number(balance.available) < Number(minAmount) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    balance = await app.ledger.getBalance(accountId, assetNetworkId);
  }
  if (Number(balance.available) < Number(minAmount)) {
    throw new Error(`Account ${accountId} did not reach Available >= ${minAmount} within 30s (got ${balance.available}).`);
  }
}

main().catch((error) => {
  console.error('[setup] Bootstrap failed:', error);
  process.exitCode = 1;
});
