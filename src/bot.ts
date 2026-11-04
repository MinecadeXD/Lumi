import mineflayer, { Bot } from 'mineflayer';
import { config } from './config';
import { MovementController } from './movement';
import { ChatManager } from './chat';

export interface BotRuntime { bot: Bot; movement: MovementController; chat: ChatManager; connected: boolean; }
type Emitter = (event: string, payload: any) => void;

export function createBotRuntime(emit: Emitter): BotRuntime {
  const bot = mineflayer.createBot({
    host: config.minecraft.host, port: config.minecraft.port, username: config.minecraft.username,
    auth: config.minecraft.auth as any, version: config.minecraft.version
  });
  let connected = false;
  let authRetryTimer: NodeJS.Timeout | undefined;
  let authSequenceTimers: NodeJS.Timeout[] = [];
  const movement = new MovementController(bot);
  const chat = new ChatManager(bot, movement, emit);

  const sendAuthSequence = () => {
    const password = config.serverAuth.password;
    if (!password || !connected) return;
    // Deliberately send all three commands without trying to detect the plugin's auth state.
    const commands = ['/register ' + password, '/register ' + password, '/login ' + password];
    commands.forEach((command, index) => {
      const timer = setTimeout(() => {
        if (connected) bot.chat(command);
      }, index * 1500);
      authSequenceTimers.push(timer);
    });
    console.log('[Minecraft Auth] Sent configured authentication command sequence.');
  };

  bot.on('login', () => {
    connected = true;
    console.log('[Minecraft] Logged in as ' + bot.username);
    emit('status', status());
    if (config.serverAuth.password) {
      setTimeout(sendAuthSequence, 2000);
      authRetryTimer = setInterval(sendAuthSequence, config.serverAuth.retryInterval);
      console.log('[Minecraft Auth] Automatic auth sequence enabled; retry interval: ' + config.serverAuth.retryInterval + 'ms.');
    } else {
      console.warn('[Minecraft Auth] MC_SERVER_PASSWORD is not configured; automatic authentication is disabled.');
    }
  });
  bot.on('spawn', () => { connected = true; movement.stop(); console.log('[Minecraft] Spawned. Lumi is idle.'); emit('status', status()); });
  bot.on('health', () => emit('status', status()));
  bot.on('move', () => emit('position', status().position));
  bot.on('kicked', reason => { connected = false; console.error('[Minecraft] Kicked:', reason); emit('connectionError', { message: String(reason) }); emit('status', status()); });
  bot.on('end', () => {
    connected = false;
    if (authRetryTimer) clearInterval(authRetryTimer);
    authSequenceTimers.forEach(clearTimeout);
    authSequenceTimers = [];
    console.warn('[Minecraft] Disconnected. Exiting for process-manager restart.');
    emit('status', status());
    setTimeout(() => process.exit(1), 5000);
  });
  bot.on('error', error => { console.error('[Minecraft]', error.message); emit('connectionError', { message: error.message }); });
  function status(): any {
    const pos = bot.entity?.position;
    return { connected, username: bot.username, health: bot.health, food: bot.food, position: pos ? { x: Number(pos.x.toFixed(2)), y: Number(pos.y.toFixed(2)), z: Number(pos.z.toFixed(2)) } : null };
  }
  return { bot, movement, chat, get connected() { return connected; } };
}
