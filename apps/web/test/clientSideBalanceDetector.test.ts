import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkForBalanceChange } from '../src/wallet/clientSideBalanceDetector.js';

/**
 * Prompt 2 §8-10 -- the device-side detector's most important property is what it does NOT do:
 * in Sandbox, there is no independent public chain to read, so it must never fabricate a "device
 * blockchain query" by calling out to anything (Ishtaran or otherwise) -- see the file's own
 * header for the full reasoning. This is the one guarantee worth a real, network-free unit test;
 * the Production branch (a real TronGrid fetch) is exercised live, not mocked, in the E2E battery.
 */
describe('checkForBalanceChange', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  afterEach(() => {
    fetchSpy.mockReset();
  });

  it('never makes a network call in Sandbox -- not_applicable_sandbox, no fetch attempted', async () => {
    const result = await checkForBalanceChange({ environment: 'sandbox', address: 'TAnyAddress', lastKnownBalance: '10' });
    expect(result).toEqual({ status: 'not_applicable_sandbox' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Production: unchanged balance reports checked_unchanged', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ trc20: [{ TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: '10000000' }] }] }), { status: 200 }),
    );
    const result = await checkForBalanceChange({ environment: 'production', address: 'TAnyAddress', lastKnownBalance: '10' });
    expect(result).toEqual({ status: 'checked_unchanged' });
  });

  it('Production: changed balance reports checked_changed with the observed value, never asserting it is the new truth', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ trc20: [{ TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: '25000000' }] }] }), { status: 200 }),
    );
    const result = await checkForBalanceChange({ environment: 'production', address: 'TAnyAddress', lastKnownBalance: '10' });
    expect(result).toEqual({ status: 'checked_changed', observedBalance: '25.000000' });
  });

  it('Production: a failed/unreachable provider fails closed, never throws', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    const result = await checkForBalanceChange({ environment: 'production', address: 'TAnyAddress', lastKnownBalance: '10' });
    expect(result).toEqual({ status: 'check_failed' });
  });

  it('Production: a never-funded address (no account record) is balance 0, never a failure', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const result = await checkForBalanceChange({ environment: 'production', address: 'TAnyAddress', lastKnownBalance: '0' });
    expect(result).toEqual({ status: 'checked_unchanged' });
  });
});
