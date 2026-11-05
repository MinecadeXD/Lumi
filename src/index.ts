import { config } from './config';
import { initDatabase, db } from './database';
import { createBotRuntime } from './bot';
import { attachRuntime, broadcast, startWebServer } from './web';

async function main(): Promise<void> {
  console.log('Starting ' + config.botName + ' dashboard...');
  await initDatabase();
  await startWebServer();

  let viewerAvailable = false;
  let viewer: any = null;
  try {
    viewer = require('prismarine-viewer');
    viewerAvailable = typeof viewer.mineflayer === 'function';
    if (!viewerAvailable) console.warn('[Viewer] Mineflayer adapter not found in prismarine-viewer.');
  } catch (error) {
    console.error('[Viewer] Could not load viewer:', error);
  }

  const runtime = createBotRuntime(
    (event, payload) => broadcast(event, payload),
    bot => {
      if (!viewerAvailable) return;
      try {
        viewer.mineflayer(bot, {
          port: config.viewer.port,
          prefix: '/viewer',
          firstPerson: false,
          viewDistance: config.viewer.distance
        });
        console.log('[Viewer] Internal viewer started; public route is /viewer/');
      } catch (error) {
        console.error('[Viewer] Could not start viewer:', error);
      }
    }
  );
  attachRuntime(runtime);
  console.log('[Minecraft] Bot is stopped. Start it from the dashboard.');

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Stopping Lumi...');
    try { await runtime.stop(); } catch {}
    try { await db.end(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
main().catch(error => { console.error('[Fatal]', error); process.exit(1); });
