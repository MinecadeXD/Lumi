import type { Bot } from 'mineflayer';
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const goals = require('mineflayer-pathfinder').goals;

export class MovementController {
  constructor(private bot: Bot) {
    this.bot.loadPlugin(pathfinder);
    this.bot.once('spawn', () => this.stop());
  }
  stop(): void {
    try { (this.bot as any).pathfinder?.setGoal(null); } catch {}
    for (const key of ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint']) this.bot.setControlState(key as any, false);
  }
  comeHere(username: string): boolean {
    const entity = this.bot.players[username]?.entity;
    if (!entity) return false;
    (this.bot as any).pathfinder.setGoal(new goals.GoalNear(Math.floor(entity.position.x), Math.floor(entity.position.y), Math.floor(entity.position.z), 1));
    return true;
  }
  goto(x: number, y: number, z: number): void { (this.bot as any).pathfinder.setGoal(new goals.GoalNear(x, y, z, 1)); }
  follow(username: string): boolean {
    const entity = this.bot.players[username]?.entity;
    if (!entity) return false;
    (this.bot as any).pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
    return true;
  }
  jump(): void { this.bot.setControlState('jump', true); setTimeout(() => this.bot.setControlState('jump', false), 450); }
  setControl(key: string, pressed: boolean): void {
    if (!['forward', 'back', 'left', 'right', 'jump', 'sneak'].includes(key)) return;
    if (pressed && ['forward', 'back', 'left', 'right'].includes(key)) (this.bot as any).pathfinder?.setGoal(null);
    this.bot.setControlState(key as any, pressed);
  }
  command(message: string, username: string): string | null {
    const name = this.bot.username;
    if (!message.toLowerCase().startsWith(name.toLowerCase() + ' ')) return null;
    const cmd = message.trim().slice(name.length).trim();
    const lower = cmd.toLowerCase();
    if (lower === 'come here' || lower === 'come to me') return this.comeHere(username) ? 'On my way, ' + username + '!' : 'I cannot see you right now.';
    if (lower === 'follow me') return this.follow(username) ? 'Okay, I will follow you!' : 'I cannot see you right now.';
    if (lower === 'stop' || lower === 'stay') { this.stop(); return lower === 'stay' ? 'I will stay here.' : 'Stopped.'; }
    if (lower === 'jump') { this.jump(); return 'Boing!'; }
    if (lower === 'sneak') { const next = !this.bot.getControlState('sneak'); this.bot.setControlState('sneak', next); return next ? 'Sneaking.' : 'Stopped sneaking.'; }
    const match = lower.match(/^goto\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
    if (match) {
      const [x, y, z] = match.slice(1).map(Number);
      if (Math.abs(x) > 30000000 || Math.abs(z) > 30000000 || y < -2048 || y > 2048) return 'Those coordinates are outside the allowed range.';
      this.goto(x, y, z); return 'Heading to ' + x + ' ' + y + ' ' + z + '.';
    }
    return null;
  }
}