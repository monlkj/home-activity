import { neon } from "@neondatabase/serverless";
let sql, ready;
export async function initialize(sql) {
  await sql`CREATE TABLE IF NOT EXISTS home_families (id uuid PRIMARY KEY, code text UNIQUE NOT NULL, state jsonb NOT NULL, revision bigint NOT NULL DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS home_sessions (token_hash text PRIMARY KEY, family_id uuid NOT NULL REFERENCES home_families(id) ON DELETE CASCADE, member_id text NOT NULL, expires_at timestamptz NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS home_rate_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS home_accounts (id uuid PRIMARY KEY, username text UNIQUE NOT NULL, name text NOT NULL, password jsonb NOT NULL, approval_password jsonb, created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS home_account_sessions (token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES home_accounts(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS home_rooms (family_id uuid PRIMARY KEY REFERENCES home_families(id) ON DELETE CASCADE, name text NOT NULL, owner_id uuid NOT NULL REFERENCES home_accounts(id))`;
  await sql`CREATE TABLE IF NOT EXISTS home_invitations (id uuid PRIMARY KEY, family_id uuid NOT NULL REFERENCES home_rooms(family_id) ON DELETE CASCADE, account_id uuid NOT NULL REFERENCES home_accounts(id), inviter_id uuid NOT NULL REFERENCES home_accounts(id), can_approve boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS home_pending_invitation ON home_invitations(family_id,account_id) WHERE status='pending'`;
}
export async function database() {
  if (!process.env.DATABASE_URL)
    throw Object.assign(
      Error(
        "데이터베이스 연결이 필요합니다. Vercel Storage에서 Neon을 연결해 주세요.",
      ),
      { status: 503 },
    );
  if (!sql) sql = neon(process.env.DATABASE_URL);
  if (!ready)
    ready = initialize(sql).catch((error) => {
      ready = null;
      throw error;
    });
  await ready;
  return sql;
}
