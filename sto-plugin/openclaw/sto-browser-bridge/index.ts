import { Type } from "./typebox-shim.js";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { defineStoTool } from "./define-sto-tool.js";
import { BRIDGE_SYSTEM_PROMPT } from "./prompts.js";
import {
	bridgeOptionsFromParams,
	listBridgeSessions,
	runBridgeCommand,
	type BrowserBridgePluginConfig,
} from "./bridge-client.js";
import { attachSuccessfulActProgress } from "../../../shared/browser-bridge/act-progress.js";
import { formatBridgeSessionList } from "../../../shared/browser-bridge/pick-session.js";

const TAG = "sto-browser-bridge";

const SESSION_ID_PARAM = Type.Optional(
	Type.String({
		description:
			"Bridge 会话 ID。应用广场内嵌预览必须传 embed-<runtimeId>（见聊天上下文 bridgeSessionId）。",
	}),
);

export default definePluginEntry({
	id: "sto-browser-bridge",
	name: "SClaw Web Bridge",
	description: "通过内置 webview 或 Chrome 扩展操作用户浏览器页面",
	register(api: OpenClawPluginApi) {
		const cfg = (api.pluginConfig ?? {}) as BrowserBridgePluginConfig;
		api.logger.info?.(`[${TAG}] registering host=${cfg.hostApiHost ?? "127.0.0.1"}:${cfg.hostApiPort ?? 3210}`);

		api.on("before_prompt_build", async () => ({
			appendSystemContext: BRIDGE_SYSTEM_PROMPT,
		}));

		defineStoTool(api, {
			id: "bridge_snapshot",
			domain: "browser-bridge",
			resultType: "browser_snapshot",
			label: "获取浏览器页面快照",
			description:
				"获取当前浏览器页面可交互元素列表（扁平 elements，含 @e ref）。默认无障碍树；失败时回退 DOM 并标注 observationMode。应用广场内嵌预览须传 sessionId。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				mode: Type.Optional(Type.Union([
					Type.Literal("dom"),
					Type.Literal("ax"),
				])),
			}),
			execute: async (params) => {
				const payload: Record<string, unknown> = {};
				if (params.mode) payload.mode = params.mode;
				const result = await runBridgeCommand(cfg, "snapshot", payload, bridgeOptionsFromParams(params));
				return result;
			},
		});

		defineStoTool(api, {
			id: "bridge_click",
			domain: "browser-bridge",
			resultType: "browser_click",
			label: "点击页面元素",
			description:
				"点击页面元素。可直接传 name 按可见文案匹配；ref 来自 bridge_snapshot。返回 url/navigated。内嵌预览须传 sessionId。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				ref: Type.Optional(Type.String({ description: "元素 ref，如 @e5" })),
				name: Type.Optional(Type.String({ description: "可见文案，如「客户管理」" })),
			}),
			execute: async (params) => {
				const payload: Record<string, unknown> = {};
				if (params.ref) payload.ref = params.ref;
				if (params.name) payload.name = params.name;
				const options = bridgeOptionsFromParams(params);
				const result = await runBridgeCommand(cfg, "click", payload, options);
				return attachSuccessfulActProgress({
					action: "click",
					payload,
					result,
					snapshot: () => runBridgeCommand(cfg, "snapshot", {}, options),
				});
			},
		});

		defineStoTool(api, {
			id: "bridge_fill",
			domain: "browser-bridge",
			resultType: "browser_fill",
			label: "填写表单字段",
			description: "在输入框中填写内容（CDP 真实输入 + 填后校验）。ref 来自 bridge_snapshot；内嵌预览须传 sessionId。失败时返回 error。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				ref: Type.Optional(Type.String({ description: "元素 ref，如 @e3" })),
				name: Type.Optional(Type.String({ description: "字段可见文案或 placeholder" })),
				value: Type.String({ description: "要填写的内容" }),
			}),
			execute: async (params) => {
				const payload: Record<string, unknown> = { value: params.value };
				if (params.ref) payload.ref = params.ref;
				if (params.name) payload.name = params.name;
				const options = bridgeOptionsFromParams(params);
				const result = await runBridgeCommand(cfg, "fill", payload, options);
				return attachSuccessfulActProgress({
					action: "fill",
					payload,
					result,
					snapshot: () => runBridgeCommand(cfg, "snapshot", {}, options),
				});
			},
		});

		defineStoTool(api, {
			id: "bridge_navigate",
			domain: "browser-bridge",
			resultType: "browser_navigate",
			label: "导航到 URL",
			description: "在当前 bridge 会话页面中导航到指定 URL。内嵌预览须传 sessionId。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				url: Type.String({ description: "目标 URL" }),
			}),
			execute: async (params) =>
				runBridgeCommand(cfg, "navigate", { url: params.url }, bridgeOptionsFromParams(params)),
		});

		defineStoTool(api, {
			id: "bridge_screenshot",
			domain: "browser-bridge",
			resultType: "browser_screenshot",
			label: "截取页面截图",
			description: "截取当前 bridge 会话页面可见区域。内嵌预览须传 sessionId。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
			}),
			execute: async (params) =>
				runBridgeCommand(cfg, "screenshot", {}, bridgeOptionsFromParams(params)),
		});

		defineStoTool(api, {
			id: "bridge_list_sessions",
			domain: "browser-bridge",
			resultType: "browser_sessions",
			label: "列出浏览器桥接会话",
			description: "列出活动桥接会话。source=extension 是本机 Chrome（SClaw Web Bridge）；source=embed 是应用内 webview。主聊天打开网页必须用 extension。",
			parameters: Type.Object({}),
			execute: async () => formatBridgeSessionList(await listBridgeSessions(cfg)),
		});

		defineStoTool(api, {
			id: "bridge_read_page",
			domain: "browser-bridge",
			resultType: "browser_read_page",
			label: "读取页面正文",
			description: "滚动收集当前 bridge 会话可见正文。内嵌预览须传 sessionId。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
			}),
			execute: async (params) =>
				runBridgeCommand(cfg, "read_page", {}, bridgeOptionsFromParams(params)),
		});

		defineStoTool(api, {
			id: "bridge_print_pdf",
			domain: "browser-bridge",
			resultType: "browser_print_pdf",
			label: "导出页面 PDF",
			description: "将当前 bridge 会话页面导出为 PDF。内嵌预览须传 sessionId。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
			}),
			execute: async (params) =>
				runBridgeCommand(cfg, "print_pdf", {}, bridgeOptionsFromParams(params)),
		});

		defineStoTool(api, {
			id: "bridge_cdp",
			domain: "browser-bridge",
			resultType: "browser_cdp",
			label: "调用白名单 CDP 方法",
			description: "对当前会话发送白名单内的 CDP 方法。内嵌预览须传 sessionId。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				method: Type.String({ description: "CDP 方法名，如 Runtime.evaluate" }),
				params: Type.Optional(Type.Object({}, { additionalProperties: true })),
			}),
			execute: async (params) => {
				const payload: Record<string, unknown> = { method: params.method };
				if (params.params) payload.params = params.params;
				const options = bridgeOptionsFromParams(params);
				const result = await runBridgeCommand(cfg, "cdp", payload, options);
				return attachSuccessfulActProgress({
					action: "cdp",
					payload,
					result,
					snapshot: () => runBridgeCommand(cfg, "snapshot", {}, options),
				});
			},
		});

		defineStoTool(api, {
			id: "bridge_group_tabs",
			domain: "browser-bridge",
			resultType: "browser_group_tabs",
			label: "按任务分组 Chrome 标签",
			description: "仅真实 Chrome 扩展会话有效；内嵌 webview 会返回 unsupported。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				groupId: Type.Optional(Type.String()),
				title: Type.Optional(Type.String()),
				color: Type.Optional(Type.String()),
				tabIds: Type.Optional(Type.Array(Type.Number())),
			}),
			execute: async (params) => {
				const payload: Record<string, unknown> = {};
				if (params.groupId) payload.groupId = params.groupId;
				if (params.title) payload.title = params.title;
				if (params.color) payload.color = params.color;
				if (params.tabIds) payload.tabIds = params.tabIds;
				return runBridgeCommand(cfg, "group_tabs", payload, bridgeOptionsFromParams(params));
			},
		});

		defineStoTool(api, {
			id: "bridge_mark_tabs",
			domain: "browser-bridge",
			resultType: "browser_mark_tabs",
			label: "标记被驱动的 Chrome 标签",
			description: "仅真实 Chrome 扩展会话有效；内嵌 webview 会返回 unsupported。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				marked: Type.Boolean({ description: "true 加上驱动标记，false 清除" }),
				label: Type.Optional(Type.String()),
			}),
			execute: async (params) => {
				const payload: Record<string, unknown> = { marked: params.marked };
				if (params.label) payload.label = params.label;
				return runBridgeCommand(cfg, "mark_tabs", payload, bridgeOptionsFromParams(params));
			},
		});
	},
});
