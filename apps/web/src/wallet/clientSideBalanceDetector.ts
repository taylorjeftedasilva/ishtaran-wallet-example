// Prompt 2 §8-10 -- uses the user's OWN device as a cheap, independent change detector, never a
// source of truth. The device reads the public chain itself and compares it to the last balance
// Ishtaran confirmed; if they differ, the caller is told to ask Ishtaran for an authoritative
// `refreshBalance` (the expensive, RPC-backed call). The device NEVER reports "my balance is now
// X" to Ishtaran -- only "something may have changed, please check yourself."
//
// SANDBOX: there is no independent public chain to read here. Sandbox's simulated chain state
// (`SandboxWalletBalance`) lives entirely inside Ishtaran's own database -- a "device reads the
// blockchain" check is not a meaningful concept in this environment. Faking one by calling
// Ishtaran's own API again would defeat the entire point of this optimization (that call would BE
// an Ishtaran call, indistinguishable from simply polling `getBalance`). So this detector is
// correctly INERT in Sandbox by design, not because a safe technique is unavailable -- correctness
// there already comes from event-driven refresh (Prompt 1.1, proven live against the real Sandbox
// deploy) and ~10min background reconciliation, both server-side.
//
// PRODUCTION: uses the exact same technique already proven safe server-side (see the platform
// core's own `TronBlockchainBalanceProvider`, and this app's own former
// ProductionWalletBalanceProvider.getBalance) -- TronGrid's public REST account endpoint,
// unauthenticated, no API key, no secret, read-only, TRC-20 `balanceOf` surfaced via the
// `trc20` field on the account response. Never a private key. Never an Ishtaran credential. If
// this call fails for any reason (network, CORS, provider down, timeout) it fails CLOSED -- never
// throws, never blocks the UI -- the platform's own event-driven refresh + reconciliation remain
// the correctness guarantee regardless of whether this optimization ever runs successfully.

export type ClientSideDetectionResult =
  | { status: 'not_applicable_sandbox' }
  | { status: 'checked_unchanged' }
  | { status: 'checked_changed'; observedBalance: string }
  | { status: 'check_failed' };

const USDT_TRC20_CONTRACT_MAINNET = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_DECIMALS = 6;
const FETCH_TIMEOUT_MS = 8_000;
const TRONGRID_BASE_URL = 'https://api.trongrid.io';

export async function checkForBalanceChange(params: {
  environment: 'sandbox' | 'production';
  address: string;
  lastKnownBalance: string;
}): Promise<ClientSideDetectionResult> {
  if (params.environment !== 'production') {
    // Not a failure -- there is nothing unsafe here, just nothing independent to check. See file header.
    return { status: 'not_applicable_sandbox' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${TRONGRID_BASE_URL}/v1/accounts/${params.address}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) return { status: 'check_failed' };

    const body = (await res.json()) as { data?: { trc20?: Record<string, string>[] }[] };
    const account = body.data?.[0];
    // A never-funded address genuinely has no account record on-chain yet -- balance 0, not a failure.
    const entry = account?.trc20?.find((t) => USDT_TRC20_CONTRACT_MAINNET in t);
    const raw = entry?.[USDT_TRC20_CONTRACT_MAINNET] ?? '0';

    // BigInt division for the integer part avoids float precision loss on large balances -- same
    // discipline as every other TRC-20 decimal conversion in this codebase.
    const rawBig = BigInt(raw);
    const divisor = 10n ** BigInt(USDT_DECIMALS);
    const whole = rawBig / divisor;
    const fraction = (rawBig % divisor).toString().padStart(USDT_DECIMALS, '0');
    const observedBalance = `${whole}.${fraction}`;

    if (Number(observedBalance) === Number(params.lastKnownBalance)) {
      return { status: 'checked_unchanged' };
    }
    return { status: 'checked_changed', observedBalance };
  } catch {
    // Timeout, network error, malformed response -- fail closed, never surfaced as an app error.
    return { status: 'check_failed' };
  }
}
