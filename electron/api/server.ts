/**
 * Host API 服务器入口 —— Electron 侧统一后端请求代理与路由注册中心。
 *
 * ⚠️ AI 编码开发须知（务必遵守）：
 *   今后为 memory-center / AI 后端新增「前端 → Python 后端」的请求代理时，
 *   【不要】再为本文件新增专用 route handler，也【不要】再单独写一个透传路由文件。
 *   一律复用通用透传代理 handleAiMemoryAgentV1Routes（见 ./routes/ai-memory-agent-v1.ts），
 *   由该代理统一识别并透传至 Python 后端。
 *
 *   通用代理规则（无需改 Node 层即可新增接口）：
 *     前端路径：/ai-memory/agent/v1/{rest}
 *     透传目标：{sto_base_url}/agent/v1/{rest}  （Python memory-center 实际接口）
 *   前端只需直接以 /ai-memory/agent/v1/xxx 为路径发起 hostApiFetch，代理会自动注入
 *   stoToken、固定 Content-Type: application/json 并透传，无需前端额外 authHeaders。
 *
 *   只有以下两类才允许新增专用 handler：
 *     1) 非透传、含 Electron 本地业务逻辑的接口（如鉴权、文件落盘、本地状态）；
 *     2) 非 /agent/v1 体系、或需要特殊路径改写/聚合的接口。
 *   纯粹的「转发给 Python 后端」类需求一律走通用代理，交由 AI 识别即可。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PORTS } from '../utils/config';
import { logger } from '../utils/logger';
import type { HostApiContext } from './context';
import { handleAuthRoutes } from './routes/auth';
import { handleAppRoutes } from './routes/app';
import { handleGatewayRoutes } from './routes/gateway';
import { handleSettingsRoutes } from './routes/settings';
import { handleMoreAppsRoutes } from './routes/more-apps';
import { handleProviderRoutes } from './routes/providers';
import { handleAgentRoutes } from './routes/agents';
import { handleChannelRoutes } from './routes/channels';
import { handleLogRoutes } from './routes/logs';
import { handleUsageRoutes } from './routes/usage';
import { handleSkillRoutes } from './routes/skills';
import { handleSkillPlazaRoutes } from './routes/skill-plaza';
import { handleAppPlazaRoutes } from './routes/app-plaza';
import { handleFileRoutes } from './routes/files';
import { handleSessionRoutes } from './routes/sessions';
import { handleSessionCatalogRoutes } from './routes/session-catalog';
import { handleTaskGroupRoutes } from './routes/task-groups';
import { handleCronRoutes } from './routes/cron';
import { handleScheduledTaskRoutes } from './routes/scheduled-tasks';
import { handleClaudeScheduledTaskRoutes } from './routes/claude-scheduled-tasks';
import { handleDingTalkRoutes } from './routes/dingtalk';
import { handleStoSyncRoutes } from './routes/sto-sync';
import { handleTokenQuotaRoutes } from './routes/token-quota';
import { handleSubscriptionRoutes } from './routes/subscriptions';
import { handleMyTasksRoutes } from './routes/my-tasks';
import { handleDictionaryRoutes } from './routes/dictionaries';
import { handleWorkflowRoutes } from './routes/workflows';
import { handleAiMemoryAgentV1Routes } from './routes/ai-memory-agent-v1';
import { handleSclawBrowserRoutes } from './routes/sclaw-browser';
import { handleBrowserBridgeRoutes } from './routes/browser-bridge';

import { sendJson } from './route-utils';

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
) => Promise<boolean>;

const routeHandlers: RouteHandler[] = [
	// 通用透传代理：所有「前端 → Python memory-center」的 /ai-memory/agent/v1/* 请求
	// 一律由它统一识别转发。新增此类后端接口时不要再造 handler，直接前端调
	// /ai-memory/agent/v1/xxx 即可，详见文件顶部「AI 编码开发须知」。
	handleAiMemoryAgentV1Routes,
  handleAuthRoutes,
  handleAppRoutes,
  handleGatewayRoutes,
  handleSettingsRoutes,
  handleMoreAppsRoutes,
  handleProviderRoutes,
  handleStoSyncRoutes,
  handleTokenQuotaRoutes,
  handleSubscriptionRoutes,
  handleAgentRoutes,
  handleChannelRoutes,
  handleSkillRoutes,
  handleSkillPlazaRoutes,
  handleAppPlazaRoutes,
  handleFileRoutes,
  handleSessionRoutes,
  handleSessionCatalogRoutes,
  handleTaskGroupRoutes,
  handleCronRoutes,
  handleScheduledTaskRoutes,
  handleDictionaryRoutes,
  handleWorkflowRoutes,
  handleSclawBrowserRoutes,
  handleBrowserBridgeRoutes,
  handleClaudeScheduledTaskRoutes,
  handleDingTalkRoutes,
  handleMyTasksRoutes,
  handleLogRoutes,
  handleUsageRoutes,
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
