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
import { BA_SYSTEM_PROMPT } from "./prompts.js";

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

/** 代际参数（P0-1）：ba_act 携带最近一次 ba_observe 的 documentGeneration，不匹配即 STALE_REF。 */
const GENERATION_PARAM = Type.Optional(
	Type.Number({ description: "最近一次 ba_observe 返回的 documentGeneration；页面已变更时会收到 STALE_REF，需重新 observe。" }),
);

const SNAPSHOT_PARAM = Type.Optional(
	Type.Boolean({ description: "默认 true：动作后 300ms 自动快照；false 跳过。" }),
);

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
			description: "获取当前页面可交互元素列表（含 @e ref 与 documentGeneration）。操作前必须先 observe。mode=ax 走 AX 感知层，异常自动回退 dom。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
				mode: Type.Optional(
					Type.Union([Type.Literal("dom"), Type.Literal("ax")], {
						description: "感知模式；缺省由服务端 feature level 决定。",
					}),
				),
				interactiveOnly: Type.Optional(
					Type.Boolean({ description: "AX 模式：只保留交互节点（默认 false）。" }),
				),
			}),
			execute: async (params) => {
				const sessionOpts = sessionOptionsFromParams(params);
				const sessionId = await ensureAutomationSession(cfg, sessionOpts);
				const data = await postAutomation<{ observation: Record<string, unknown> }>(
					cfg,
					"/api/browser-automation/observe",
					{ sessionId, mode: params.mode, interactiveOnly: params.interactiveOnly },
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
			description: "执行单步 click/fill/select/navigate/scroll/press/mouse_click；也可走 screenshot/print_pdf/read_page/network_capture。fill/press 走 CDP 真实输入。click 被遮挡时自动 CDP 降级。ref 来自 ba_observe。",
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
					Type.Literal("mouse_click"),
					Type.Literal("screenshot"),
					Type.Literal("print_pdf"),
					Type.Literal("read_page"),
					Type.Literal("network_capture"),
				]),
				ref: Type.Optional(Type.String()),
				stableKey: Type.Optional(Type.String()),
				name: Type.Optional(Type.String()),
				value: Type.Optional(Type.String()),
				url: Type.Optional(Type.String()),
				key: Type.Optional(Type.String()),
				scrollY: Type.Optional(Type.Number()),
				generation: GENERATION_PARAM,
				snapshot: SNAPSHOT_PARAM,
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
					generation: params.generation,
					snapshot: params.snapshot,
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
			id: "ba_screenshot",
			domain: "browser-automation",
			resultType: "browser_automation_artifact",
			label: "截取页面",
			description: "截取当前页或指定元素（ref）。返回 artifact（path/sha256/bytes），不回 base64。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
				ref: Type.Optional(Type.String({ description: "元素 @e ref；缺省截整页。" })),
				format: Type.Optional(Type.Union([Type.Literal("png"), Type.Literal("jpeg")])),
				quality: Type.Optional(Type.Number({ description: "仅 jpeg，0-100。" })),
			}),
			execute: async (params) => {
				const sessionOpts = sessionOptionsFromParams(params);
				const sessionId = await ensureAutomationSession(cfg, sessionOpts);
				const data = await postAutomation<{ artifact: unknown }>(cfg, "/api/browser-automation/screenshot", {
					sessionId,
					ref: params.ref,
					format: params.format,
					quality: params.quality,
				});
				return { sessionId, artifact: data.artifact };
			},
		});

		defineStoTool(api, {
			id: "ba_print_pdf",
			domain: "browser-automation",
			resultType: "browser_automation_artifact",
			label: "导出 PDF",
			description: "将当前页导出为 PDF 产物（artifact path/sha256/bytes）。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
				printBackground: Type.Optional(Type.Boolean({ description: "默认 true。" })),
				landscape: Type.Optional(Type.Boolean()),
				pageRanges: Type.Optional(Type.String({ description: "如 1-2。" })),
				scale: Type.Optional(Type.Number()),
			}),
			execute: async (params) => {
				const sessionOpts = sessionOptionsFromParams(params);
				const sessionId = await ensureAutomationSession(cfg, sessionOpts);
				const data = await postAutomation<{ artifact: unknown }>(cfg, "/api/browser-automation/print-pdf", {
					sessionId,
					opts: {
						printBackground: params.printBackground,
						landscape: params.landscape,
						pageRanges: params.pageRanges,
						scale: params.scale,
					},
				});
				return { sessionId, artifact: data.artifact };
			},
		});

		defineStoTool(api, {
			id: "ba_network_capture",
			domain: "browser-automation",
			resultType: "browser_automation_network",
			label: "网络抓包",
			description: "有界 CDP Network 抓包。op=start 开始；op=stop 结束并返回条目摘要 + HAR artifact。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
				op: Type.Union([Type.Literal("start"), Type.Literal("stop")]),
				captureId: Type.Optional(Type.String({ description: "stop 时可选，校验是否为当前抓包。" })),
				urlFilter: Type.Optional(Type.String({ description: "URL 正则。" })),
				includeBodies: Type.Optional(Type.Boolean({ description: "默认 false。" })),
			}),
			execute: async (params) => {
				const sessionOpts = sessionOptionsFromParams(params);
				const sessionId = await ensureAutomationSession(cfg, sessionOpts);
				const data = await postAutomation<{ result: unknown }>(cfg, "/api/browser-automation/network/capture", {
					sessionId,
					captureId: params.captureId,
					op: params.op,
					opts: {
						urlFilter: params.urlFilter,
						includeBodies: params.includeBodies,
					},
				});
				return { sessionId, ...(data.result as object) };
			},
		});

		defineStoTool(api, {
			id: "ba_cdp",
			domain: "browser-automation",
			resultType: "browser_automation_cdp",
			label: "白名单 CDP 调用",
			description: "调用允许的 CDP 方法（Runtime.evaluate / DOM.* / Page.getFrameTree / Emulation.setDeviceMetricsOverride）。表外方法返回 CDP_METHOD_NOT_ALLOWED。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
				method: Type.String({ description: "CDP 方法名，必须在白名单内。" }),
				params: Type.Optional(Type.Object({}, { additionalProperties: true })),
			}),
			execute: async (params) => {
				const sessionOpts = sessionOptionsFromParams(params);
				const sessionId = await ensureAutomationSession(cfg, sessionOpts);
				const data = await postAutomation<{ result?: unknown; error?: unknown; success?: boolean }>(
					cfg,
					"/api/browser-automation/cdp",
					{ sessionId, method: params.method, params: params.params },
				);
				return { sessionId, ...data };
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
			id: "ba_find",
			domain: "browser-automation",
			resultType: "browser_automation_find",
			label: "检索页面元素",
			description: "按 text/role/name 在页面树内检索，返回 matches（含 @e ref 与祖先 path）。命中静态文本时 interactiveAncestorRef 才是可点击目标。超出 maxResults 时按 hint 缩小范围。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
				text: Type.Optional(Type.String({ description: "按可见文本模糊匹配（含静态文本节点）。" })),
				role: Type.Optional(Type.String({ description: "按 ARIA role 精确匹配，如 button/link/textbox。" })),
				name: Type.Optional(Type.String({ description: "按可访问名称模糊匹配。" })),
				interactiveOnly: Type.Optional(Type.Boolean({ description: "默认 true：role/name 检索只命中可交互节点。" })),
				maxResults: Type.Optional(Type.Number({ description: "默认 20。" })),
			}),
			execute: async (params) => {
				const sessionOpts = sessionOptionsFromParams(params);
				const sessionId = await ensureAutomationSession(cfg, sessionOpts);
				const data = await postAutomation<{ result: unknown }>(cfg, "/api/browser-automation/find", {
					sessionId,
					query: {
						text: params.text,
						role: params.role,
						name: params.name,
						interactiveOnly: params.interactiveOnly,
						maxResults: params.maxResults,
					},
				});
				return { sessionId, ...(data.result as object) };
			},
		});

		defineStoTool(api, {
			id: "ba_read_page",
			domain: "browser-automation",
			resultType: "browser_automation_read_page",
			label: "读取页面全文",
			description: "滚动收集页面正文（去重 + 冻结检测）。complete=false 时携带 nextStart 续读；超长文本返回 artifact（本地路径 + sha256）。只读内容，不给可操作 ref。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				embedRuntimeId: EMBED_RUNTIME_ID_PARAM,
				maxPages: Type.Optional(Type.Number({ description: "滚动屏数上限（默认 60）。" })),
				includeArtifact: Type.Optional(Type.Boolean({ description: "为 true 时全量文本额外落盘返回 artifact 引用。" })),
				startOffset: Type.Optional(Type.Number({ description: "续读起点：上一页返回的 nextStart。" })),
			}),
			execute: async (params) => {
				const sessionOpts = sessionOptionsFromParams(params);
				const sessionId = await ensureAutomationSession(cfg, sessionOpts);
				const data = await postAutomation<{ result: unknown }>(cfg, "/api/browser-automation/read-page", {
					sessionId,
					opts: {
						maxPages: params.maxPages,
						includeArtifact: params.includeArtifact,
						startOffset: params.startOffset,
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
