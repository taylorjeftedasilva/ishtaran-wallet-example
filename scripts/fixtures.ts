// Deterministic bootstrap fixtures -- own convention, never shared with
// examples/marketplace-mercatto/fixtures.ts (each reference project owns its own Sandbox data).

/** Every run's Organization/email/externalId is namespaced by this -- repeated runs never collide. */
export function newRunId(): string {
  return String(Date.now());
}

export function ownerEmail(runId: string): string {
  return `wallet-owner+${runId}@example.com`;
}

/** Meets the real signup password policy (length + upper/lower/digit/symbol) -- test-only, never a real secret. */
export const BOOTSTRAP_PASSWORD = 'Str0ngP@ssw0rd!123';
