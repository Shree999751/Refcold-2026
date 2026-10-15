import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { loadEngine } from './ml/engine.js';
import { trainAndSave } from './ml/train.js';
import { createStore } from './db/store.js';
import { Fleet } from './sim/fleet.js';
import { createApiRouter } from './routes/api.js';

async function main() {
  let engine = loadEngine(config.modelDir);
  if (!engine) {
    console.log('[model] No trained model found. Training now (about 10 seconds)...');
    await trainAndSave({ modelDir: config.modelDir });
    engine = loadEngine(config.modelDir);
  }
  console.log(`[model] Loaded models trained ${engine.trainedAt}`);

  const store = await createStore(config);
  const fleet = new Fleet({ engine, store, config });
  await fleet.init();
  fleet.start();
  fleet.setMaxListeners(100);

  const app = express();
  const corsOrigin =
    config.clientOrigin === '*'
      ? true
      : config.clientOrigin.split(',').map((s) => s.trim());
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', createApiRouter({ fleet, store, engine }));

  // Serve the production build of the React client if it exists.
  if (fs.existsSync(config.clientDist)) {
    console.log(`[server] Serving static client from: ${config.clientDist}`);
    app.use(express.static(config.clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  } else {
    console.warn(`[server] Client dist not found at: ${config.clientDist}`);
    app.get('/', (req, res) => {
      res.json({
        service: 'CryoSense API',
        status: 'online',
        message: 'Frontend build not found. Run npm run build to generate client/dist.',
        endpoints: {
          status: '/api/status',
          fleet: '/api/fleet',
          alerts: '/api/alerts'
        }
      });
    });
  }

  app.listen(config.port, () => {
    console.log(`[server] CryoSense API on http://localhost:${config.port}  (storage: ${store.mode})`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
