import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "../zod-shim.js";
import {
	bridgeOptionsFromParams,
	listBridgeSessions,
	runBridgeCommand,
	type BrowserBridgePluginConfig,
} from "./bridge-client.js";

export const BROWSER_MCP_SERVER_NAME = "sto-browser-tool";

export const BRIDGE_SYSTEM_PROMPT = [
	"浏览器桥接工具（bridge_*，重要）：",
	"- **应用广场内嵌预览（左侧 webview）**：必须用 bridge_*，且每次调用传 sessionId（embed-<runtimeId>）。禁止 browser / shell:openExternal。",
	"- **简单点击/打开**：直接 bridge_click({ sessionId, name: \"菜单名\" })，返回 url 与 navigated；无需先 snapshot，无需 ba_wait。",
	"- 需要定位 ref 时：bridge_snapshot({ sessionId }) → bridge_click({ sessionId, ref: \"@e5\" })。",
	"- **外部 Chrome 已登录标签**：可用 bridge_*（无需 sessionId，自动选扩展会话）；需安装 StoClaw Browser Bridge 扩展。",
	"- 无登录态爬取、自动化测试 → 使用原生 browser 工具（托管浏览器），不要用 bridge_*。",
	"- 仅打开链接给用户看（非操作页面）→ shell:openExternal。",
].join("\n");

export const EMBED_BRIDGE_SYSTEM_PROMPT = [
	"【当前为应用广场内嵌浏览器会话】用户左侧 webview 已连接 bridge；必须从用户消息 JSON 读取 bridgeSessionId 并在每次 bridge_* 调用中传入 sessionId。",
	"**仅使用 bridge_*（bridge_click / bridge_snapshot / bridge_fill 等），不要调用 ba_*。**",
	"",
	BRIDGE_SYSTEM_PROMPT,
].join("\n");

function textResult(value: unknown, isError = false): CallToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
		isError,
	};
}

async function runBridgeTool(
	cfg: BrowserBridgePluginConfig,
	action: Parameters<typeof runBridgeCommand>[1],
	payload: Record<string, unknown>,
	options: ReturnType<typeof bridgeOptionsFromParams>,
): Promise<CallToolResult> {
	try {
		const result = await runBridgeCommand(cfg, action, payload, options);
		return textResult(result, false);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return textResult({ success: false, error: message }, true);
	}
}

export function createBrowserMcpTools(cfg: BrowserBridgePluginConfig) {
	const sessionIdSchema = z.string().optional().describe(
		"Bridge 会话 ID。应用广场内嵌预览必须传 embed-<runtimeId>（见聊天上下文 bridgeSessionId）。",
	);

	const bridgeSnapshot = tool(
		"bridge_snapshot",
		"获取当前浏览器页面可交互元素树（含 @e ref）。应用广场内嵌预览须传 sessionId。",
		{ sessionId: sessionIdSchema },
		async (params) => runBridgeTool(cfg, "snapshot", {}, bridgeOptionsFromParams(params)),
	);

	const bridgeClick = tool(
		"bridge_click",
		"点击页面元素。可直接传 name 按可见文案匹配；ref 来自 bridge_snapshot。返回 url/navigated。内嵌预览须传 sessionId。",
		{
			sessionId: sessionIdSchema,
			ref: z.string().optional().describe("元素 ref，如 @e5"),
			name: z.string().optional().describe("可见文案，如「客户管理」"),
		},
		async (params) => {
			const payload: Record<string, unknown> = {};
			if (params.ref) payload.ref = params.ref;
			if (params.name) payload.name = params.name;
			return runBridgeTool(cfg, "click", payload, bridgeOptionsFromParams(params));
		},
	);

	const bridgeFill = tool(
		"bridge_fill",
		"在输入框中填写内容。ref/name 来自 bridge_snapshot；内嵌预览须传 sessionId。",
		{
			sessionId: sessionIdSchema,
			ref: z.string().optional().describe("元素 ref，如 @e3"),
			name: z.string().optional().describe("字段可见文案或 placeholder"),
			value: z.string().describe("要填写的内容"),
		},
		async (params) => {
			const payload: Record<string, unknown> = { value: params.value };
			if (params.ref) payload.ref = params.ref;
			if (params.name) payload.name = params.name;
			return runBridgeTool(cfg, "fill", payload, bridgeOptionsFromParams(params));
		},
	);

	const bridgeNavigate = tool(
		"bridge_navigate",
		"在当前 bridge 会话页面中导航到指定 URL。内嵌预览须传 sessionId。",
		{
			sessionId: sessionIdSchema,
			url: z.string().describe("目标 URL"),
		},
		async (params) => runBridgeTool(
			cfg,
			"navigate",
			{ url: params.url },
			bridgeOptionsFromParams(params),
		),
	);

	const bridgeScreenshot = tool(
		"bridge_screenshot",
		"截取当前 bridge 会话页面可见区域。内嵌预览须传 sessionId。",
		{ sessionId: sessionIdSchema },
		async (params) => runBridgeTool(cfg, "screenshot", {}, bridgeOptionsFromParams(params)),
	);

	const bridgeListSessions = tool(
		"bridge_list_sessions",
		"检查内置 webview 或 Chrome 扩展是否已连接，返回活动会话列表。",
		{},
		async () => {
			try {
				const sessions = await listBridgeSessions(cfg);
				return textResult(sessions);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult({ success: false, error: message }, true);
			}
		},
	);

	return [
		bridgeSnapshot,
		bridgeClick,
		bridgeFill,
		bridgeNavigate,
		bridgeScreenshot,
		bridgeListSessions,
	];
}

export function createBrowserMcpServer(cfg: BrowserBridgePluginConfig) {
	return createSdkMcpServer({
		name: BROWSER_MCP_SERVER_NAME,
		version: "1.0.0",
		instructions: [
			"Use bridge_* tools to operate the user's connected browser (embed webview or Chrome extension).",
			"For App Plaza embed chat, always pass sessionId from bridgeSessionId in the user message JSON.",
		].join(" "),
		tools: createBrowserMcpTools(cfg),
	});
}

export function browserMcpToolName(toolName: string): string {
	return `mcp__${BROWSER_MCP_SERVER_NAME}__${toolName}`;
}
