import { serve } from '@hono/node-server';
import { migrate } from './scripts/migrate.ts';
import { createApp } from './app.ts';
import { logInfo } from './runtime/logger.ts';

migrate();
const app = createApp();

const port = Number(process.env.PORT || 0) || 8787;
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  logInfo(`listening on http://127.0.0.1:${info.port}`);
});
