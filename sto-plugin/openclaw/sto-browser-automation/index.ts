import { Type } from "./typebox-shim.js";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { defineStoTool } from "./define-sto-tool.js";
import {
	ensureAutomationSession,
	formatObservationElements,
	postAutomation,
	sessionOptionsFromParams,
	type BrowserAutomationPluginConfig,
} from "./automation-client.js";

const TAG = "sto-browser-automation";

const SESSION_ID_PARAM = Type.Optional(
	Type.String({
		description: "自动化会话 ID。应用广场内嵌浏览器使用 embed-<runtimeId>。",
	}),
);

const EMBED_RUNTIME_ID_PARAM = Type.Optional(
	Type.String({
		description: "应用广场 embed runtimeId；若未传 sessionId 则自动创建 embed 会话。",
	}),
);

const RUN_ID_PARAM = Type.Optional(
	Type.String({ description: "可选 runId，用于步级 checkpoint 持久化。" }),
);

const BA_SYSTEM_PROMPT = [
	"浏览器自动化工具（ba_*，Step 1）：",
	"- 应用广场内嵌预览：优先传 sessionId=embed-<runtimeId> 或 embedRuntimeId。",
	"- **简单单步点击/打开**：用 bridge_click，不要用 ba_observe + ba_act。",
	"- **需要用户输入**：ba_observe 定位 ref → ba_act fill（CDP 真实输入，填后校验）→ ba_validate。",
	"- ref 来自 ba_observe 返回的 @eN；也可使用 name 按可见文案匹配。",
	"- 无登录态的外部站点：先 ba_create_session(url) 创建 managed 会话。",
].join("\n");

export default definePluginEntry({
	id: "sto-browser-automation",
	name: "StoClaw Browser Automation",
	description: "Browser Automation Platform — observe/act/wait/validate with step checkpoints",
	register(api: OpenClawPluginApi) {
		const cfg = (api.pluginConfig ?? {}) as BrowserAutomationPluginConfig;
		api.logger.info?.(`[${TAG}] registering host=${cfg.hostApiHost ?? "127.0.0.1"}:${cfg.hostApiPort ?? 3210}`);

		api.on("before_prompt_build", async () => ({
			appendSystemContext: BA_SYSTEM_PROMPT,
		}));

		defineStoTool(api, {
			id: "ba_create_session",
			domain: "browser-automation",
			resultType: "browser_automation_session",
			label: "创建浏览器自动化会话",
			description: "创建 embed 或 managed 自动化会话。embed 需 embedRuntimeId；managed 需 url。",
			parameters: Type.Object({
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
				url: Type.Optional(Type.String({ description: "managed 会话起始 URL" })),
				showManaged: Type.Optional(Type.Boolean({ description: "managed 窗口是否可见" })),
			}),
			execute: async (params) => {
				const data = await postAutomation<{ session: unknown }>(cfg, "/api/browser-automation/sessions", {
					embedRuntimeId: params.embedRuntimeId,
					url: params.url,
					showManaged: params.showManaged,
				});
				return data.session;
			},
		});

		defineStoTool(api, {
			id: "ba_observe",
			domain: "browser-automation",
			resultType: "browser_automation_observe",
			label: "观察页面",
			description: "获取当前页面可交互元素列表（含 @e ref 与 stableKey）。操作前必须先 observe。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
			}),
			execute: async (params) => {
				const sessionOpts = sessionOptionsFromParams(params);
				const sessionId = await ensureAutomationSession(cfg, sessionOpts);
				const data = await postAutomation<{ observation: Record<string, unknown> }>(
					cfg,
					"/api/browser-automation/observe",
					{ sessionId },
				);
				return {
					sessionId,
					summary: formatObservationElements(data.observation as Parameters<typeof formatObservationElements>[0]),
					observation: data.observation,
				};
			},
		});

		defineStoTool(api, {
			id: "ba_act",
			domain: "browser-automation",
			resultType: "browser_automation_act",
			label: "执行浏览器动作",
			description: "执行单步 click/fill/select/navigate/scroll/press。fill/press 走 CDP 真实输入并校验填后值。ref 来自 ba_observe。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
				runId: RUN_ID_PARAM,
				action: Type.Union([
					Type.Literal("click"),
					Type.Literal("fill"),
					Type.Literal("select"),
					Type.Literal("navigate"),
					Type.Literal("scroll"),
					Type.Literal("press"),
				]),
				ref: Type.Optional(Type.String()),
				stableKey: Type.Optional(Type.String()),
				name: Type.Optional(Type.String()),
				value: Type.Optional(Type.String()),
				url: Type.Optional(Type.String()),
				key: Type.Optional(Type.String()),
				scrollY: Type.Optional(Type.Number()),
			}),
			execute: async (params) => {
				const sessionOpts = sessionOptionsFromParams(params);
				const sessionId = await ensureAutomationSession(cfg, sessionOpts);
				const payload = {
					action: params.action,
					ref: params.ref,
					stableKey: params.stableKey,
					name: params.name,
					value: params.value,
					url: params.url,
					key: params.key,
					scrollY: params.scrollY,
				};
				const data = await postAutomation<{ result: unknown }>(cfg, "/api/browser-automation/act", {
					sessionId,
					runId: params.runId,
					payload,
				});
				return { sessionId, ...(data.result as object) };
			},
		});

		defineStoTool(api, {
			id: "ba_wait",
			domain: "browser-automation",
			resultType: "browser_automation_wait",
			label: "等待页面条件",
			description: "等待 networkIdle、navigation、url、selector 或 timeout。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
				type: Type.Union([
					Type.Literal("networkIdle"),
					Type.Literal("navigation"),
					Type.Literal("url"),
					Type.Literal("selector"),
					Type.Literal("timeout"),
				]),
				urlPattern: Type.Optional(Type.String()),
				selector: Type.Optional(Type.String()),
				stableKey: Type.Optional(Type.String()),
				timeoutMs: Type.Optional(Type.Number()),
			}),
			execute: async (params) => {
				const sessionOpts = sessionOptionsFromParams(params);
				const sessionId = await ensureAutomationSession(cfg, sessionOpts);
				return postAutomation(cfg, "/api/browser-automation/wait", {
					sessionId,
					condition: {
						type: params.type,
						urlPattern: params.urlPattern,
						selector: params.selector,
						stableKey: params.stableKey,
						timeoutMs: params.timeoutMs,
					},
				});
			},
		});

		defineStoTool(api, {
			id: "ba_validate",
			domain: "browser-automation",
			resultType: "browser_automation_validate",
			label: "验证页面状态",
			description: "断言 URL/title/元素/text 等，用于 catch silent failure。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
				runId: RUN_ID_PARAM,
				type: Type.Union([
					Type.Literal("url"),
					Type.Literal("title"),
					Type.Literal("elementExists"),
					Type.Literal("elementCount"),
					Type.Literal("elementText"),
				]),
				pattern: Type.Optional(Type.String()),
				role: Type.Optional(Type.String()),
				name: Type.Optional(Type.String()),
				minCount: Type.Optional(Type.Number()),
				maxCount: Type.Optional(Type.Number()),
				expectedText: Type.Optional(Type.String()),
			}),
			execute: async (params) => {
				const sessionOpts = sessionOptionsFromParams(params);
				const sessionId = await ensureAutomationSession(cfg, sessionOpts);
				const data = await postAutomation<{ result: unknown }>(cfg, "/api/browser-automation/validate", {
					sessionId,
					runId: params.runId,
					spec: {
						type: params.type,
						pattern: params.pattern,
						role: params.role,
						name: params.name,
						minCount: params.minCount,
						maxCount: params.maxCount,
						expectedText: params.expectedText,
					},
				});
				return { sessionId, ...(data.result as object) };
			},
		});

		defineStoTool(api, {
			id: "ba_start_run",
			domain: "browser-automation",
			resultType: "browser_automation_run",
			label: "开始自动化 run",
			description: "创建带步级 checkpoint 的 run，后续 ba_act/ba_validate 可传 runId。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
				workflowRunId: Type.Optional(Type.String()),
			}),
			execute: async (params) => {
				const sessionOpts = sessionOptionsFromParams(params);
				const sessionId = await ensureAutomationSession(cfg, sessionOpts);
				return postAutomation(cfg, "/api/browser-automation/runs", {
					sessionId,
					workflowRunId: params.workflowRunId,
				});
			},
		});
	},
});
