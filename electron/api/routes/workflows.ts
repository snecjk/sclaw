import type { IncomingMessage, ServerResponse } from 'http';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { getStoToken } from '../../utils/auth-store';
import { logger } from '../../utils/logger';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getInstalledWorkflowRuntime, installWorkflowRuntime, workflowV2BackendFetch } from '../../services/workflow-runtime/bootstrap';
import { workflowExecLog } from '../../services/workflow-runtime/logging';
import { takeWorkflowDatabaseId } from '../../services/workflow-runtime/id-pool';
import type { AgentEngineType } from '../../engines/types';
import { getEngineSessionRegistryEntry } from '../../engines/session-registry';
import type { StartWorkflowArgs } from '../../services/workflow-runtime/engine';
import { getOpenClawProvidersConfig } from '../../utils/openclaw-auth';

type WorkflowStartBody = {
  runDatabaseId?: number;
  inputs?: Record<string, unknown>;
  idempotencyKey?: string;
  sessionKey?: string;
  runMode?: 'trial' | 'production';
  workflowVersionId?: string | number;
  /** The chat workflow tool's selected execution engine. */
  engineType?: AgentEngineType;
  /** Optional display metadata supplied by the chat workflow tool. */
  chatCardTitle?: string;
  chatParamsSummary?: string;
};

const CHAT_CARD_TEXT_MAX = 2_000;

function normalizeChatCardText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, CHAT_CARD_TEXT_MAX) : null;
}

export function summarizeWorkflowChatInputs(inputs: Record<string, unknown> | undefined): string | null {
  if (!inputs || Object.keys(inputs).length === 0) return null;
  try {
    return JSON.stringify(inputs).slice(0, CHAT_CARD_TEXT_MAX);
  } catch {
    return null;
  }
}

export function buildWorkflowStartChatCard(
  workflowId: string,
  body: Pick<WorkflowStartBody, 'inputs' | 'chatCardTitle' | 'chatParamsSummary'>,
): NonNullable<StartWorkflowArgs['chatCard']> {
  return {
    title: normalizeChatCardText(body.chatCardTitle) ?? workflowId,
    paramsSummary: normalizeChatCardText(body.chatParamsSummary)
      ?? summarizeWorkflowChatInputs(body.inputs),
  };
}

type WorkflowV2StartResponse = {
  runId: string;
  runDatabaseId: number;
  workflowId?: string;
  workflowVersionId: string | number;
  workflowVersion?: number;
  status?: string;
  startedAt?: string;
};

function requireWorkflowChatSessionKey(sessionKey: unknown): string {
  if (typeof sessionKey !== 'string' || !sessionKey.trim()) {
    throw new Error('Workflow chat start requires a non-empty sessionKey');
  }
  return sessionKey.trim();
}

/**
 * The v1 start bridge is still called by engine-owned workflow tools. Treat an
 * omitted value as an old-plugin request, but never rewrite an explicit engine
 * choice while creating the immutable workflow-run snapshot.
 */
export function resolveWorkflowStartEngine(engineType: unknown): {
  engineType: AgentEngineType;
  source: 'request' | 'legacy-default';
} {
  if (engineType === 'openclaw' || engineType === 'claude') {
    return { engineType, source: 'request' };
  }
  if (engineType === undefined) {
    return { engineType: 'claude', source: 'legacy-default' };
  }
  throw new Error(`Unsupported workflow execution engine: ${String(engineType)}`);
}

async function proxyWorkflowStreamRequest(
  req: IncomingMessage,
  res: ServerResponse,
  backendPath: string,
): Promise<void> {
  logger.info('[workflow-trace] SSE proxy start %s', backendPath);
  const baseUrl = await resolveStoBaseUrl();
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
  };
  const stoToken = req.headers.stotoken;
  if (stoToken) {
    headers.stoToken = String(stoToken);
  }
  const traceId = req.headers['x-trace-id'];
  if (traceId) {
    headers['X-Trace-Id'] = String(traceId);
  }

  const controller = new AbortController();
  // Clean up controller when client disconnects
  res.on('close', () => controller.abort());

  try {
    const response = await proxyAwareFetch(`${baseUrl}${backendPath}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
      timeoutMs: 0, // No timeout for SSE streams
    });

    if (!response.ok) {
      logger.warn('[workflow-trace] SSE proxy backend error %s status=%s', backendPath, response.status);
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: `Backend returned ${response.status}` }));
      return;
    }

    logger.info('[workflow-trace] SSE proxy connected %s status=%s', backendPath, response.status);
    res.statusCode = 200;
    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const responseTraceId = response.headers.get('x-trace-id');
    if (responseTraceId) {
      res.setHeader('X-Trace-Id', responseTraceId);
    }

    // Pipe ReadableStream to ServerResponse
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    let chunkCount = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount += 1;
      if (chunkCount === 1 || chunkCount % 10 === 0) {
        logger.info('[workflow-trace] SSE proxy chunk #%d %s bytes=%d', chunkCount, backendPath, value?.length ?? 0);
      }
      res.write(decoder.decode(value, { stream: true }));
    }

    logger.info('[workflow-trace] SSE proxy end %s chunks=%d', backendPath, chunkCount);
    res.end();
  } catch (err) {
    const errStr = String(err);
    if (errStr.includes('AbortError') || errStr.includes('aborted')) {
      logger.info('[workflow-trace] SSE proxy aborted %s', backendPath);
      return;
    }
    logger.error('[workflow-trace] SSE proxy failed %s:', backendPath, err);
    logger.error('[WorkflowRoutes] Stream proxy failed:', err);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(err) }));
    }
  }
}

const RUN_TRACE_JSON_MAX = 8_000;

function truncateForRunTrace(text: string): string {
  if (text.length <= RUN_TRACE_JSON_MAX) return text;
  return `${text.slice(0, RUN_TRACE_JSON_MAX)}…(truncated ${text.length - RUN_TRACE_JSON_MAX} chars)`;
}

async function extractWorkflowHeaders(req: IncomingMessage): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Source-Client': 'stoclaw',
  };
  const headerToken = req.headers.stotoken;
  const stoToken = headerToken ? String(headerToken) : await getStoToken();
  if (stoToken) {
    headers.stoToken = stoToken;
  }
  const traceId = req.headers['x-trace-id'];
  if (traceId) {
    headers['X-Trace-Id'] = String(traceId);
  }
  return headers;
}

function logWorkflowApiRequest(method: string, path: string, body?: string): void {
  logger.info(
    `[workflow-api] >>> ${method} ${path} body=${truncateForRunTrace(body ?? '(none)')}`,
  );
}

function logWorkflowApiResponse(method: string, path: string, status: number, responseBody: string): void {
  logger.info(
    `[workflow-api] <<< ${method} ${path} status=${status} response=${truncateForRunTrace(responseBody)}`,
  );
}

async function proxyWorkflowRequest(
  req: IncomingMessage,
  res: ServerResponse,
  backendPath: string,
  body?: unknown,
): Promise<void> {
  const baseUrl = await resolveStoBaseUrl();
  const headers = await extractWorkflowHeaders(req);
  const method = (req.method || 'GET').toUpperCase();

  let bodyStr: string | undefined;
  if (body !== undefined) {
    bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  }

  logWorkflowApiRequest(method, backendPath, bodyStr);

  const response = await proxyAwareFetch(`${baseUrl}${backendPath}`, {
    method,
    headers,
    body: bodyStr,
    timeoutMs: 30_000,
  });

  // Forward status code, content-type and body as-is
  const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
  const responseBody = await response.text();

  logWorkflowApiResponse(method, backendPath, response.status, responseBody);

  res.statusCode = response.status;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', contentType);
  const responseTraceId = response.headers.get('x-trace-id');
  if (responseTraceId) {
    res.setHeader('X-Trace-Id', responseTraceId);
  }
  res.end(responseBody);
}

function makeWorkflowStartIdempotencyKey(workflowId: string): string {
  return `start-wf-${workflowId}-${Date.now()}`;
}

/**
 * Tool-originated workflow starts bypass the renderer's model resolver. Pin
 * Claude runs to the current chat session model and OpenClaw runs to the
 * Gateway's configured chat default before dispatch. This keeps the local
 * workflow on the same model selected by the originating chat.
 */
export async function resolveWorkflowStartModel(
  engineType: AgentEngineType,
  sessionKey?: string,
): Promise<string> {
  if (engineType === 'claude') {
    const normalizedSessionKey = sessionKey?.trim();
    const session = normalizedSessionKey
      ? await getEngineSessionRegistryEntry(normalizedSessionKey)
      : null;
    const sessionModel = session?.engineType === 'claude' ? session.model?.trim() : undefined;
    if (!sessionModel) {
      throw new Error('Claude 聊天会话执行模型未配置，无法启动工作流');
    }
    return sessionModel;
  }

  const defaultModel = (await getOpenClawProvidersConfig()).defaultModel?.trim();
  if (!defaultModel || !defaultModel.includes('/')) {
    throw new Error('OpenClaw 聊天默认模型未配置或格式无效，无法启动工作流');
  }
  return defaultModel;
}

async function startLocalWorkflowRuntime(
  workflowId: string,
  registered: WorkflowV2StartResponse,
  body: WorkflowStartBody,
): Promise<void> {
  const versionId = registered.workflowVersionId;
  const startedAt = registered.startedAt ?? new Date().toISOString();
  const resolvedEngine = resolveWorkflowStartEngine(body.engineType);
  const engineModel = await resolveWorkflowStartModel(resolvedEngine.engineType, body.sessionKey);
  workflowExecLog('info', 'host-runtime-start', 'starting local workflow runtime from host route', {
    runId: registered.runId,
    workflowId,
    versionId,
    sessionKey: body.sessionKey,
    requestedExecEngine: body.engineType ?? null,
    execEngine: resolvedEngine.engineType,
    engineSource: resolvedEngine.source,
    engineModel: engineModel ?? null,
  });
  const runtime = installWorkflowRuntime();
  const execution = runtime.startWorkflow({
    runId: registered.runId,
    runDatabaseId: registered.runDatabaseId,
    workflowId,
    versionId: String(versionId),
    workflowVersion: registered.workflowVersion,
    input: body.inputs ?? {},
    startedAt,
    sessionKey: body.sessionKey ?? '',
    engineType: resolvedEngine.engineType,
    engineModel,
    // This host route is exclusively the chat tool's v1 start bridge. Store
    // the card marker in the same first SQLite write as the run itself so a
    // missing/delayed renderer tool-result can never suppress the card.
    chatCard: buildWorkflowStartChatCard(workflowId, body),
  });
  void execution.catch((error) => {
    workflowExecLog('error', 'host-runtime-start-failed', 'local workflow runtime failed', {
      runId: registered.runId,
      workflowId,
      versionId,
      error: error instanceof Error ? error.message : String(error),
    });
    logger.error(
      '[workflow-trace] local workflow runtime failed runId=%s workflowId=%s:',
      registered.runId,
      workflowId,
      error,
    );
  });

  // Do not acknowledge the tool start until the first atomic wf_run upsert is
  // observable. The renderer refreshes the session card-reference list when
  // the chat turn finishes, so this closes the final-result/SQLite race without
  // waiting for the workflow execution itself.
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await runtime.getRun(registered.runId)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  logger.warn(
    '[workflow-trace] wf_run persistence was not observable before start acknowledgement runId=%s',
    registered.runId,
  );
}

async function registerLocalWorkflowRun(
  workflowId: string,
  body: WorkflowStartBody,
  stoToken?: string,
): Promise<WorkflowV2StartResponse> {
  const idempotencyKey = body.idempotencyKey || makeWorkflowStartIdempotencyKey(workflowId);
  workflowExecLog('info', 'host-register-start', 'registering client-local workflow run', {
    workflowId,
    idempotencyKey,
    inputKeys: Object.keys(body.inputs ?? {}).join(','),
  });
  let registered: WorkflowV2StartResponse | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const suppliedId = attempt === 0 ? body.runDatabaseId : undefined;
    const runDatabaseId = Number.isSafeInteger(suppliedId) && Number(suppliedId) > 0
      ? Number(suppliedId)
      : await takeWorkflowDatabaseId();
    try {
      registered = await workflowV2BackendFetch(
        `/agent/v2/workflows/${encodeURIComponent(workflowId)}/createRunLog`,
        {
          method: 'POST',
          body: {
            runDatabaseId,
            inputs: body.inputs ?? {},
            idempotencyKey,
            runMode: body.runMode ?? 'production',
            workflowVersionId: body.workflowVersionId,
          },
          stoToken,
        },
      ) as WorkflowV2StartResponse;
      break;
    } catch (error) {
      if ((error as { status?: number }).status !== 409 || attempt === 1) throw error;
    }
  }

  if (!registered?.runId || registered.workflowVersionId == null || !Number.isSafeInteger(registered.runDatabaseId)) {
    throw new Error('workflow v2 createRunLog response missing runId/workflowVersionId/runDatabaseId');
  }
  workflowExecLog('info', 'host-register-succeeded', 'client-local workflow run registered', {
    runId: registered.runId,
    workflowId: registered.workflowId ?? workflowId,
    versionId: registered.workflowVersionId,
    status: registered.status,
  });
  return registered;
}

async function registerAndStartLocalWorkflow(
  workflowId: string,
  body: WorkflowStartBody,
  stoToken?: string,
): Promise<WorkflowV2StartResponse> {
  const registered = await registerLocalWorkflowRun(workflowId, body, stoToken);
  await startLocalWorkflowRuntime(workflowId, registered, body);
  return registered;
}

export async function handleWorkflowRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  const pathname = url.pathname;
  logger.info(`[WorkflowRoutes] checking ${req.method} ${pathname}`);

  // 0. workflow/v1 studio API (memory-center-web parity)
  if (pathname === '/workflow/v1/workflow-templates' && req.method === 'GET') {
    try {
      logger.info('[workflow-trace] GET /workflow/v1/workflow-templates (proxy)');
      await proxyWorkflowRequest(req, res, '/workflow/v1/workflow-templates');
    } catch (error) {
      logger.error('[WorkflowRoutes] workflow studio templates failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  if (pathname === '/workflow/v1/workflows' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      logger.info(
        '[workflow-trace] POST /workflow/v1/workflows templateId=%s name=%s',
        body.templateId,
        body.name,
      );
      await proxyWorkflowRequest(req, res, '/workflow/v1/workflows', body);
    } catch (error) {
      logger.error('[WorkflowRoutes] workflow studio create failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 0a. POST /workflow/v1/ai-builder/prompt-cache — AI 创建大 prompt 换短 promptCacheId（代理至 MC 后端）
  if (pathname === '/workflow/v1/ai-builder/prompt-cache' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ prompt: string; workflowId?: string }>(req);
      logger.info(
        '[workflow-trace] POST /workflow/v1/ai-builder/prompt-cache promptLen=%s',
        body.prompt?.length,
      );
      await proxyWorkflowRequest(req, res, '/workflow/v1/ai-builder/prompt-cache', body);
    } catch (error) {
      logger.error('[WorkflowRoutes] cache ai prompt failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 0b. GET /workflow/v1/workflow-templates/:templateId
  const studioTemplateMatch = pathname.match(/^\/workflow\/v1\/workflow-templates\/([^/]+)$/);
  if (studioTemplateMatch && req.method === 'GET') {
    try {
      logger.info('[workflow-trace] GET /workflow/v1/workflow-templates/%s (proxy)', studioTemplateMatch[1]);
      await proxyWorkflowRequest(req, res, pathname);
    } catch (error) {
      logger.error('[WorkflowRoutes] workflow studio template detail failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 0c. Workflow studio history versions (memory-center-web parity)
  const studioWorkflowVersionMatch = pathname.match(
    /^\/workflow\/v1\/workflows\/([^/]+)\/versions(?:\/([^/]+)(?:\/restore)?)?$/,
  );
  if (studioWorkflowVersionMatch) {
    const isRestore = pathname.endsWith('/restore');
    const isAllowed = req.method === 'GET' || (isRestore && req.method === 'POST');
    if (isAllowed) {
      try {
        const body = isRestore ? await parseJsonBody<Record<string, unknown>>(req) : undefined;
        logger.info('[workflow-trace] %s %s (proxy)', req.method, pathname);
        await proxyWorkflowRequest(req, res, pathname, body);
      } catch (error) {
        logger.error('[WorkflowRoutes] workflow studio versions failed:', error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: false, error: String(error) }));
      }
      return true;
    }
  }

  // 1. POST /agent/v1/workflow-templates
  //
  // 官方推荐模板列表（分页搜索）。
  // 仅返回 scope=system 的系统模板，后端服务层会过滤掉 personal 模板。
  // 调用方：Chat Picker 预加载、工作流页面「官方推荐」tab、首页官方推荐、我的任务页模板下拉。
  //
  // 关联：个人模板需使用 /agent/v1/workflow-templates/mine（已废弃，前端已不再调用）
  if (pathname === '/agent/v1/workflow-templates' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ query?: string; page?: number; pageSize?: number }>(req);
      const backendPath = '/agent/v1/workflow-templates';
      const bodyStr = JSON.stringify(body);
      logWorkflowApiRequest('POST', backendPath, bodyStr);

      const baseUrl = await resolveStoBaseUrl();
      const headers = await extractWorkflowHeaders(req);

      const response = await proxyAwareFetch(`${baseUrl}${backendPath}`, {
        method: 'POST',
        headers,
        body: bodyStr,
        timeoutMs: 30_000,
      });

      const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
      const responseBody = await response.text();

      logWorkflowApiResponse('POST', backendPath, response.status, responseBody);

      res.statusCode = response.status;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', contentType);
      const responseTraceId = response.headers.get('x-trace-id');
      if (responseTraceId) {
        res.setHeader('X-Trace-Id', responseTraceId);
      }
      res.end(responseBody);
    } catch (error) {
      logger.error('[WorkflowRoutes] list templates failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 2. GET /agent/v1/workflow-templates/:templateId/startup-schema
  const startupSchemaMatch = pathname.match(/^\/agent\/v1\/workflow-templates\/([^/]+)\/startup-schema$/);
  if (startupSchemaMatch && req.method === 'GET') {
    try {
      logger.info(
        '[workflow-trace] GET /agent/v1/workflow-templates/%s/startup-schema (proxy)',
        startupSchemaMatch[1],
      );
      await proxyWorkflowRequest(req, res, pathname);
    } catch (error) {
      logger.error('[WorkflowRoutes] startup-schema failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 3. POST /agent/v1/workflows
  if (pathname === '/agent/v1/workflows' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      logger.info(
        '[workflow-trace] POST /agent/v1/workflows templateId=%s idempotencyKey=%s',
        body.templateId,
        body.idempotencyKey,
      );
      await proxyWorkflowRequest(req, res, '/agent/v1/workflows', body);
    } catch (error) {
      logger.error('[WorkflowRoutes] create workflow failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 4. GET|PUT /agent/v1/workflows/:workflowId
  const workflowDetailMatch = pathname.match(/^\/agent\/v1\/workflows\/([^/]+)$/);
  if (workflowDetailMatch && (req.method === 'GET' || req.method === 'PUT')) {
    try {
      const body =
        req.method === 'PUT' ? await parseJsonBody<Record<string, unknown>>(req) : undefined;
      logger.info('[workflow-trace] %s %s (proxy) workflowId=%s', req.method, pathname, workflowDetailMatch[1]);
      await proxyWorkflowRequest(req, res, pathname, body);
    } catch (error) {
      logger.error('[WorkflowRoutes] workflow detail %s failed:', req.method, error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 4b. POST /agent/v1/workflows/:workflowId/publish
  const publishMatch = pathname.match(/^\/agent\/v1\/workflows\/([^/]+)\/publish$/);
  if (publishMatch && req.method === 'POST') {
    try {
      logger.info('[workflow-trace] POST %s (proxy) workflowId=%s', pathname, publishMatch[1]);
      await proxyWorkflowRequest(req, res, pathname, {});
    } catch (error) {
      logger.error('[WorkflowRoutes] publish workflow failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 5. POST /agent/v1/workflows/:workflowId/start
  //
  // Legacy tool compatibility bridge: OpenClaw/Claude workflow tools may still
  // call the historical v1 start path. After client-side execution migration,
  // backend v1 intentionally returns 426, so the desktop host API translates
  // this local request into v2 register-only start + local runtime dispatch.
  const startMatch = pathname.match(/^\/agent\/v1\/workflows\/([^/]+)\/start$/);
  if (startMatch && req.method === 'POST') {
    try {
      const workflowId = decodeURIComponent(startMatch[1]);
      const body = await parseJsonBody<WorkflowStartBody>(req);
      const boundBody: WorkflowStartBody = {
        ...body,
        sessionKey: requireWorkflowChatSessionKey(body.sessionKey),
      };
      logger.info(
        '[workflow-trace] POST %s local-bridge idempotencyKey=%s inputKeys=%o requestedExecEngine=%s sessionKey=%s',
        pathname,
        boundBody.idempotencyKey,
        Object.keys(boundBody.inputs ?? {}),
        boundBody.engineType ?? 'legacy-default',
        boundBody.sessionKey,
      );
      const registered = await registerAndStartLocalWorkflow(
        workflowId,
        boundBody,
        String(req.headers.stotoken ?? ''),
      );
      sendJson(res, 200, {
        success: true,
        data: {
          runId: registered.runId,
          workflowId: registered.workflowId ?? workflowId,
          workflowVersionId: registered.workflowVersionId,
          workflowVersion: registered.workflowVersion,
          status: String(registered.status ?? 'RUNNING').toLowerCase(),
          startedAt: registered.startedAt ?? new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('[WorkflowRoutes] start workflow failed:', error);
      res.statusCode = error instanceof Error && (
        error.message.startsWith('Unsupported workflow execution engine:')
        || error.message.startsWith('Workflow chat start requires')
      )
        ? 400
        : 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 5b. POST /agent/v2/workflows/:workflowId/createRunLog
  //
  // Renderer startWorkflowLocal enters through Host API. Keep this endpoint
  // register-only: renderer starts workflow-runtime over IPC after receiving
  // runId/workflowVersionId.
  const startV2Match = pathname.match(/^\/agent\/v2\/workflows\/([^/]+)\/createRunLog$/);
  if (startV2Match && req.method === 'POST') {
    try {
      const workflowId = decodeURIComponent(startV2Match[1]);
      const body = await parseJsonBody<WorkflowStartBody>(req);
      logger.info(
        '[workflow-trace] POST %s local-runtime idempotencyKey=%s inputKeys=%o',
        pathname,
        body.idempotencyKey,
        Object.keys(body.inputs ?? {}),
      );
      const registered = await registerLocalWorkflowRun(workflowId, body, String(req.headers.stotoken ?? ''));
      sendJson(res, 200, {
        success: true,
        data: registered,
      });
    } catch (error) {
      logger.error('[WorkflowRoutes] start workflow v2 failed:', error);
      res.statusCode = (error as { status?: number }).status ?? 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 6. GET /agent/v1/runs/:runId/stream (SSE)
  const runStreamMatch = pathname.match(/^\/agent\/v1\/runs\/([^/]+)\/stream$/);
  if (runStreamMatch && req.method === 'GET') {
    // SSE stream: no try/catch wrapper — proxyWorkflowStreamRequest handles its own errors
    void proxyWorkflowStreamRequest(req, res, pathname);
    return true;
  }

  // 6. GET /agent/v1/runs/:runId
  const runMatch = pathname.match(/^\/agent\/v1\/runs\/([^/]+)$/);
  if (runMatch && req.method === 'GET') {
    try {
      const runId = decodeURIComponent(runMatch[1]);
      // Tool-originated runs are executed by the desktop runtime. Prefer its
      // authoritative SQLite view so get_workflow_status receives local
      // artifact filePath/file:// preview references from the runtime mapper.
      // The persisted WorkflowPacket remains canonical and path-independent.
      const localRun = await getInstalledWorkflowRuntime()?.getRun(runId, { view: 'status' });
      if (localRun) {
        logger.info('[workflow-trace] GET %s local-runtime runId=%s artifacts=%d',
          pathname, runId, Array.isArray(localRun.artifacts) ? localRun.artifacts.length : 0);
        sendJson(res, 200, { success: true, data: localRun });
        return true;
      }
      logger.info('[workflow-trace] GET %s local-runtime-miss runId=%s; falling back to backend', pathname, runId);
      await proxyWorkflowRequest(req, res, pathname);
    } catch (error) {
      logger.error('[WorkflowRoutes] get run failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 7. PUT /agent/v1/workflows/:workflowId/name
  const renameMatch = pathname.match(/^\/agent\/v1\/workflows\/([^/]+)\/name$/);
  if (renameMatch && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ name: string }>(req);
      logger.info('[workflow-trace] PUT %s name=%s', pathname, body.name);
      await proxyWorkflowRequest(req, res, pathname, body);
    } catch (error) {
      logger.error('[WorkflowRoutes] rename workflow failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  // 8. DELETE /agent/v1/workflows/:workflowId
  const deleteMatch = pathname.match(/^\/agent\/v1\/workflows\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    try {
      logger.info('[workflow-trace] DELETE %s workflowId=%s', pathname, deleteMatch[1]);
      await proxyWorkflowRequest(req, res, pathname);
    } catch (error) {
      logger.error('[WorkflowRoutes] delete workflow failed:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: String(error) }));
    }
    return true;
  }

  return false;
}
