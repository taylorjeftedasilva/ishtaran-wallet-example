// Works around a real, confirmed SDK gap (never a backend gap -- see GAPS.md G.2): the real
// `GET /v1/accounts/{accountId}/balance` response has carried `payable`/`reservedForPayout`/
// `delivered` since 2026-08-30 (`Ledger.Contracts.Responses.BalanceResponse`, DEC-040/SPEC-024/025
// -- purely additive fields, defaulted to 0 for older callers), but the TypeScript SDK's
// `mapBalanceResponse` (sdks/typescript/src/model/dataPlane.ts) was never updated to read them --
// it silently discards everything except `available`/`pending`/`reserved`. Per this project's
// ABSOLUTE RULES the SDK itself is never modified; this makes the SAME real HTTP call the SDK's
// own `LedgerResource.getBalance` makes (confirmed against `authenticatingTransport.ts`: header
// `X-Api-Key`, path `/v1/accounts/{accountId}/balance?assetNetworkId=...`) and parses the full
// response. `Delivered` matters enormously to a self-custody wallet: a Settlement beneficiary's
// payout is credited there, NEVER `Available` (`EntryNature.Delivered` is "structurally inert to
// Reserve/Release/Withdrawal" by design) -- `ledger.getBalance().available` alone under-reports a
// user's real received funds by exactly the amount they were ever paid via a Settlement.
const SANDBOX_BASE_URL = 'https://sandbox-api.ishtaran.com';

export interface FullBalanceResponse {
  available: string;
  pending: string;
  reserved: string;
  payable: string;
  reservedForPayout: string;
  delivered: string;
}

export async function getFullAccountBalance(apiKey: string, accountId: string, assetNetworkId: string): Promise<FullBalanceResponse> {
  const baseUrl = process.env.WALLET_BASE_URL ?? SANDBOX_BASE_URL;
  const res = await fetch(`${baseUrl}/v1/accounts/${accountId}/balance?assetNetworkId=${assetNetworkId}`, {
    headers: { 'X-Api-Key': apiKey },
  });
  if (!res.ok) {
    throw new Error(`getFullAccountBalance failed: ${res.status} ${await res.text()}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  return {
    available: String(raw.available ?? '0'),
    pending: String(raw.pending ?? '0'),
    reserved: String(raw.reserved ?? '0'),
    payable: String(raw.payable ?? '0'),
    reservedForPayout: String(raw.reservedForPayout ?? '0'),
    delivered: String(raw.delivered ?? '0'),
  };
}
