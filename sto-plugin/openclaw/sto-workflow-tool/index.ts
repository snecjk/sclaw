import { Type } from "./typebox-shim.js";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { createStoApiClient } from "./sto-toolkit/http-client.js";
import { defineStoTool } from "./sto-toolkit/define-sto-tool.js";
import { resolveSchemaHash, resolveTemplateId } from "./workflow-params.js";
import { buildSchemaConfirmationGuidance } from "./workflow-guidance.js";
import {
	assertWorkflowTemplatesFound,
	fetchWorkflowTemplates,
	resolveTemplateIdWithOptionalSearch,
} from "./workflow-search.js";

const TAG = "sto-workflow-tool";

type WorkflowPluginConfig = {
	baseUrl?: string;
	ssoAuthPath?: string;
	timeoutMs?: number;
};

const MAX_TEMPLATE_PAGE_SIZE = 50;

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
	"- 创建/查找工作流：search_workflow_templates → get_workflow_schema 后**停止**；客户端会**自动弹出分步参数表单**。",
	"- get_workflow_schema 后：正文最多 3～5 句业务说明（用工具返回的 confirmSteps 标题），引导用户在下方表单逐步确认。",
	"- **禁止**在对话中输出字段 key/常量名、参数表、Markdown 表格、默认值列表；**禁止**调用 create_workflow 或用默认值代填。",
	"- get_workflow_schema：优先传 search 返回的 templates[].id；若无 templateId 可传 query 自动搜索。",
	"- 重新执行/启动已有实例：execute_workflow（传入 workflowId）。",
	"- 查询运行状态：get_workflow_status（传入 runId）。",
	"- 禁止用 exec、shell、工作流相关的 sai-cli 命令、sai-cli discover 或读 sai-cli SKILL 处理工作流；普通非工作流的 sai-cli 命令可以正常使用；「创建文件夹/文件」等普通任务不要调用工作流 tool。",
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
					logger: {
						info: (message) => api.logger.info?.(message),
						warn: (message) => api.logger.warn?.(message),
					},
				});
			}
			return client;
		}

		defineStoTool(api, {
			id: "search_workflow_templates",
			domain: "workflow",
			resultType: "workflow_templates_found",
			label: "查询工作流模板",
			description: `根据用户自然语言描述搜索匹配的工作流模板（POST /agent/v1/workflow-templates）。
仅返回 scope=system 的官方推荐模板。
返回 templates[]，每项含 id（即 templateId，如 tpl_xxx）、label、description。
下一步 get_workflow_schema 必须传入 templates[].id。`,
			parameters: Type.Object({
				query: Type.String({ description: "搜索关键词" }),
				limit: Type.Optional(Type.Number({ description: "返回数量，默认 10" })),
			}),
			execute: async (params) => {
				const pageSize = Math.min(Math.max(params.limit ?? 10, 1), MAX_TEMPLATE_PAGE_SIZE);
				const items = await fetchWorkflowTemplates(getClient(), params.query, pageSize);
				assertWorkflowTemplatesFound(items, params.query);
				const templates = items.map((item) => ({
					...item,
					templateId: item.id,
				}));
				const first = templates[0]!;
				return {
					query: params.query,
					templates,
					nextStep: `请调用 get_workflow_schema，templateId="${first.id}"`,
				};
			},
		});

		defineStoTool(api, {
			id: "execute_workflow",
			domain: "workflow",
			resultType: "workflow_execution_started",
			label: "执行工作流",
			description: `启动已创建的工作流实例（POST /workflows/{id}/start）。
当用户说「执行」「重新执行」「再跑一遍」「用上次参数」且上下文有 workflowId 时必须调用本工具。
不要用 exec 或工作流相关的 sai-cli。`,
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
							// This plugin is invoked only by the OpenClaw chat runtime.
							// The host bridge persists this onto the workflow run snapshot.
							engineType: "openclaw",
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
			description: `获取指定模板的启动参数 schema。有 templateId 时直接查询；无 templateId 时可传 query 将先搜索模板再取 schema。
成功后客户端自动展示分步参数表单；你只需用业务语言简要说明 confirmSteps，禁止在正文列举字段 key 或参数表。`,
			parameters: Type.Object({
				templateId: Type.Optional(
					Type.String({ description: "模板 ID（search 结果中的 id" }),
				),
				query: Type.Optional(
					Type.String({
						description:
							"用户自然语言描述；无 templateId 时自动调用 POST /agent/v1/workflow-templates 搜索并取首个匹配模板",
					}),
				),
			}),
			execute: async (params) => {
				const resolved = await resolveTemplateIdWithOptionalSearch(
					params as Record<string, unknown>,
					(query) => fetchWorkflowTemplates(getClient(), query, 5),
				);
				const data = await getClient().fetchJson<StartupSchemaResponse>(
					`/agent/v1/workflow-templates/${encodeURIComponent(resolved.templateId)}/startup-schema`,
					{ method: "GET" },
				);
				const templateName = resolved.matchedLabel ?? data.templateId;
				const guidance = buildSchemaConfirmationGuidance(templateName, data.schema);
				return {
					templateId: data.templateId,
					schemaHash: data.schemaHash,
					schema: data.schema,
					templateName,
					confirmSteps: guidance.confirmSteps,
					assistantReplyGuide: guidance.assistantReplyGuide,
					...(resolved.resolvedViaSearch
						? {
								resolvedViaSearch: true,
								matchedLabel: resolved.matchedLabel,
							}
						: {}),
					nextStep: guidance.nextStep,
				};
			},
		});

		defineStoTool(api, {
			id: "create_workflow",
			domain: "workflow",
			resultType: "workflow_created",
			label: "创建工作流实例",
			description:
				"根据模板和参数创建工作流实例，返回 workflowId。必须先 get_workflow_schema 获取 schemaHash；禁止传空 schemaHash。",
			parameters: Type.Object({
				templateId: Type.String({ description: "模板 ID，来自 search 的 templates[].id" }),
				schemaHash: Type.String({ description: "来自 get_workflow_schema 的 schemaHash" }),
				values: Type.Record(Type.String(), Type.Unknown()),
				displayName: Type.Optional(Type.String()),
			}),
			execute: async (params) => {
				const templateId = resolveTemplateId(params as Record<string, unknown>);
				const schemaHash = resolveSchemaHash(params as Record<string, unknown>);
				const values =
					params.values && typeof params.values === "object" ? params.values : {};
				const idempotencyKey = `create-wf-${templateId}-${Date.now()}`;
				const created = await getClient().fetchJson<CreateWorkflowResponse>(
					"/agent/v1/workflows",
					{
						method: "POST",
						body: JSON.stringify({
							templateId,
							displayName: params.displayName,
							startup: {
								schemaHash,
								values,
							},
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
