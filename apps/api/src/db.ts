// The App Database -- a read-model/projection layer only (wallet-core/src/types.ts,
// IMPLEMENTATION_PLAN.md Fase B/K). Never the economic source of truth: every balance/state
// figure ultimately traces back to a live Ishtaran read. SQLite via the Node built-in
// `node:sqlite` module -- no native addon, nothing to compile, matches this reference project's
// "no infra weight it doesn't need" principle.
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      account_holder_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      -- GAPS.md G.8 -- the user's own self-custody wallet address (what they signed up with as
      -- destinationAddress). NOT the source of truth for their balance (that's the real Sandbox/
      -- chain state, queried live via WalletBalanceProvider, never cached here) -- stored only so
      -- an incoming wallet-to-wallet transfer's recipient can be resolved back to an app_user for
      -- History, and so a session can resolve "my own address" without the client resending it.
      wallet_address TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_requests (
      id TEXT PRIMARY KEY,
      requester_account_id TEXT NOT NULL,
      requester_user_id TEXT NOT NULL,
      amount TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      transaction_id TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transaction_views (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      ishtaran_transaction_id TEXT,
      settlement_id TEXT,
      withdrawal_id TEXT,
      refund_id TEXT,
      account_id TEXT NOT NULL,
      counterparty_label TEXT,
      amount TEXT NOT NULL,
      app_fee TEXT,
      network_fee TEXT,
      status TEXT NOT NULL,
      technical_reference TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revenue_events (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      settlement_id TEXT,
      rule_event TEXT NOT NULL,
      amount TEXT NOT NULL,
      app_revenue_account_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      delivery_id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transaction_views_account_id ON transaction_views(account_id);
    CREATE INDEX IF NOT EXISTS idx_payment_requests_requester ON payment_requests(requester_account_id);
    CREATE INDEX IF NOT EXISTS idx_app_users_wallet_address ON app_users(wallet_address);
  `);

  // GAPS.md G.8 -- demo_wallets/demo_wallet_debits (the local fake economy, GAPS.md G.5) are
  // removed for real, not just unused: the wallet's authoritative balance now lives in Ishtaran's
  // own Sandbox (SandboxWalletBalance, queried live via WalletBalanceProvider), never in this
  // App Database. A pre-existing local dev database may still have these tables from before this
  // migration -- drop them so no stale financial figure can ever be read from here again.
  db.exec('DROP TABLE IF EXISTS demo_wallets;');
  db.exec('DROP TABLE IF EXISTS demo_wallet_debits;');

  // wallet_address existed as a column only from this migration onward -- add it if missing on an
  // already-created app_users table (SQLite has no `ADD COLUMN IF NOT EXISTS`).
  const columns = db.prepare("PRAGMA table_info(app_users)").all() as { name: string }[];
  if (!columns.some((c) => c.name === 'wallet_address')) {
    db.exec('ALTER TABLE app_users ADD COLUMN wallet_address TEXT;');
  }
}
