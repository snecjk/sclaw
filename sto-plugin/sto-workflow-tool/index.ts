import { Type } from "@sinclair/typebox";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { createStoApiClient } from "./sto-toolkit/http-client.js";
import { defineStoTool } from "./sto-toolkit/define-sto-tool.js";

const TAG = "sto-workflow-tool";

type WorkflowPluginConfig = {
	baseUrl?: string;
	ssoAuthPath?: string;
	timeoutMs?: number;
};

type TemplateSearchItem = {
	id: string;
	label: string;
	description?: string;
	matchScore?: number;
};

type TemplateSearchResponse = {
	matchedItems?: TemplateSearchItem[];
	recommendedItems?: TemplateSearchItem[];
};

type StartWorkflowResponse = {
	runId: string;
	workflowId: string;
	status: string;
	startedAt?: string;
};

type StartupSchemaResponse = {
	templateId: string;
	schemaHash: string;
	schema: {
		fields: unknown[];
		steps: unknown[];
		nodeId: string;
		enabled: boolean;
	};
};

type CreateWorkflowResponse = {
	workflowId: string;
	workflowName: string;
	defaultPresetId: string;
	schemaHash: string;
	startupValues: Record<string, unknown>;
};

type WorkflowRunResponse = {
	runId: string;
	workflowId: string;
	status: string;
};

const WORKFLOW_TOOL_PROMPT = [
	"工作流内置工具（重要）：",
	"- 用户说「创建工作流」「新建 XX 工作流」等：必须先 search_workflow_templates，再 get_workflow_schema → create_workflow →（可选）execute_workflow。",
	"- 重新执行/启动已有实例：execute_workflow（传入 workflowId）。",
	"- 查询运行状态：get_workflow_status（传入 runId）。",
	"- 禁止用 exec、shell、sai-cli、sai-cli discover 或读 sai-cli SKILL 处理工作流；「创建文件夹/文件」等普通任务不要调用工作流 tool。",
].join("\n");

export default definePluginEntry({
	id: "sto-workflow-tool",
	name: "申通工作流内置工具",
	description: "工作流模板搜索与执行的内置 OpenClaw Tools",
	register(api: OpenClawPluginApi) {
		const cfg = (api.pluginConfig ?? {}) as WorkflowPluginConfig;
		api.logger.info?.(`[${TAG}] registering baseUrl=${cfg.baseUrl ?? "(not set)"}`);

		let client: ReturnType<typeof createStoApiClient> | null = null;
		function getClient() {
			if (!client) {
				client = createStoApiClient({
					baseUrl: cfg.baseUrl,
					ssoAuthPath: cfg.ssoAuthPath,
					timeoutMs: cfg.timeoutMs,
				});
			}
			return client;
		}

		defineStoTool(api, {
			id: "search_workflow_templates",
			domain: "workflow",
			resultType: "workflow_templates_found",
			label: "查询工作流模板",
			description: `根据用户自然语言描述搜索匹配的工作流模板。
用户可能会说「帮我创建对账工作流」「客户异常监控工作流」等。
返回模板列表（id、label、description、matchScore）。`,
			parameters: Type.Object({
				query: Type.String({ description: "搜索关键词" }),
				limit: Type.Optional(Type.Number({ description: "返回数量，默认 10" })),
			}),
			execute: async (params) => {
				const limit = params.limit ?? 10;
				const data = await getClient().fetchJson<TemplateSearchResponse>(
					"/agent/v1/workflow-templates/search",
					{
						method: "POST",
						body: JSON.stringify({ query: params.query, limit }),
					},
				);
				const templates = [
					...(data.matchedItems ?? []),
					...(data.recommendedItems ?? []),
				];
				return { query: params.query, templates };
			},
		});

		defineStoTool(api, {
			id: "execute_workflow",
			domain: "workflow",
			resultType: "workflow_execution_started",
			label: "执行工作流",
			description: `启动已创建的工作流实例（POST /workflows/{id}/start）。
当用户说「执行」「重新执行」「再跑一遍」「用上次参数」且上下文有 workflowId 时必须调用本工具。
不要用 exec 或 sai-cli。`,
			parameters: Type.Object({
				workflowId: Type.String({ description: "工作流实例 ID，如 wf_xxx" }),
				inputs: Type.Optional(
					Type.Record(Type.String(), Type.Unknown(), {
						description: "可选输入参数覆盖",
					}),
				),
				templateName: Type.Optional(
					Type.String({ description: "工作流显示名称，用于 UI 卡片" }),
				),
			}),
			execute: async (params) => {
				const idempotencyKey = `start-wf-${params.workflowId}-${Date.now()}`;
				const run = await getClient().fetchJson<StartWorkflowResponse>(
					`/agent/v1/workflows/${encodeURIComponent(params.workflowId)}/start`,
					{
						method: "POST",
						body: JSON.stringify({
							inputs: params.inputs ?? {},
							idempotencyKey,
						}),
					},
				);
				return {
					workflowId: run.workflowId ?? params.workflowId,
					runId: run.runId,
					status: run.status,
					templateName: params.templateName,
					startedAt: run.startedAt,
				};
			},
		});

		defineStoTool(api, {
			id: "get_workflow_schema",
			domain: "workflow",
			resultType: "workflow_schema_ready",
			label: "获取工作流参数模板",
			description: "获取指定模板的启动参数 schema（字段、步骤）。用户选定模板后调用。",
			parameters: Type.Object({
				templateId: Type.String({ description: "模板 ID，如 tpl_xxx" }),
			}),
			execute: async (params) => {
				const data = await getClient().fetchJson<StartupSchemaResponse>(
					`/agent/v1/workflow-templates/${encodeURIComponent(params.templateId)}/startup-schema`,
					{ method: "GET" },
				);
				return {
					templateId: data.templateId,
					schemaHash: data.schemaHash,
					schema: data.schema,
				};
			},
		});

		defineStoTool(api, {
			id: "create_workflow",
			domain: "workflow",
			resultType: "workflow_created",
			label: "创建工作流实例",
			description: "根据模板和参数创建工作流实例，返回 workflowId。参数确认后调用。",
			parameters: Type.Object({
				templateId: Type.String(),
				schemaHash: Type.String(),
				values: Type.Record(Type.String(), Type.Unknown()),
				displayName: Type.Optional(Type.String()),
			}),
			execute: async (params) => {
				const idempotencyKey = `create-wf-${params.templateId}-${Date.now()}`;
				const created = await getClient().fetchJson<CreateWorkflowResponse>(
					"/agent/v1/workflows",
					{
						method: "POST",
						body: JSON.stringify({
							templateId: params.templateId,
							displayName: params.displayName,
							startup: {
								schemaHash: params.schemaHash,
								values: params.values,
							},
							idempotencyKey,
						}),
					},
				);
				return {
					workflowId: created.workflowId,
					workflowName: created.workflowName,
					templateId: params.templateId,
					schemaHash: created.schemaHash,
					values: params.values,
				};
			},
		});

		defineStoTool(api, {
			id: "get_workflow_status",
			domain: "workflow",
			resultType: "workflow_run_status",
			label: "查询工作流运行状态",
			description: "查询指定 runId 的执行状态、进度与结果。",
			parameters: Type.Object({
				runId: Type.String({ description: "运行 ID" }),
			}),
			execute: async (params) => {
				const run = await getClient().fetchJson<WorkflowRunResponse>(
					`/agent/v1/runs/${encodeURIComponent(params.runId)}`,
					{ method: "GET" },
				);
				return run;
			},
		});

		api.on("before_prompt_build", async () => ({
			appendSystemContext: WORKFLOW_TOOL_PROMPT,
		}));

		api.logger.info?.(
			`[${TAG}] registered search_workflow_templates, get_workflow_schema, create_workflow, execute_workflow, get_workflow_status`,
		);
	},
});
