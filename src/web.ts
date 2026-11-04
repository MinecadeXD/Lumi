import express, { Request, Response, NextFunction } from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { Server } from 'socket.io';
import { config } from './config';
import { db, encryptSecret } from './database';
import { BotRuntime } from './bot';

const app = express();
const server = http.createServer(app);
const httpProxy = require('http-proxy');
const viewerProxy = httpProxy.createProxyServer({
  target: 'http://127.0.0.1:' + config.viewer.port,
  ws: true,
  changeOrigin: true
});
viewerProxy.on('error', (_error: Error, _req: Request, res: any) => {
  if (res && typeof res.writeHead === 'function') {
    if (!res.headersSent) res.writeHead(502);
    res.end('Viewer is starting or unavailable.');
  } else if (res && typeof res.destroy === 'function') {
    res.destroy();
  }
});

app.use(express.json({ limit: '64kb' }));

let runtime: BotRuntime | null = null;
const sessions = new Set<string>();
const sessionSecret = crypto.createHash('sha256').update(config.web.password + ':' + config.encryptionKey).digest();
function token(): string {
  const id = crypto.randomBytes(32).toString('hex');
  return id + '.' + crypto.createHmac('sha256', sessionSecret).update(id).digest('hex');
}
function valid(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 2 || !sessions.has(parts[0])) return false;
  const expected = crypto.createHmac('sha256', sessionSecret).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1]);
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

// Viewer HTTP requests share the dashboard's authenticated session.
app.use('/viewer', auth, (req, res) => {
  req.url = req.originalUrl;
  viewerProxy.web(req, res);
});
app.use(express.static(path.join(process.cwd(), 'public')));

// Attach Socket.IO after the proxy upgrade listener and leave unrelated
// WebSocket paths available for the viewer's own Socket.IO server.
server.on('upgrade', (req, socket, head) => {
  if (!req.url || !(req.url === '/viewer' || req.url.startsWith('/viewer/'))) return;
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)lumi_session=([^;]+)/);
  const value = match ? decodeURIComponent(match[1]) : '';
  if (!valid(value)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  viewerProxy.ws(req, socket, head);
});
const io = new Server(server, { destroyUpgrade: false });

app.post('/api/login', (req, res) => {
  if (String(req.body?.username || '') !== config.web.username || String(req.body?.password || '') !== config.web.password) {
    res.status(401).json({ error: 'Incorrect username or password.' }); return;
  }
  const value = token();
  sessions.add(value.split('.')[0]);
  res.setHeader('Set-Cookie', 'lumi_session=' + encodeURIComponent(value) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800');
  res.json({ success: true });
});
app.post('/api/logout', auth, (req, res) => {
  sessions.delete(requestToken(req).split('.')[0]);
  res.setHeader('Set-Cookie', 'lumi_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ success: true });
});
app.get('/api/status', auth, (_req, res) => {
  const pos = runtime?.bot.entity?.position;
  res.json({
    bot: runtime ? { connected: runtime.connected, username: runtime.bot.username, health: runtime.bot.health, food: runtime.bot.food, position: pos ? { x: Number(pos.x.toFixed(2)), y: Number(pos.y.toFixed(2)), z: Number(pos.z.toFixed(2)) } : null } : { connected: false },
    chat: runtime?.chat.getState() || null,
    aiEnabled: runtime?.chat.isAIEnabled() ?? config.aiEnabled,
    viewerPath: '/viewer/'
  });
});

app.get('/api/providers', auth, (_req, res) => {
  res.json(db.prepare('SELECT id,name,base_url,model,enabled,priority,created_at FROM providers ORDER BY priority,id').all());
});
app.post('/api/providers', auth, (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  const baseUrl = String(req.body?.baseUrl || '').trim();
  const model = String(req.body?.model || '').trim().slice(0, 120);
  const apiKey = String(req.body?.apiKey || '').trim();
  const priority = Number(req.body?.priority || 100);
  if (!name || !baseUrl.startsWith('https://') || !model || !apiKey) {
    res.status(400).json({ error: 'Name, HTTPS base URL, model and API key are required.' }); return;
  }
  try {
    const result = db.prepare('INSERT INTO providers(name,base_url,model,encrypted_key,priority) VALUES(?,?,?,?,?)')
      .run(name, baseUrl, model, encryptSecret(apiKey), Number.isFinite(priority) ? priority : 100);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.patch('/api/providers/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (req.body?.enabled !== undefined) db.prepare('UPDATE providers SET enabled=? WHERE id=?').run(req.body.enabled ? 1 : 0, id);
  if (req.body?.priority !== undefined) db.prepare('UPDATE providers SET priority=? WHERE id=?').run(Number(req.body.priority) || 100, id);
  res.json({ success: true });
});
app.delete('/api/providers/:id', auth, (req, res) => {
  db.prepare('DELETE FROM providers WHERE id=?').run(Number(req.params.id));
  res.json({ success: true });
});

app.get('/api/memories', auth, (_req, res) => res.json(db.prepare('SELECT * FROM memories ORDER BY id DESC').all()));
app.post('/api/memories', auth, (req, res) => {
  const content = String(req.body?.content || '').trim().slice(0, 1000);
  if (!content) { res.status(400).json({ error: 'Memory cannot be empty.' }); return; }
  const result = db.prepare('INSERT INTO memories(content) VALUES(?)').run(content);
  res.json({ success: true, id: result.lastInsertRowid });
});
app.patch('/api/memories/:id', auth, (req, res) => {
  const content = String(req.body?.content || '').trim().slice(0, 1000);
  if (!content) { res.status(400).json({ error: 'Memory cannot be empty.' }); return; }
  db.prepare('UPDATE memories SET content=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, Number(req.params.id));
  res.json({ success: true });
});
app.delete('/api/memories/:id', auth, (req, res) => {
  db.prepare('DELETE FROM memories WHERE id=?').run(Number(req.params.id));
  res.json({ success: true });
});
app.get('/api/suggestions', auth, (_req, res) => res.json(db.prepare("SELECT * FROM memory_suggestions WHERE status='pending' ORDER BY id DESC").all()));
app.post('/api/suggestions/:id/approve', auth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT content FROM memory_suggestions WHERE id=? AND status='pending'").get(id) as { content: string } | undefined;
  if (!row) { res.status(404).json({ error: 'Suggestion not found.' }); return; }
  const content = String(req.body?.content || row.content).trim().slice(0, 1000);
  db.prepare('INSERT INTO memories(content) VALUES(?)').run(content);
  db.prepare("UPDATE memory_suggestions SET status='approved' WHERE id=?").run(id);
  res.json({ success: true });
});
app.post('/api/suggestions/:id/reject', auth, (req, res) => {
  db.prepare("UPDATE memory_suggestions SET status='rejected' WHERE id=?").run(Number(req.params.id));
  res.json({ success: true });
});

io.use((socket, next) => {
  const match = (socket.handshake.headers.cookie || '').match(/(?:^|;\s*)lumi_session=([^;]+)/);
  const value = match ? decodeURIComponent(match[1]) : '';
  if (valid(value)) next(); else next(new Error('Unauthorized'));
});
io.on('connection', socket => {
  if (!runtime) return;
  const pos = runtime.bot.entity?.position;
  socket.emit('status', { connected: runtime.connected, username: runtime.bot.username, health: runtime.bot.health, food: runtime.bot.food, position: pos ? { x: Number(pos.x.toFixed(2)), y: Number(pos.y.toFixed(2)), z: Number(pos.z.toFixed(2)) } : null });
  socket.emit('aiState', { enabled: runtime.chat.isAIEnabled() });
  socket.on('control', (data: any) => {
    if (typeof data?.key === 'string' && typeof data?.pressed === 'boolean') runtime?.movement.setControl(data.key, data.pressed);
  });
  socket.on('stop', () => runtime?.movement.stop());
  socket.on('jump', () => runtime?.movement.jump());
  socket.on('webChat', (data: any) => {
    const message = String(data?.message || '').trim();
    if (message && message.length <= 256) runtime?.chat.sendFromDashboard(message);
  });
  socket.on('aiToggle', (data: any) => runtime?.chat.setAIEnabled(Boolean(data?.enabled)));
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
