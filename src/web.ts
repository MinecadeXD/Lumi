import express, { Request, Response, NextFunction } from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { Server } from 'socket.io';
import { config } from './config';
import {
  approveSuggestion, createMemory, createProvider, db, deleteMemory, deleteProvider,
  encryptSecret, getDatabaseStatus, listMemories, listPendingSuggestions, listProviders, rejectSuggestion,
  updateMemory, updateProvider
} from './database';
import { BotRuntime } from './bot';
import { getDefaultMode, setDefaultMode } from './chat';

const app = express();
const server = http.createServer(app);
const httpProxy = require('http-proxy');
const viewerProxy = httpProxy.createProxyServer({ target: 'http://127.0.0.1:' + config.viewer.port, ws: true, changeOrigin: true });
viewerProxy.on('error', (_error: Error, _req: Request, res: any) => {
  if (res && typeof res.writeHead === 'function') {
    if (!res.headersSent) res.writeHead(502);
    res.end('Viewer is starting or unavailable.');
  } else if (res && typeof res.destroy === 'function') res.destroy();
});
app.use(express.json({ limit: '64kb' }));
let runtime: BotRuntime | null = null;
const sessionSecret = crypto.createHash('sha256').update(config.web.password + ':' + config.encryptionKey).digest();
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
function token(): string {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = id + '.' + expires;
  return payload + '.' + crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex');
}
function valid(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 3 || !/^[a-f0-9]{64}$/i.test(parts[0]) || !/^\d+$/.test(parts[1]) || !/^[a-f0-9]{64}$/i.test(parts[2])) return false;
  const expires = Number(parts[1]);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', sessionSecret).update(parts[0] + '.' + parts[1]).digest();
  const supplied = Buffer.from(parts[2], 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
function requestToken(req: Request): string {
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)lumi_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}
function auth(req: Request, res: Response, next: NextFunction): void {
  if (!valid(requestToken(req))) { res.status(401).json({ error: 'Authentication required.' }); return; }
  next();
}
app.use('/viewer', auth, (req, res) => { req.url = req.originalUrl; viewerProxy.web(req, res); });
app.use(express.static(path.join(process.cwd(), 'public')));
server.on('upgrade', (req, socket, head) => {
  if (!req.url || !(req.url === '/viewer' || req.url.startsWith('/viewer/'))) return;
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)lumi_session=([^;]+)/);
  const value = match ? decodeURIComponent(match[1]) : '';
  if (!valid(value)) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  viewerProxy.ws(req, socket, head);
});
const io = new Server(server, { destroyUpgrade: false });

app.post('/api/login', (req, res) => {
  if (String(req.body?.username || '') !== config.web.username || String(req.body?.password || '') !== config.web.password) {
    res.status(401).json({ error: 'Incorrect username or password.' }); return;
  }
  res.setHeader('Set-Cookie', 'lumi_session=' + encodeURIComponent(token()) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + SESSION_MAX_AGE_SECONDS);
  res.json({ success: true });
});
app.post('/api/logout', auth, (_req, res) => {
  res.setHeader('Set-Cookie', 'lumi_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ success: true });
});
app.get('/api/system/status', auth, (_req, res) => res.json({ dashboard: 'online', database: getDatabaseStatus() }));

app.get('/api/status', auth, (_req, res) => {
  res.json({
    bot: runtime ? runtime.snapshot() : { connected: false, state: 'stopped', username: config.minecraft.username, health: null, food: null, position: null },
    chat: runtime?.chat?.getState() || null,
    aiEnabled: runtime?.chat?.isAIEnabled() ?? false,
    mode: runtime?.chat?.getMode() ?? getDefaultMode(),
    viewerPath: '/viewer/'
  });
});

app.post('/api/mode', auth, (req, res) => {
  const mode = req.body?.mode;
  if (mode !== 'manual' && mode !== 'automatic') { res.status(400).json({ error: 'Mode must be manual or automatic.' }); return; }
  setDefaultMode(mode);
  runtime?.chat?.setMode(mode);
  res.json({ success: true, mode, aiEnabled: mode === 'automatic' });
});

app.post('/api/bot/start', auth, async (_req, res) => {
  if (!runtime) { res.status(503).json({ error: 'Bot runtime is not ready.' }); return; }
  await runtime.start();
  res.json({ success: true, bot: runtime.snapshot() });
});
app.post('/api/bot/stop', auth, async (_req, res) => {
  if (!runtime) { res.status(503).json({ error: 'Bot runtime is not ready.' }); return; }
  await runtime.stop();
  res.json({ success: true, bot: runtime.snapshot() });
});
app.post('/api/bot/rejoin', auth, async (_req, res) => {
  if (!runtime) { res.status(503).json({ error: 'Bot runtime is not ready.' }); return; }
  await runtime.rejoin();
  res.json({ success: true, bot: runtime.snapshot() });
});

app.get('/api/providers', auth, async (_req, res) => res.json(await listProviders()));
app.post('/api/providers', auth, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0,60);
  const baseUrl = String(req.body?.baseUrl || '').trim();
  const model = String(req.body?.model || '').trim().slice(0,120);
  const apiKey = String(req.body?.apiKey || '').trim();
  const rawPriority = Number(req.body?.priority ?? 100);
  if (!name || !baseUrl.startsWith('https://') || !model || !apiKey) {
    res.status(400).json({ error: 'Name, HTTPS base URL, model and API key are required.' }); return;
  }
  const id = await createProvider({ name, baseUrl, model, encryptedKey: encryptSecret(apiKey), priority: Number.isFinite(rawPriority) ? rawPriority : 100 });
  res.json({ success: true, id });
});
app.patch('/api/providers/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: 'Invalid provider ID.' }); return; }
  const enabled = req.body?.enabled === undefined ? undefined : Boolean(req.body.enabled);
  const priorityValue = req.body?.priority === undefined ? undefined : Number(req.body.priority);
  await updateProvider(id, enabled, priorityValue !== undefined && Number.isFinite(priorityValue) ? priorityValue : undefined);
  res.json({ success: true });
});
app.delete('/api/providers/:id', auth, async (req, res) => { await deleteProvider(Number(req.params.id)); res.json({ success: true }); });

app.get('/api/memories', auth, async (_req, res) => res.json(await listMemories()));
app.post('/api/memories', auth, async (req, res) => {
  const content = String(req.body?.content || '').trim().slice(0,1000);
  if (!content) { res.status(400).json({ error: 'Memory cannot be empty.' }); return; }
  res.json({ success: true, id: await createMemory(content) });
});
app.patch('/api/memories/:id', auth, async (req, res) => {
  const content = String(req.body?.content || '').trim().slice(0,1000);
  if (!content) { res.status(400).json({ error: 'Memory cannot be empty.' }); return; }
  await updateMemory(Number(req.params.id), content); res.json({ success: true });
});
app.delete('/api/memories/:id', auth, async (req, res) => { await deleteMemory(Number(req.params.id)); res.json({ success: true }); });
app.get('/api/suggestions', auth, async (_req, res) => res.json(await listPendingSuggestions()));
app.post('/api/suggestions/:id/approve', auth, async (req, res) => {
  const replacement = req.body?.content === undefined ? undefined : String(req.body.content).trim().slice(0,1000);
  const ok = await approveSuggestion(Number(req.params.id), replacement);
  if (!ok) { res.status(404).json({ error: 'Suggestion not found or content is empty.' }); return; }
  res.json({ success: true });
});
app.post('/api/suggestions/:id/reject', auth, async (req, res) => { await rejectSuggestion(Number(req.params.id)); res.json({ success: true }); });

io.use((socket, next) => {
  const match = (socket.handshake.headers.cookie || '').match(/(?:^|;\s*)lumi_session=([^;]+)/);
  const value = match ? decodeURIComponent(match[1]) : '';
  if (valid(value)) next(); else next(new Error('Unauthorized'));
});
io.on('connection', socket => {
  if (!runtime) return;
  socket.emit('status', runtime.snapshot());
  socket.emit('aiState', { enabled: runtime.chat?.isAIEnabled() ?? false, mode: runtime.chat?.getMode() ?? getDefaultMode() });
  socket.emit('mode', { mode: runtime.chat?.getMode() ?? 'manual' });
  const sendInventory = () => {
    const bot = runtime?.bot;
    if (!bot) return;
    const slots = (bot.inventory?.slots || []).map((item: any) => item ? { name: item.name, count: item.count } : null);
    socket.emit('inventory', { slots, selected: bot.quickBarSlot ?? 0 });
  };
  const inventory = runtime.bot?.inventory;
  inventory?.on('updateSlot', sendInventory);
  socket.on('disconnect', () => inventory?.off('updateSlot', sendInventory));
  socket.on('control', (data: any) => {
    if ((runtime?.chat?.getMode() ?? getDefaultMode()) !== 'manual') { socket.emit('controlError', { message: 'Website controls are disabled in Automatic mode.' }); return; }
    if (typeof data?.key === 'string' && typeof data?.pressed === 'boolean') runtime?.movement?.setControl(data.key, data.pressed);
  });
  socket.on('look', (data: any) => {
    if ((runtime?.chat?.getMode() ?? getDefaultMode()) !== 'manual') return;
    const yaw = Number(data?.yaw);
    const pitch = Number(data?.pitch);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || pitch < -Math.PI / 2 || pitch > Math.PI / 2) return;
    try { void runtime?.bot?.look(yaw, pitch, true); } catch {}
  });
  socket.on('stop', () => {
    if (runtime?.chat?.getMode() !== 'manual') { socket.emit('controlError', { message: 'Website controls are disabled in Automatic mode.' }); return; }
    runtime?.movement?.stop();
  });
  socket.on('jump', () => {
    if (runtime?.chat?.getMode() !== 'manual') { socket.emit('controlError', { message: 'Website controls are disabled in Automatic mode.' }); return; }
    runtime?.movement?.jump();
  });
  socket.on('webChat', (data: any) => {
    const message = String(data?.message || '').trim();
    if (!message || message.length > 256) return;
    if (!runtime?.chat || !runtime.connected) { socket.emit('controlError', { message: 'Lumi is not connected to Minecraft.' }); return; }
    runtime.chat.sendFromDashboard(message);
  });
  socket.on('hotbar', (data: any) => {
    if (runtime?.chat?.getMode() !== 'manual') return;
    const slot = Number(data?.slot);
    const bot = runtime?.bot;
    if (!Number.isInteger(slot) || slot < 0 || slot > 8 || !bot) return;
    try { bot.setQuickBarSlot(slot); sendInventory(); }
    catch (error) { socket.emit('controlError', { message: error instanceof Error ? error.message : 'Could not select hotbar slot.' }); }
  });
  socket.on('dropHeld', () => {
    if (runtime?.chat?.getMode() !== 'manual') return;
    const bot = runtime?.bot;
    if (!bot?.heldItem) return;
    void bot.tossStack(bot.heldItem).then(sendInventory).catch(error => socket.emit('controlError', { message: error instanceof Error ? error.message : 'Could not drop item.' }));
  });
  socket.on('inventoryRequest', sendInventory);
  socket.on('inventoryClick', (data: any) => {
    if (runtime?.chat?.getMode() !== 'manual') return;
    const slot = Number(data?.slot);
    const bot = runtime?.bot;
    if (!Number.isInteger(slot) || slot < 9 || slot > 44 || !bot) return;
    void bot.clickWindow(slot, 0, 0).then(sendInventory).catch(error => socket.emit('controlError', { message: error instanceof Error ? error.message : 'Inventory action failed.' }));
  });
  socket.on('aiToggle', (data: any) => runtime?.chat?.setAIEnabled(Boolean(data?.enabled)));
});
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Web API]', error instanceof Error ? error.message : error);
  if (!res.headersSent) {
    const database = getDatabaseStatus();
    const unavailable = !database.available;
    res.status(unavailable ? 503 : 500).json({ error: unavailable ? 'Database is temporarily unavailable. Retry shortly.' : 'The request failed. Check the Lumi server logs.', database });
  }
});
export function attachRuntime(value: BotRuntime): void { runtime = value; }
export function broadcast(event: string, data: any): void { io.emit(event, data); }
export function startWebServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.web.port, config.web.host, () => {
      console.log('[Web] Dashboard listening on port ' + config.web.port);
      resolve();
    });
  });
}
