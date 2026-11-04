import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from './config';
const dir = path.dirname(config.dbPath); if (dir && dir !== '.') fs.mkdirSync(dir,{recursive:true});
export const db = new Database(config.dbPath); db.pragma('journal_mode = WAL');
db.exec('CREATE TABLE IF NOT EXISTS providers (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,base_url TEXT NOT NULL,model TEXT NOT NULL,encrypted_key TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,priority INTEGER NOT NULL DEFAULT 100);' +
'CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT,content TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);' +
'CREATE TABLE IF NOT EXISTS memory_suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT,content TEXT NOT NULL,status TEXT NOT NULL DEFAULT \'pending\',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);' +
'CREATE TABLE IF NOT EXISTS chat_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT NOT NULL,username TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);' +
'CREATE TABLE IF NOT EXISTS player_context (username TEXT PRIMARY KEY,first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,message_count INTEGER NOT NULL DEFAULT 0);');
function key(): Buffer { if (!/^[a-fA-F0-9]{64}$/.test(config.encryptionKey)) throw new Error('APP_ENCRYPTION_KEY must be 64 hexadecimal characters. Generate with openssl rand -hex 32'); return Buffer.from(config.encryptionKey,'hex'); }
export function encryptSecret(value: string): string { const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',key(),iv); const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return [iv,cipher.getAuthTag(),encrypted].map(v=>v.toString('base64')).join('.'); }
export function decryptSecret(value: string): string { const parts=value.split('.'); if(parts.length!==3) throw new Error('Invalid encrypted key.'); const [iv,tag,encrypted]=parts.map(v=>Buffer.from(v,'base64')); const decipher=crypto.createDecipheriv('aes-256-gcm',key(),iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8'); }
export function logChat(source:string,username:string,message:string):void { db.prepare('INSERT INTO chat_logs(source,username,message) VALUES(?,?,?)').run(source,username,message); }
export function touchPlayer(username:string):void { db.prepare('INSERT INTO player_context(username,message_count) VALUES(?,1) ON CONFLICT(username) DO UPDATE SET last_seen=CURRENT_TIMESTAMP,message_count=message_count+1').run(username); }