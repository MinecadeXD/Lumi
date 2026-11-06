import mineflayer, { Bot } from 'mineflayer';
import { config } from './config';
import { MovementController } from './movement';
import { ChatManager } from './chat';

export type BotState = 'stopped' | 'connecting' | 'online' | 'disconnecting' | 'error';
export interface BotRuntime {
  readonly bot: Bot | null;
  readonly movement: MovementController | null;
  readonly chat: ChatManager | null;
  readonly connected: boolean;
  readonly state: BotState;
  readonly error: string | null;
  snapshot(): any;
  start(): Promise<void>;
  stop(): Promise<void>;
  rejoin(): Promise<void>;
}
type Emitter = (event: string, payload: any) => void;
type SpawnHandler = (bot: Bot) => void;

export function createBotRuntime(emit: Emitter, onSpawn?: SpawnHandler): BotRuntime {
  let bot: Bot | null = null;
  let movement: MovementController | null = null;
  let chat: ChatManager | null = null;
  let state: BotState = 'stopped';
  let lastError: string | null = null;
  let authSequenceTimers: NodeJS.Timeout[] = [];
  let deathReconnectPending = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let operation: Promise<void> = Promise.resolve();

  const snapshot = () => {
    const pos = bot?.entity?.position;
    return {
      connected: state === 'online',
      state,
      error: lastError,
      username: bot?.username || config.minecraft.username,
      health: bot?.health ?? null,
      food: bot?.food ?? null,
      position: pos ? { x: Number(pos.x.toFixed(2)), y: Number(pos.y.toFixed(2)), z: Number(pos.z.toFixed(2)) } : null
    };
  };
  const publish = () => emit('status', snapshot());
  const clearAuthTimers = () => {
    authSequenceTimers.forEach(clearTimeout);
    authSequenceTimers = [];
  };

  const doStop = async (): Promise<void> => {
    const current = bot;
    if (!current) {
      state = 'stopped';
      publish();
      return;
    }
    state = 'disconnecting';
    deathReconnectPending = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    clearAuthTimers();
    try { movement?.stop(); } catch {}
    try { (current as any).viewer?.close?.(); } catch (error) { console.warn('[Viewer] Could not close viewer:', error); }
    publish();

    await new Promise<void>(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      current.once('end', finish);
      const timeout = setTimeout(() => {
        try { current.end('Stopped from Lumi dashboard'); } catch {}
        setTimeout(finish, 1000);
      }, 5000);
      try { current.quit('Stopped from Lumi dashboard'); }
      catch { try { current.end('Stopped from Lumi dashboard'); } catch {} }
    });

    if (bot === current) {
      bot = null;
      movement = null;
      chat = null;
    }
    if (state === 'disconnecting') state = 'stopped';
    publish();
  };

  const doStart = async (): Promise<void> => {
    if (bot && (state === 'connecting' || state === 'online')) return;
    if (bot) await doStop();

    lastError = null;
    state = 'connecting';
    publish();
    console.log('[Minecraft] Starting a new connection...');
    try {
      const current = mineflayer.createBot({
        host: config.minecraft.host,
        port: config.minecraft.port,
        username: config.minecraft.username,
        auth: config.minecraft.auth as any,
        version: config.minecraft.version
      });

      // Minecraft 26.3 requires client_tick_end after movement packets.
      // Mineflayer 4.39.0 does not emit it, which can cause Paper 26.3 to
      // reject the connection after movement starts. ViaVersion/ViaBackwards
      // should forward this packet. Older protocols without tick_end simply
      // reject the write; that compatibility case is intentionally ignored.
      const protocolClient = (current as any)._client;
      if (protocolClient && typeof protocolClient.write === 'function') {
        const originalWrite = protocolClient.write.bind(protocolClient);
        const movementPackets = new Set(['position', 'position_look', 'look', 'flying']);
        protocolClient.write = (name: string, packet: any) => {
          const result = originalWrite(name, packet);
          if (movementPackets.has(name)) {
            try {
              originalWrite('tick_end', {});
            } catch {
              // The packet is not defined by older Minecraft protocols.
            }
          }
          return result;
        };
        console.log('[Minecraft] Installed client_tick_end compatibility patch.');
      } else {
        console.warn('[Minecraft] Could not install client_tick_end compatibility patch.');
      }

      bot = current;
      movement = new MovementController(current);
      chat = new ChatManager(current, movement, emit);
      let authSequenceStarted = false;

      const scheduleAuthSequence = () => {
        const password = config.serverAuth.password;
        if (!password || authSequenceStarted || bot !== current) return;
        authSequenceStarted = true;
        const commands = ['/register ' + password, '/register ' + password, '/login ' + password];
        commands.forEach((command, index) => {
          const timer = setTimeout(() => {
            if (bot === current && state === 'online') {
              try {
                current.chat(command);
                console.log('[Minecraft Auth] Sent authentication command ' + (index + 1) + '/3.');
              } catch (error) {
                console.error('[Minecraft Auth] Could not send command:', error instanceof Error ? error.message : error);
              }
            }
          }, 10000 + index * 5000);
          authSequenceTimers.push(timer);
        });
        console.log('[Minecraft Auth] One-time authentication sequence scheduled after spawn.');
      };

      current.on('login', () => {
        if (bot !== current) return;
        console.log('[Minecraft] Logged in as ' + current.username);
        publish();
        if (!config.serverAuth.password) console.warn('[Minecraft Auth] MC_SERVER_PASSWORD is not configured; automatic authentication is disabled.');
      });
      current.on('spawn', () => {
        if (bot !== current) return;
        deathReconnectPending = false;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        state = 'online';
        console.log('[Minecraft] Spawned. Lumi is idle.');
        movement?.stop();
        publish();
        scheduleAuthSequence();
        try { onSpawn?.(current); } catch (error) { console.error('[Viewer] Could not start viewer:', error); }
      });
      current.on('death', () => {
        if (bot !== current || state === 'disconnecting') return;
        deathReconnectPending = true;
        movement?.stop();
        console.warn('[Minecraft] Lumi died. Waiting for the server respawn.');
        publish();
        // Mineflayer normally respawns automatically. This is a delayed fallback
        // for servers/protocol paths that leave the bot on the death screen.
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (bot !== current || !deathReconnectPending || state !== 'online') return;
          try { current.respawn(); }
          catch (error) { console.warn('[Minecraft] Respawn request failed:', error); }
        }, 8000);
      });
      current.on('health', () => { if (bot === current) publish(); });
      current.on('move', () => { if (bot === current) emit('position', snapshot().position); });
      current.on('kicked', reason => {
        if (bot !== current) return;
        lastError = 'Kicked: ' + String(reason);
        state = 'error';
        console.error('[Minecraft]', lastError);
        emit('connectionError', { message: lastError });
        publish();
      });
      current.on('end', () => {
        if (bot !== current) return;
        clearAuthTimers();
        try { (current as any).viewer?.close?.(); } catch {}
        bot = null;
        movement = null;
        chat = null;
        if (state !== 'disconnecting') {
          const reconnectAfterDeath = deathReconnectPending;
          state = reconnectAfterDeath ? 'connecting' : 'error';
          lastError = reconnectAfterDeath ? 'Connection dropped after death. Reconnecting…' : (lastError || 'Minecraft connection closed unexpectedly. You can rejoin from the dashboard.');
          console.warn('[Minecraft]', lastError);
          if (reconnectAfterDeath) {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              if (!bot && state === 'connecting') void enqueue(doStart);
            }, 3000);
          }
        } else {
          state = 'stopped';
          console.log('[Minecraft] Disconnected by dashboard.');
        }
        publish();
      });
      current.on('error', error => {
        if (bot !== current) return;
        lastError = error.message;
        console.error('[Minecraft]', error.message);
        emit('connectionError', { message: error.message });
        publish();
      });
    } catch (error) {
      bot = null;
      movement = null;
      chat = null;
      state = 'error';
      lastError = error instanceof Error ? error.message : String(error);
      console.error('[Minecraft] Could not start:', lastError);
      publish();
    }
  };

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const next = operation.then(task, task);
    operation = next.catch(() => undefined);
    return next;
  };

  return {
    get bot() { return bot; },
    get movement() { return movement; },
    get chat() { return chat; },
    get connected() { return state === 'online'; },
    get state() { return state; },
    get error() { return lastError; },
    snapshot,
    start: () => enqueue(doStart),
    stop: () => enqueue(doStop),
    rejoin: () => enqueue(async () => { await doStop(); await new Promise(resolve => setTimeout(resolve, 1200)); await doStart(); })
  };
}
