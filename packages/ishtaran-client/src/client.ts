// Env-aware client factory: real public Sandbox by default, or a local `tools/e2e-environment`
// stack when WALLET_BASE_URL is set (mirrors examples/marketplace-mercatto/client.ts's own
// convention exactly, own env var name so the two reference projects never share config).
import { Environment, IshtaranClient } from '@ishtaran/sdk';

const baseUrl = process.env.WALLET_BASE_URL;

export function createClient(apiKey?: string): IshtaranClient {
  return IshtaranClient.create(baseUrl ? { apiKey, baseUrl } : { apiKey, environment: Environment.Sandbox });
}
