import dotenv from 'dotenv';
dotenv.config();
const num = (key: string, fallback: number) => { const value = Number(process.env[key]); return Number.isFinite(value) && value > 0 ? value : fallback; };
export const config = {
 botName: process.env.BOT_NAME || 'Lumi',
 minecraft: { host: process.env.MC_HOST || '127.0.0.1', port: num('MC_PORT',25565), username: process.env.MC_USERNAME || 'Lumi', auth: process.env.MC_AUTH || 'offline', version: process.env.MC_VERSION || '1.21.11' },
 web: { host: process.env.WEB_HOST || '0.0.0.0', port: num('WEB_PORT',3000), username: process.env.DASHBOARD_USERNAME || 'admin', password: process.env.DASHBOARD_PASSWORD || 'change-this-password' },
 viewer: { port: num('VIEWER_PORT',3001), distance: num('VIEWER_DISTANCE',8) },
 chatTimeout: num('MC_CHAT_TIMEOUT',180000), webChatTimeout: num('WEB_CHAT_TIMEOUT',300000), contextMessages: num('AI_CONTEXT_MESSAGES',10),
 aiEnabled: (process.env.AI_ENABLED || 'true').toLowerCase() !== 'false', dbPath: process.env.DB_PATH || './data/lumi.sqlite', encryptionKey: process.env.APP_ENCRYPTION_KEY || ''
};