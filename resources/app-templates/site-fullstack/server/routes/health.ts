import { Hono } from 'hono';
import type { AuthVariables } from '../runtime/auth-middleware.ts';

export const healthRoutes = new Hono<{ Variables: AuthVariables }>();

healthRoutes.get('/', (c) => c.json({
  ok: true,
  service: 'app-backend',
  time: new Date().toISOString(),
}));
