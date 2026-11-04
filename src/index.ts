import { config } from './config';
import { createBotRuntime } from './bot';
import { attachRuntime, broadcast, startWebServer } from './web';

async function main(): Promise<void> {
  console.log('Starting ' + config.botName + '...');
  await startWebServer();
  const runtime = createBotRuntime((event, payload) => broadcast(event, payload));
  attachRuntime(runtime);

  try {
    const viewer = require('prismarine-viewer');
    if (typeof viewer.mineflayer === 'function') {
      runtime.bot.once('spawn', () => {
        try {
          viewer.mineflayer(runtime.bot, { port: config.viewer.port, firstPerson: false, viewDistance: config.viewer.distance });
          console.log('[Viewer] Started on port ' + config.viewer.port);
        } catch (error) { console.error('[Viewer]', error); }
      });
    } else console.warn('[Viewer] Mineflayer adapter not found in prismarine-viewer.');
  } catch (error) { console.error('[Viewer] Could not load viewer:', error); }

  process.on('SIGINT', () => { console.log('Stopping Lumi...'); try { runtime.bot.quit('Shutdown'); } catch {} process.exit(0); });
  process.on('SIGTERM', () => { try { runtime.bot.quit('Shutdown'); } catch {} process.exit(0); });
}
main().catch(error => { console.error('[Fatal]', error); process.exit(1); });