import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PORTS } from '../utils/config';
import { logger } from '../utils/logger';
import type { HostApiContext } from './context';
import { handleAuthRoutes } from './routes/auth';
import { handleAppRoutes } from './routes/app';
import { handleGatewayRoutes } from './routes/gateway';
import { handleSettingsRoutes } from './routes/settings';
import { handleProviderRoutes } from './routes/providers';
import { handleAgentRoutes } from './routes/agents';
import { handleChannelRoutes } from './routes/channels';
import { handleLogRoutes } from './routes/logs';
import { handleUsageRoutes } from './routes/usage';
import { handleSkillRoutes } from './routes/skills';
import { handleSkillPlazaRoutes } from './routes/skill-plaza';
import { handleFileRoutes } from './routes/files';
import { handleSessionRoutes } from './routes/sessions';
import { handleCronRoutes } from './routes/cron';
import { handleScheduledTaskRoutes } from './routes/scheduled-tasks';
import { handleClaudeScheduledTaskRoutes } from './routes/claude-scheduled-tasks';
import { handleDingTalkRoutes } from './routes/dingtalk';
import { handleStoSyncRoutes } from './routes/sto-sync';
import { handleTokenQuotaRoutes } from './routes/token-quota';
import { handleSubscriptionRoutes } from './routes/subscriptions';
import { handleWorkflowRoutes } from './routes/workflows';
import { sendJson } from './route-utils';

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
) => Promise<boolean>;

const routeHandlers: RouteHandler[] = [
  handleAuthRoutes,
  handleAppRoutes,
  handleGatewayRoutes,
  handleSettingsRoutes,
  handleProviderRoutes,
  handleStoSyncRoutes,
  handleTokenQuotaRoutes,
  handleSubscriptionRoutes,
  handleAgentRoutes,
  handleChannelRoutes,
  handleSkillRoutes,
  handleSkillPlazaRoutes,
  handleFileRoutes,
  handleSessionRoutes,
  handleCronRoutes,
  handleScheduledTaskRoutes,
  handleClaudeScheduledTaskRoutes,
  handleDingTalkRoutes,
  handleLogRoutes,
  handleUsageRoutes,
  handleWorkflowRoutes,
];

export function startHostApiServer(ctx: HostApiContext, port = PORTS.CLAWX_HOST_API): Server {
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      logger.info(`[HostApi] ${req.method} ${requestUrl.pathname} — routing...`);
      for (const handler of routeHandlers) {
        const handled = await handler(req, res, requestUrl, ctx);
        if (handled) {
          return;
        }
      }
      sendJson(res, 404, { success: false, error: `No route for ${req.method} ${requestUrl.pathname}` });
    } catch (error) {
      logger.error('Host API request failed:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info(`Host API server listening on http://127.0.0.1:${port}`);
  });

  return server;
}
