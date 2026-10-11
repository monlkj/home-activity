import { neon } from '@neondatabase/serverless';
let sql,ready;
export async function initialize(sql){
  await sql`CREATE TABLE IF NOT EXISTS home_families (id uuid PRIMARY KEY, code text UNIQUE NOT NULL, state jsonb NOT NULL, revision bigint NOT NULL DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS home_sessions (token_hash text PRIMARY KEY, family_id uuid NOT NULL REFERENCES home_families(id) ON DELETE CASCADE, member_id text NOT NULL, expires_at timestamptz NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS home_rate_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL)`;
}
export async function database(){
  if(!process.env.DATABASE_URL)throw Object.assign(Error('데이터베이스 연결이 필요합니다. Vercel Storage에서 Neon을 연결해 주세요.'),{status:503});
  if(!sql)sql=neon(process.env.DATABASE_URL);
  if(!ready)ready=initialize(sql).catch(error=>{ready=null;throw error;});
  await ready;return sql;
}
