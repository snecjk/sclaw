import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "../zod-shim.js";
import {
	bridgeOptionsFromParams,
	listBridgeSessions,
	runBridgeCommand,
	type BrowserBridgePluginConfig,
} from "./bridge-client.js";
import {
	BRIDGE_SYSTEM_PROMPT,
	EMBED_BRIDGE_SYSTEM_PROMPT,
} from "../../../shared/browser-bridge/prompts.js";

export const BROWSER_MCP_SERVER_NAME = "sto-browser-tool";

export { BRIDGE_SYSTEM_PROMPT, EMBED_BRIDGE_SYSTEM_PROMPT };

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
		{
			sessionId: sessionIdSchema,
			mode: z.enum(["dom", "ax"]).optional().describe("ax 优先无障碍树；扩展未支持时回退 DOM"),
		},
		async (params) => {
			const payload: Record<string, unknown> = {};
			if (params.mode) payload.mode = params.mode;
			return runBridgeTool(cfg, "snapshot", payload, bridgeOptionsFromParams(params));
		},
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

	const bridgeReadPage = tool(
		"bridge_read_page",
		"滚动收集当前 bridge 会话可见正文。内嵌预览须传 sessionId。",
		{ sessionId: sessionIdSchema },
		async (params) => runBridgeTool(cfg, "read_page", {}, bridgeOptionsFromParams(params)),
	);

	const bridgePrintPdf = tool(
		"bridge_print_pdf",
		"将当前 bridge 会话页面导出为 PDF。内嵌预览须传 sessionId。",
		{ sessionId: sessionIdSchema },
		async (params) => runBridgeTool(cfg, "print_pdf", {}, bridgeOptionsFromParams(params)),
	);

	const bridgeCdp = tool(
		"bridge_cdp",
		"对当前会话发送白名单内的 CDP 方法。内嵌预览须传 sessionId。",
		{
			sessionId: sessionIdSchema,
			method: z.string().describe("CDP 方法名，如 Runtime.evaluate"),
			params: z.record(z.unknown()).optional(),
		},
		async (params) => {
			const payload: Record<string, unknown> = { method: params.method };
			if (params.params) payload.params = params.params;
			return runBridgeTool(cfg, "cdp", payload, bridgeOptionsFromParams(params));
		},
	);

	const bridgeGroupTabs = tool(
		"bridge_group_tabs",
		"仅真实 Chrome 扩展会话有效；内嵌 webview 会返回 unsupported。",
		{
			sessionId: sessionIdSchema,
			groupId: z.string().optional(),
			title: z.string().optional(),
			color: z.string().optional(),
			tabIds: z.array(z.number()).optional(),
		},
		async (params) => {
			const payload: Record<string, unknown> = {};
			if (params.groupId) payload.groupId = params.groupId;
			if (params.title) payload.title = params.title;
			if (params.color) payload.color = params.color;
			if (params.tabIds) payload.tabIds = params.tabIds;
			return runBridgeTool(cfg, "group_tabs", payload, bridgeOptionsFromParams(params));
		},
	);

	const bridgeMarkTabs = tool(
		"bridge_mark_tabs",
		"仅真实 Chrome 扩展会话有效；给被驱动标签加/清视觉标记。",
		{
			sessionId: sessionIdSchema,
			marked: z.boolean().describe("true 加上驱动标记，false 清除"),
			label: z.string().optional(),
		},
		async (params) => {
			const payload: Record<string, unknown> = { marked: params.marked };
			if (params.label) payload.label = params.label;
			return runBridgeTool(cfg, "mark_tabs", payload, bridgeOptionsFromParams(params));
		},
	);

	return [
		bridgeSnapshot,
		bridgeClick,
		bridgeFill,
		bridgeNavigate,
		bridgeScreenshot,
		bridgeListSessions,
		bridgeReadPage,
		bridgePrintPdf,
		bridgeCdp,
		bridgeGroupTabs,
		bridgeMarkTabs,
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
