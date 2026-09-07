import { Hono } from 'hono';
import { createAuthMiddleware, type AuthVariables } from './runtime/auth-middleware.ts';
import { openDb } from './runtime/db.ts';
import { errorMiddleware } from './runtime/error.ts';
import { authRoutes } from './routes/auth.ts';
import { healthRoutes } from './routes/health.ts';
import { todoRoutes } from './routes/todos.ts';

export function createApp() {
  const db = openDb();
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', errorMiddleware);
  app.use('*', createAuthMiddleware(db));
  app.route('/api/health', healthRoutes);
  app.route('/api/auth', authRoutes);
  app.route('/api/todos', todoRoutes);
  return app;
}
