import type { Bot } from 'mineflayer';
import { AIManager, Message } from './ai';
import { config } from './config';
import { addSuggestionIfNew, getApprovedMemories, logChat, touchPlayer } from './database';
import { MovementController } from './movement';
type Emitter = (event: string, payload: any) => void;
let defaultMode: 'manual' | 'automatic' = 'manual';
export function getDefaultMode(): 'manual' | 'automatic' { return defaultMode; }
export function setDefaultMode(mode: 'manual' | 'automatic'): void { defaultMode = mode; }
export class ChatManager {
  private ai = new AIManager();
  private history: Message[] = [];
  private sessionUntil = 0;
  private webListenUntil = 0;
  private queue: Promise<void> = Promise.resolve();
  private aiEnabled = false;
  private mode: 'manual' | 'automatic' = 'manual';
  constructor(private bot: Bot, private movement: MovementController, private emit: Emitter) {
    this.mode = defaultMode;
    this.aiEnabled = defaultMode === 'automatic';
    this.bot.on('chat', (username, message) => this.onMinecraftChat(username, message));
  }
  private persist(task: Promise<void>): void { void task.catch(error => console.error('[Database]', error instanceof Error ? error.message : error)); }
  setMode(mode: 'manual' | 'automatic'): void {
    defaultMode = mode;
    this.mode = mode;
    this.aiEnabled = mode === 'automatic';
    this.emit('aiState', { enabled: this.aiEnabled, mode: this.mode });
    this.emit('mode', { mode: this.mode });
  }
  getMode(): 'manual' | 'automatic' { return this.mode; }
  setAIEnabled(enabled: boolean): void {
    if (this.mode !== 'automatic') return;
    this.aiEnabled = enabled;
    this.emit('aiState', { enabled, mode: this.mode });
  }
  isAIEnabled(): boolean { return this.aiEnabled; }
  private onMinecraftChat(username: string, message: string): void {
    if (!message || username === this.bot.username) return;
    this.persist(logChat('minecraft', username, message));
    this.persist(touchPlayer(username));
    const webListening = Date.now() < this.webListenUntil;
    if (webListening) this.emit('webIncoming', { source: 'minecraft', username, message, time: new Date().toISOString() });
    // Movement is strictly opt-in: only the five whitelisted commands addressed
    // to Lumi are parsed, and only while Automatic mode is active.
    if (this.mode === 'automatic') {
      const commandResponse = this.movement.command(message, username);
      if (commandResponse) { this.sendBotMessage(commandResponse); return; }
    }
    if (!this.aiEnabled || this.mode !== 'automatic') return;
    const name = this.bot.username.toLowerCase();
    const lower = message.toLowerCase();
    const mentionIndex = lower.indexOf(name);
    const mentioned = mentionIndex !== -1;
    const active = Date.now() < this.sessionUntil;
    if (!mentioned && (webListening || !active)) return;
    const cleaned = mentioned
      ? (message.slice(0, mentionIndex) + message.slice(mentionIndex + this.bot.username.length)).replace(/^[\\s,:-]+|[\\s,:-]+$/g, '').trim()
      : message.trim();
    this.sessionUntil = Date.now() + config.chatTimeout;
    this.emit('conversationState', { active: true, expiresAt: this.sessionUntil });
    this.enqueueAI(username, cleaned || message);
  }
  private enqueueAI(username: string, message: string): void {
    this.queue = this.queue.then(async () => {
      this.history.push({ role: 'user', content: '[' + username + ']: ' + message });
      try {
        const memories = await getApprovedMemories();
        const result = await this.ai.reply(this.history, memories, username, message);
        this.history.push({ role: 'assistant', content: result.reply });
        this.history = this.history.slice(-config.contextMessages);
        this.sessionUntil = Date.now() + config.chatTimeout;
        this.emit('conversationState', { active: true, expiresAt: this.sessionUntil });
        this.sendBotMessage(result.reply);
        this.emit('aiResponse', { provider: result.provider, model: result.model });
        for (const suggestion of result.suggestions) {
          const id = await addSuggestionIfNew(suggestion);
          if (id !== null) this.emit('memorySuggestion', { id, content: suggestion });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error('[Lumi AI]', reason);
        this.sendBotMessage('I cannot reach my AI right now. Please try again in a moment.');
        this.emit('aiError', { message: reason });
      }
    }).catch(error => console.error('[Chat queue]', error));
  }
  private sendBotMessage(message: string): void {
    this.bot.chat(message);
    this.persist(logChat('bot', this.bot.username, message));
    this.emit('chat', { source: 'bot', username: this.bot.username, message, time: new Date().toISOString() });
  }
  sendFromDashboard(message: string): void {
    const text = message.trim().slice(0, 256);
    if (!text) return;
    this.bot.chat(text);
    this.webListenUntil = Date.now() + config.webChatTimeout;
    this.persist(logChat('dashboard', 'Dashboard', text));
    this.emit('chat', { source: 'dashboard', username: 'Dashboard', message: text, time: new Date().toISOString() });
    this.emit('webListenState', { active: true, expiresAt: this.webListenUntil });
  }
  getState(): any {
    return { aiEnabled: this.aiEnabled, conversationActive: Date.now() < this.sessionUntil, conversationExpiresAt: this.sessionUntil, webListening: Date.now() < this.webListenUntil, webListenExpiresAt: this.webListenUntil, contextMessages: this.history.length };
  }
}
