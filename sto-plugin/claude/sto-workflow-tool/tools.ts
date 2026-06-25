/**
 * sto-workflow-tool — Claude Agent SDK implementation.
 *
 * This module owns the Claude-native integration: Zod raw-shape schemas,
 * in-process MCP server registration, STO API calls, and MCP tool results.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "../zod-shim.js";

interface WorkflowConfig {
  baseUrl: string;
  stoToken: string;
  timeoutMs?: number;
}

interface StoApiResponse<T> {
  success: boolean;
  data: T | null;
  errCode?: string;
  errMessage?: string;
  traceId?: string;
}

interface WorkflowEnvelope<T = unknown> {
  type: string;
  success: boolean;
  domain: "workflow";
  message?: string;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface TemplateSearchItem {
  id: string;
  label: string;
  description?: string;
  matchScore?: number;
}

interface StartWorkflowResponse {
  runId: string;
  workflowId: string;
  status: string;
  startedAt?: string;
}

interface StartupSchemaResponse {
  templateId: string;
  schemaHash: string;
  schema: {
    fields: unknown[];
    steps: unknown[];
    nodeId: string;
    enabled: boolean;
  };
}

interface CreateWorkflowResponse {
  workflowId: string;
  workflowName: string;
  defaultPresetId: string;
  schemaHash: string;
  startupValues: Record<string, unknown>;
}

interface WorkflowRunResponse {
  runId: string;
  workflowId: string;
  status: string;
}

const MAX_PAGE_SIZE = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const WORKFLOW_TEMPLATES_NO_ACCESS_MESSAGE =
  "未查询到可访问的工作流模板，您可能没有相关权限。请联系管理员申请工作流访问权限。";

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("STO workflow baseUrl is required");
  }
  return normalized;
}

function generateTraceId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function createWorkflowClient(config: WorkflowConfig) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Trace-Id": generateTraceId(),
      "X-Source-Client": "stoclaw-claude",
      stoToken: config.stoToken,
      ...(init.headers as Record<string, string> | undefined),
    };

    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const rawText = await response.text();

    let body: StoApiResponse<T>;
    try {
      body = JSON.parse(rawText) as StoApiResponse<T>;
    } catch {
      throw new Error(`STO API ${response.status}: invalid JSON response`);
    }

    if (!response.ok || !body.success || body.data === null) {
      const message =
        body.errMessage
        || (body.errCode ? `STO API error: ${body.errCode}` : `HTTP ${response.status}`);
      throw new Error(message);
    }

    return body.data;
  }

  return { fetchJson };
}

function resultFromEnvelope(envelope: WorkflowEnvelope): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    isError: !envelope.success,
  };
}

function successResult<T>(type: string, data: T, message?: string): CallToolResult {
  return resultFromEnvelope({
    type,
    success: true,
    domain: "workflow",
    message,
    data,
  });
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return resultFromEnvelope({
    type: "sto_tool_error",
    success: false,
    domain: "workflow",
    message,
    error: { code: "sto_workflow_tool_error", message },
  });
}

async function runWorkflowTool<T>(
  type: string,
  handler: () => Promise<T>,
): Promise<CallToolResult> {
  try {
    return successResult(type, await handler());
  } catch (error) {
    return errorResult(error);
  }
}

function clampPageSize(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 10, 1), MAX_PAGE_SIZE);
}

async function searchTemplates(
  client: ReturnType<typeof createWorkflowClient>,
  query: string,
  limit?: number,
): Promise<TemplateSearchItem[]> {
  // POST /agent/v1/workflow-templates — 官方推荐模板列表（分页搜索）
  // 仅返回 scope=system 的系统模板，后端服务层会过滤掉 personal 模板
  const items = await client.fetchJson<TemplateSearchItem[]>(
    "/agent/v1/workflow-templates",
    {
      method: "POST",
      body: JSON.stringify({ query, page: 1, pageSize: clampPageSize(limit) }),
    },
  );
  const templates = items ?? [];
  if (templates.length === 0) {
    const suffix = query.trim() ? `（搜索：${query.trim()}）` : "";
    throw new Error(`${WORKFLOW_TEMPLATES_NO_ACCESS_MESSAGE}${suffix}`);
  }
  return templates;
}

async function resolveTemplate(
  client: ReturnType<typeof createWorkflowClient>,
  params: { templateId?: string; query?: string },
): Promise<{
  templateId: string;
  matchedLabel?: string;
  resolvedViaSearch: boolean;
}> {
  const templateId = params.templateId?.trim();
  if (templateId) {
    return { templateId, resolvedViaSearch: false };
  }

  const query = params.query?.trim();
  if (!query) {
    throw new Error("Missing templateId or query. Search templates first or pass query.");
  }

  const templates = await searchTemplates(client, query, 5);
  const first = templates[0];
  if (!first?.id) {
    throw new Error(`No workflow template matched: ${query}`);
  }

  return {
    templateId: first.id,
    matchedLabel: first.label,
    resolvedViaSearch: true,
  };
}

export function createWorkflowTools(config: WorkflowConfig) {
  const client = createWorkflowClient(config);

  const searchWorkflowTemplates = tool(
    "search_workflow_templates",
    [
      "Search workflow templates by natural-language intent.",
      "Returns workflow_templates_found with templates[].id as the templateId for get_workflow_schema.",
    ].join("\n"),
    {
      query: z.string().min(1).describe("Search keywords or user intent"),
      limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().describe("Maximum results, default 10"),
    },
    async ({ query, limit }) => runWorkflowTool("workflow_templates_found", async () => {
      const templates = (await searchTemplates(client, query, limit)).map((item) => ({
        ...item,
        templateId: item.id,
      }));
      const first = templates[0];
      return {
        query,
        templates,
        nextStep: first
          ? `Call get_workflow_schema with templateId="${first.id}".`
          : "No matching workflow template was found. Ask the user for a more specific description.",
      };
    }),
  );

  const getWorkflowSchema = tool(
    "get_workflow_schema",
    [
      "Fetch startup parameter schema for a workflow template.",
      "After this tool succeeds, stop and let the client show the parameter form. Do not call create_workflow in the same turn.",
      "If templateId is missing, pass query to resolve the best matching template first.",
    ].join("\n"),
    {
      templateId: z.string().optional().describe("Template id from search_workflow_templates templates[].id"),
      query: z.string().optional().describe("User intent used to search when templateId is not known"),
    },
    async ({ templateId, query }) => runWorkflowTool("workflow_schema_ready", async () => {
      const resolved = await resolveTemplate(client, { templateId, query });
      const data = await client.fetchJson<StartupSchemaResponse>(
        `/agent/v1/workflow-templates/${encodeURIComponent(resolved.templateId)}/startup-schema`,
        { method: "GET" },
      );

      return {
        templateId: data.templateId,
        schemaHash: data.schemaHash,
        schema: data.schema,
        templateName: resolved.matchedLabel,
        ...(resolved.resolvedViaSearch
          ? { resolvedViaSearch: true, matchedLabel: resolved.matchedLabel }
          : {}),
        nextStep: "The client will render a parameter form. Ask the user to review and submit it.",
      };
    }),
  );

  const createWorkflow = tool(
    "create_workflow",
    [
      "Create a workflow instance from a template and user-confirmed values.",
      "Use only when values came from an explicit user/client confirmation, not immediately after get_workflow_schema.",
    ].join("\n"),
    {
      templateId: z.string().min(1).describe("Template id"),
      schemaHash: z.string().min(1).describe("schemaHash returned by get_workflow_schema"),
      values: z.record(z.string(), z.unknown()).describe("User-confirmed startup values"),
      displayName: z.string().optional().describe("Optional workflow display name"),
    },
    async ({ templateId, schemaHash, values, displayName }) => runWorkflowTool("workflow_created", async () => {
      const idempotencyKey = `create-wf-${templateId}-${Date.now()}`;
      const created = await client.fetchJson<CreateWorkflowResponse>(
        "/agent/v1/workflows",
        {
          method: "POST",
          body: JSON.stringify({
            templateId,
            displayName,
            startup: { schemaHash, values },
            idempotencyKey,
          }),
        },
      );

      return {
        workflowId: created.workflowId,
        workflowName: created.workflowName,
        templateId,
        schemaHash: created.schemaHash,
        values,
      };
    }),
  );

  const executeWorkflow = tool(
    "execute_workflow",
    [
      "Start an existing workflow instance.",
      "Use when the user asks to run, rerun, or continue a known workflowId.",
    ].join("\n"),
    {
      workflowId: z.string().min(1).describe("Workflow instance id, for example wf_xxx"),
      inputs: z.record(z.string(), z.unknown()).optional().describe("Optional runtime input overrides"),
      templateName: z.string().optional().describe("Workflow display name for UI cards"),
    },
    async ({ workflowId, inputs, templateName }) => runWorkflowTool("workflow_execution_started", async () => {
      const idempotencyKey = `start-wf-${workflowId}-${Date.now()}`;
      const run = await client.fetchJson<StartWorkflowResponse>(
        `/agent/v1/workflows/${encodeURIComponent(workflowId)}/start`,
        {
          method: "POST",
          body: JSON.stringify({ inputs: inputs ?? {}, idempotencyKey }),
        },
      );

      return {
        workflowId: run.workflowId ?? workflowId,
        runId: run.runId,
        status: run.status,
        templateName,
        startedAt: run.startedAt,
      };
    }),
  );

  const getWorkflowStatus = tool(
    "get_workflow_status",
    "Get status, progress, and result for a workflow run.",
    {
      runId: z.string().min(1).describe("Workflow run id"),
    },
    async ({ runId }) => runWorkflowTool("workflow_run_status", async () => {
      return client.fetchJson<WorkflowRunResponse>(
        `/agent/v1/runs/${encodeURIComponent(runId)}`,
        { method: "GET" },
      );
    }),
  );

  return [
    searchWorkflowTemplates,
    getWorkflowSchema,
    createWorkflow,
    executeWorkflow,
    getWorkflowStatus,
  ];
}

export function createWorkflowMcpServer(config: WorkflowConfig) {
  return createSdkMcpServer({
    name: "sto-workflow-tool",
    version: "1.0.0",
    instructions: [
      "Use these tools only for STO workflow discovery, schema retrieval, execution, and status checks.",
      "After get_workflow_schema succeeds, let the client collect and confirm parameters before creation.",
    ].join("\n"),
    tools: createWorkflowTools(config),
  });
}
