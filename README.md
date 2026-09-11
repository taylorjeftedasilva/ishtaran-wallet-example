# Wallet & Payment App — Self-Custody Reference Project

A self-custody wallet and payment app built on Ishtaran: the wallet's private key lives in the
browser and never reaches any server, its balance is the wallet's own observed on-chain state
(never a platform ledger fiction), and it supports both a direct wallet-to-wallet **Send** and a
**Pay** flow that fulfills a Payment Request. The same app also demonstrates
app-owner-configurable monetization — a `RevenueStrategy` decides who absorbs the platform fee
(sender or receiver) without the app writing its own fee/settlement logic.

This is executable documentation, not a slide deck: every route, page, and flow here is real code
against the real `@ishtaran/sdk`, run live against the public Ishtaran Sandbox during development —
not a mocked or hand-simplified demo.

## Two fundamental distinctions this project exists to demonstrate

**Wallet Balance ≠ Ledger.** `client.walletBalance` answers "how many tokens actually sit at this
wallet's registered self-custody address, right now" — an observation of chain state (simulated in
Sandbox, real on-chain in Production). `client.ledger` answers a completely different question:
Ishtaran's own economic accounting (Available/Payable/Reserved/Delivered), populated only by real
Payment/Settlement flows. **Never summed, never substituted for one another** — this app's Home
screen shows Wallet Balance, and its Revenue page shows both, side by side, clearly labeled. See
`apps/api/src/walletBalance/` and `apps/web/src/pages/Home.tsx`.

**Send ≠ Pay.** Send (`apps/web/src/pages/move/SendTab.tsx`, `POST /wallet/transfer`) is a direct,
sender-initiated wallet-to-wallet transfer — it never touches a Transaction, PaymentIntent, or
Settlement. Pay (`apps/web/src/pages/move/PayTab.tsx`, `POST /wallet/payment-requests/:id/pay`) is
the fulfillment of an existing Payment Request — it drives the real
Transaction → PaymentIntent → Settlement pipeline, with a fee preview shown *before* anything is
created (`GET /wallet/payment-requests/:id/preview-fees` is pure — zero Ishtaran calls, zero side
effects — nothing real happens until the user explicitly confirms).

## Self-custody

Private keys, seeds, and mnemonics are generated and stored entirely client-side
(`apps/web/src/wallet/localWallet.ts`, `cryptoStorage.ts`) — Ishtaran only ever receives public
wallet material and signed execution payloads, the same protocol described in
[`@ishtaran/sdk`'s own self-custody docs](https://github.com/taylorjeftedasilva/ishtaran-node#self-custody).
This reference app's browser-local key storage is a demo convenience, not a production key-
management solution — see the SDK's own `Signer` interface docs for what a real deployment needs.

## Structure

| Path | What it is |
|---|---|
| `apps/api` | Fastify backend — owns the Ishtaran API Key, exposes the app's own REST API to `apps/web` |
| `apps/web` | React + Vite frontend — the wallet UI, holds the private key client-side |
| `packages/ishtaran-client` | Thin, typed wrapper around `@ishtaran/sdk` shared by the API and setup scripts |
| `packages/wallet-core` | `RevenueStrategy`/`WalletConfig` schema — the Builder LEGO contract for reshaping this app's mode/branding/monetization |
| `packages/revenue` | Pure fee/split calculation — independently unit-tested, never re-implements Ishtaran's own Settlement math |
| `e2e/wallet/` | 9-scenario end-to-end battery against a real running stack (`npm run e2e:wallet`) |
| `scripts/setup.ts` | One-time Sandbox bootstrap: signs up, registers the app's execution wallet + revenue account |
| `GAPS.md` | Every real platform limitation this project ran into, and how each one shaped the app — documented, never hidden or silently worked around |

## Run it yourself

Requires Node.js >= 18.

```bash
npm install
npm run typecheck
npm run setup       # one-time: provisions a fresh Organization/Application on the public Sandbox
npm run dev:api      # http://localhost:3001
npm run dev:web      # http://localhost:5173 (separate terminal)
```

By default this runs against the real public Ishtaran Sandbox
(`https://sandbox-api.ishtaran.com`) — no credentials to configure beyond what `npm run setup`
provisions for itself. Every run provisions its own Organization/Application/Accounts (namespaced
by a run id derived from the current timestamp), so repeated runs never collide.

`npm run setup` writes `config/.sandbox-bootstrap.json` (git-ignored, never committed — contains a
real, freshly-issued Sandbox API Key scoped to the Organization it just created) for `apps/api` to
read at startup. `apps/web` never sees this file or any API Key — it only ever talks to `apps/api`.

Run the end-to-end battery (needs both apps running):

```bash
npm run e2e:wallet
```

## Environment mode

`WALLET_APP_MODE` (env var, default `PERSONAL`) switches between the two reference presets defined
in `packages/wallet-core`:

- `PERSONAL` — no platform fee, simplest possible P2P wallet.
- `MONETIZED` — a configurable `RevenueStrategy` charges a fee on Pay flows, split between the app
  owner and Ishtaran's own platform fee — see `apps/web/src/pages/revenue/RevenuePage.tsx` for how
  the app owner's own wallet balance and Ledger revenue balance are shown, clearly separated.

## Known gaps

See [`GAPS.md`](GAPS.md) for every real platform limitation found while building this app — from
domain rules (a Settlement needs its own confirmed funding source) to fixed-during-this-project
bugs (the simulated wallet balance not being credited on a real Settlement confirmation) — each one
confirmed live against Sandbox or in the platform's own source, never invented or assumed.

## This is a reference project, not a production deployment

- The browser-local key storage, the deterministic bootstrap password, and the timestamp-based
  Organization namespacing are demo conveniences — replace all three before running this pattern
  against Production.
- Production blockchain execution is not available on Ishtaran yet — see the
  [`@ishtaran/sdk` README](https://github.com/taylorjeftedasilva/ishtaran-node#production-status).

## Learn more

- [Ishtaran documentation](https://ishtaran.com/docs/intro)
- [TypeScript SDK](https://github.com/taylorjeftedasilva/ishtaran-node)
- [Mercatto — Marketplace Multi-Seller Business Case](https://github.com/taylorjeftedasilva/ishtaran-mercatto-example) — the other official reference project, showing escrowed multi-party Settlement/Split instead of a wallet's own self-custody flows
