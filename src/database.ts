import fs from 'node:fs';
import crypto from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { config } from './config';

if (!config.databaseUrl) throw new Error('DATABASE_URL is required. Configure the PieGres connection string in PieApp environment variables.');

export const db = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
db.on('error', error => console.error('[PostgreSQL] Idle client error:', error.message));

export async function initDatabase(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS providers (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL,
      encrypted_key TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
      priority INTEGER NOT NULL DEFAULT 100, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS memories (
      id SERIAL PRIMARY KEY, content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS memory_suggestions (
      id SERIAL PRIMARY KEY, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chat_logs (
      id SERIAL PRIMARY KEY, source TEXT NOT NULL, username TEXT NOT NULL, message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS player_context (
      username TEXT PRIMARY KEY, first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), message_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS chat_logs_created_at_idx ON chat_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS memory_suggestions_pending_idx ON memory_suggestions(status,id DESC);
  `);
  await importExistingSqlite();
  console.log('[PostgreSQL] Database ready.');
}

async function importExistingSqlite(): Promise<void> {
  if (!config.dbPath || !fs.existsSync(config.dbPath)) return;
  const migrationId = 'sqlite-to-postgres-v1';
  if ((await db.query('SELECT 1 FROM schema_migrations WHERE id=$1', [migrationId])).rowCount) return;
  let SQLite: any;
  try { SQLite = require('better-sqlite3'); }
  catch (error) { console.warn('[PostgreSQL] SQLite file found but import driver is unavailable.', error); return; }
  const sqlite = new SQLite(config.dbPath, { readonly: true, fileMustExist: true });
  const client: PoolClient = await db.connect();
  try {
    await client.query('BEGIN');
    if ((await client.query('SELECT 1 FROM schema_migrations WHERE id=$1 FOR UPDATE', [migrationId])).rowCount) {
      await client.query('ROLLBACK'); return;
    }
    const has = (name: string) => Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    if (has('providers')) for (const r of sqlite.prepare('SELECT id,name,base_url,model,encrypted_key,enabled,priority FROM providers').all()) {
      await client.query('INSERT INTO providers(id,name,base_url,model,encrypted_key,enabled,priority) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING', [r.id,r.name,r.base_url,r.model,r.encrypted_key,Boolean(r.enabled),r.priority]);
    }
    if (has('memories')) for (const r of sqlite.prepare('SELECT id,content,created_at,updated_at FROM memories').all()) {
      await client.query('INSERT INTO memories(id,content,created_at,updated_at) VALUES($1,$2,COALESCE($3::timestamptz,NOW()),COALESCE($4::timestamptz,NOW())) ON CONFLICT(id) DO NOTHING', [r.id,r.content,r.created_at,r.updated_at]);
    }
    if (has('memory_suggestions')) for (const r of sqlite.prepare('SELECT id,content,status,created_at FROM memory_suggestions').all()) {
      await client.query('INSERT INTO memory_suggestions(id,content,status,created_at) VALUES($1,$2,$3,COALESCE($4::timestamptz,NOW())) ON CONFLICT(id) DO NOTHING', [r.id,r.content,r.status,r.created_at]);
    }
    if (has('chat_logs')) for (const r of sqlite.prepare('SELECT id,source,username,message,created_at FROM chat_logs').all()) {
      await client.query('INSERT INTO chat_logs(id,source,username,message,created_at) VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,NOW())) ON CONFLICT(id) DO NOTHING', [r.id,r.source,r.username,r.message,r.created_at]);
    }
    if (has('player_context')) for (const r of sqlite.prepare('SELECT username,first_seen,last_seen,message_count FROM player_context').all()) {
      await client.query('INSERT INTO player_context(username,first_seen,last_seen,message_count) VALUES($1,COALESCE($2::timestamptz,NOW()),COALESCE($3::timestamptz,NOW()),$4) ON CONFLICT(username) DO NOTHING', [r.username,r.first_seen,r.last_seen,r.message_count]);
    }
    for (const table of ['providers','memories','memory_suggestions','chat_logs']) {
      await client.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}),1),1), EXISTS(SELECT 1 FROM ${table}))`);
    }
    await client.query('INSERT INTO schema_migrations(id) VALUES($1) ON CONFLICT(id) DO NOTHING', [migrationId]);
    await client.query('COMMIT');
    console.log('[PostgreSQL] Imported existing SQLite data; original SQLite file was left untouched.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); sqlite.close(); }
}

function encryptionKey(): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(config.encryptionKey)) throw new Error('APP_ENCRYPTION_KEY must be 64 hexadecimal characters. Generate it with: openssl rand -hex 32');
  return Buffer.from(config.encryptionKey, 'hex');
}
export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(part => part.toString('base64')).join('.');
}
export function decryptSecret(value: string): string {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted key.');
  const [iv,tag,encrypted] = parts.map(part => Buffer.from(part,'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8');
}
export async function logChat(source:string,username:string,message:string):Promise<void> {
  await db.query('INSERT INTO chat_logs(source,username,message) VALUES($1,$2,$3)',[source,username,message]);
}
export async function touchPlayer(username:string):Promise<void> {
  await db.query('INSERT INTO player_context(username,message_count) VALUES($1,1) ON CONFLICT(username) DO UPDATE SET last_seen=NOW(),message_count=player_context.message_count+1',[username]);
}
export async function getEnabledProviders():Promise<any[]> {
  return (await db.query('SELECT * FROM providers WHERE enabled=TRUE ORDER BY priority ASC,id ASC')).rows;
}
export async function listProviders():Promise<any[]> {
  return (await db.query('SELECT id,name,base_url,model,enabled,priority,created_at FROM providers ORDER BY priority,id')).rows;
}
export async function createProvider(v:{name:string;baseUrl:string;model:string;encryptedKey:string;priority:number}):Promise<number> {
  const r=await db.query('INSERT INTO providers(name,base_url,model,encrypted_key,priority) VALUES($1,$2,$3,$4,$5) RETURNING id',[v.name,v.baseUrl,v.model,v.encryptedKey,v.priority]);
  return Number(r.rows[0].id);
}
export async function updateProvider(id:number,enabled:boolean|undefined,priority:number|undefined):Promise<void> {
  await db.query('UPDATE providers SET enabled=COALESCE($2,enabled),priority=COALESCE($3,priority) WHERE id=$1',[id,enabled??null,priority??null]);
}
export async function deleteProvider(id:number):Promise<void> { await db.query('DELETE FROM providers WHERE id=$1',[id]); }
export async function listMemories():Promise<any[]> { return (await db.query('SELECT * FROM memories ORDER BY id DESC')).rows; }
export async function getApprovedMemories():Promise<string[]> { return (await db.query('SELECT content FROM memories ORDER BY id ASC')).rows.map(r=>r.content); }
export async function createMemory(content:string):Promise<number> {
  const r=await db.query('INSERT INTO memories(content) VALUES($1) RETURNING id',[content]); return Number(r.rows[0].id);
}
export async function updateMemory(id:number,content:string):Promise<void> { await db.query('UPDATE memories SET content=$1,updated_at=NOW() WHERE id=$2',[content,id]); }
export async function deleteMemory(id:number):Promise<void> { await db.query('DELETE FROM memories WHERE id=$1',[id]); }
export async function listPendingSuggestions():Promise<any[]> {
  return (await db.query("SELECT * FROM memory_suggestions WHERE status='pending' ORDER BY id DESC")).rows;
}
export async function addSuggestionIfNew(content:string):Promise<number|null> {
  const r=await db.query("INSERT INTO memory_suggestions(content) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM memories WHERE lower(content)=lower($1)) AND NOT EXISTS (SELECT 1 FROM memory_suggestions WHERE lower(content)=lower($1) AND status='pending') RETURNING id",[content]);
  return r.rowCount ? Number(r.rows[0].id) : null;
}
export async function approveSuggestion(id:number,replacement?:string):Promise<boolean> {
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    const found=await client.query("SELECT content FROM memory_suggestions WHERE id=$1 AND status='pending' FOR UPDATE",[id]);
    if (!found.rowCount) { await client.query('ROLLBACK'); return false; }
    const content=(replacement||found.rows[0].content).trim().slice(0,1000);
    if (!content) { await client.query('ROLLBACK'); return false; }
    await client.query('INSERT INTO memories(content) VALUES($1)',[content]);
    await client.query("UPDATE memory_suggestions SET status='approved' WHERE id=$1",[id]);
    await client.query('COMMIT'); return true;
  } catch(error) { await client.query('ROLLBACK').catch(()=>undefined); throw error; }
  finally { client.release(); }
}
export async function rejectSuggestion(id:number):Promise<void> {
  await db.query("UPDATE memory_suggestions SET status='rejected' WHERE id=$1",[id]);
}
