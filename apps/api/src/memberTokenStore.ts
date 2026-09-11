// `POST /v1/auth/refresh` rotates the Member refreshToken on every use (confirmed live: replaying
// an already-spent one is rejected 401) -- this store keeps the current one in memory and
// persists every rotation straight back to the same file scripts/setup.ts wrote, so a server
// restart never tries to reuse a stale token.
import { readFileSync, writeFileSync } from 'node:fs';
import type { MemberRefreshTokenStore } from '@wallet-app/ishtaran-client';
import type { SandboxBootstrap } from './config.js';

export function createMemberTokenStore(bootstrapPath: string, initial: string): MemberRefreshTokenStore {
  let current = initial;
  return {
    get: () => current,
    set: (refreshToken: string) => {
      current = refreshToken;
      const bootstrap = JSON.parse(readFileSync(bootstrapPath, 'utf8')) as SandboxBootstrap;
      bootstrap.memberRefreshToken = refreshToken;
      writeFileSync(bootstrapPath, `${JSON.stringify(bootstrap, null, 2)}\n`, 'utf8');
    },
  };
}
