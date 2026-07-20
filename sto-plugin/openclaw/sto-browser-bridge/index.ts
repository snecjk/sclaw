import { Type } from "./typebox-shim.js";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { defineStoTool } from "./define-sto-tool.js";
import {
	bridgeOptionsFromParams,
	listBridgeSessions,
	runBridgeCommand,
	type BrowserBridgePluginConfig,
} from "./bridge-client.js";

const TAG = "sto-browser-bridge";

const SESSION_ID_PARAM = Type.Optional(
	Type.String({
		description:
			"Bridge 会话 ID。应用广场内嵌预览必须传 embed-<runtimeId>（见聊天上下文 bridgeSessionId）。",
	}),
);

const BRIDGE_SYSTEM_PROMPT = [
	"浏览器桥接工具（bridge_*，重要）：",
	"- **应用广场内嵌预览（左侧 webview）**：必须用 bridge_*，且每次调用传 sessionId（embed-<runtimeId>）。禁止 browser / shell:openExternal。",
	"- 流程：bridge_snapshot({ sessionId }) → bridge_click({ sessionId, name: \"菜单名\" }) 或 bridge_click({ sessionId, ref: \"@e5\" })。",
	"- **外部 Chrome 已登录标签**：可用 bridge_*（无需 sessionId，自动选扩展会话）；需安装 StoClaw Browser Bridge 扩展。",
	"- 无登录态爬取、自动化测试 → 使用原生 browser 工具（托管浏览器），不要用 bridge_*。",
	"- 仅打开链接给用户看（非操作页面）→ shell:openExternal。",
].join("\n");

export default definePluginEntry({
	id: "sto-browser-bridge",
	name: "StoClaw Browser Bridge",
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
				"获取当前浏览器页面可交互元素树（含 @e ref）。应用广场内嵌预览须传 sessionId；操作前必须先调用。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
			}),
			execute: async (params) => {
				const result = await runBridgeCommand(cfg, "snapshot", {}, bridgeOptionsFromParams(params));
				return result;
			},
		});

		defineStoTool(api, {
			id: "bridge_click",
			domain: "browser-bridge",
			resultType: "browser_click",
			label: "点击页面元素",
			description:
				"点击页面元素。ref 来自 bridge_snapshot；也可用 name 按可见文案匹配（如「客户管理」）。内嵌预览须传 sessionId。",
			parameters: Type.Object({
				sessionId: SESSION_ID_PARAM,
				ref: Type.Optional(Type.String({ description: "元素 ref，如 @e5" })),
				name: Type.Optional(Type.String({ description: "可见文案，如「客户管理」" })),
			}),
			execute: async (params) => {
				const payload: Record<string, unknown> = {};
				if (params.ref) payload.ref = params.ref;
				if (params.name) payload.name = params.name;
				return runBridgeCommand(cfg, "click", payload, bridgeOptionsFromParams(params));
			},
		});

		defineStoTool(api, {
			id: "bridge_fill",
			domain: "browser-bridge",
			resultType: "browser_fill",
			label: "填写表单字段",
			description: "在输入框中填写内容。ref 来自 bridge_snapshot；内嵌预览须传 sessionId。",
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
				return runBridgeCommand(cfg, "fill", payload, bridgeOptionsFromParams(params));
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
			description: "检查内置 webview 或 Chrome 扩展是否已连接，返回活动会话列表。",
			parameters: Type.Object({}),
			execute: async () => listBridgeSessions(cfg),
		});
	},
});
