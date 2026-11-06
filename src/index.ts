import { config } from './config';
import { initDatabase, db, getDatabaseStatus, markDatabaseUnavailable } from './database';
import { createBotRuntime } from './bot';
import { attachRuntime, broadcast, startWebServer } from './web';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function maintainDatabase(): Promise<void> {
  let delay = 5000;
  while (true) {
    try {
      if (!getDatabaseStatus().available) {
        console.log('[PostgreSQL] Connecting to database...');
        await initDatabase();
        delay = 5000;
      } else {
        await db.query('SELECT 1');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markDatabaseUnavailable(error);
      console.error('[PostgreSQL] Connection/health check failed:', message);
      await sleep(delay);
      delay = Math.min(delay * 2, 60000);
      continue;
    }
    await sleep(30000);
  }
}

async function main(): Promise<void> {
  console.log('Starting ' + config.botName + ' dashboard...');

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
          firstPerson: true,
          viewDistance: config.viewer.distance
        });
        console.log('[Viewer] Internal viewer started; public route is /viewer/');
      } catch (error) {
        console.error('[Viewer] Could not start viewer:', error);
      }
    }
  );
  attachRuntime(runtime);

  await startWebServer();
  console.log('[Minecraft] Bot is stopped. Start it from the dashboard.');
  void maintainDatabase();

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
