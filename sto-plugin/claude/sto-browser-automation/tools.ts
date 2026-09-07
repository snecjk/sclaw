import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "../zod-shim.js";
import {
	ensureAutomationSession,
	postAutomation,
	sessionOptionsFromParams,
	type BrowserAutomationPluginConfig,
} from "../../openclaw/sto-browser-automation/automation-client.js";
import { BA_SYSTEM_PROMPT } from "../../openclaw/sto-browser-automation/prompts.js";
import {
	annotateFailedToolPayload,
	isFailedToolPayload,
} from "../../../shared/browser-bridge/failed-payload.js";

export const BROWSER_AUTOMATION_MCP_SERVER_NAME = "sto-browser-automation";
export { BA_SYSTEM_PROMPT };

function textResult(value: unknown, isError = false): CallToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
		isError,
	};
}

async function run<T>(fn: () => Promise<T>): Promise<CallToolResult> {
	try {
		const value = await fn();
		if (isFailedToolPayload(value)) {
			return textResult(annotateFailedToolPayload(value), true);
		}
		return textResult(value);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return textResult(annotateFailedToolPayload({ success: false, error: message }), true);
	}
}

export function createBrowserAutomationMcpTools(cfg: BrowserAutomationPluginConfig) {
	const sessionId = z.string().optional().describe("自动化会话 ID。应用广场内嵌浏览器使用 embed-<runtimeId>。");
	const embedRuntimeId = z.string().optional().describe("应用广场 embed runtimeId；若未传 sessionId 则自动创建 embed 会话。");

	const baCreateSession = tool(
		"ba_create_session",
		"创建 embed 或 managed 自动化会话。embed 需 embedRuntimeId；managed 需 url。",
		{
			embedRuntimeId: embedRuntimeId,
			url: z.string().optional().describe("managed 会话起始 URL"),
			showManaged: z.boolean().optional(),
		},
		async (params) => run(async () => {
			const data = await postAutomation<{ session: unknown }>(cfg, "/api/browser-automation/sessions", {
				embedRuntimeId: params.embedRuntimeId,
				url: params.url,
				showManaged: params.showManaged,
			});
			return data.session;
		}),
	);

	const baObserve = tool(
		"ba_observe",
		"获取当前页面可交互元素列表（含 @e ref 与 documentGeneration）。操作前必须先 observe。",
		{
			sessionId,
			embedRuntimeId,
			mode: z.enum(["dom", "ax"]).optional(),
			interactiveOnly: z.boolean().optional(),
		},
		async (params) => run(async () => {
			const sessionOpts = sessionOptionsFromParams(params);
			const id = await ensureAutomationSession(cfg, sessionOpts);
			const data = await postAutomation<{ observation: unknown }>(cfg, "/api/browser-automation/observe", {
				sessionId: id,
				mode: params.mode,
				interactiveOnly: params.interactiveOnly,
			});
			return { sessionId: id, observation: data.observation };
		}),
	);

	const baAct = tool(
		"ba_act",
		"执行单步 click/fill/select/navigate/scroll/press/mouse_click。click 被遮挡时自动 CDP 降级。",
		{
			sessionId,
			embedRuntimeId,
			runId: z.string().optional(),
			action: z.enum([
				"click",
				"fill",
				"select",
				"navigate",
				"scroll",
				"press",
				"mouse_click",
				"screenshot",
				"print_pdf",
				"read_page",
				"network_capture",
			]),
			ref: z.string().optional(),
			stableKey: z.string().optional(),
			name: z.string().optional(),
			value: z.string().optional(),
			url: z.string().optional(),
			key: z.string().optional(),
			scrollY: z.number().optional(),
			generation: z.number().optional().describe("最近一次 ba_observe 的 documentGeneration"),
			snapshot: z.boolean().optional(),
		},
		async (params) => run(async () => {
			const sessionOpts = sessionOptionsFromParams(params);
			const id = await ensureAutomationSession(cfg, sessionOpts);
			const data = await postAutomation<{ result: unknown }>(cfg, "/api/browser-automation/act", {
				sessionId: id,
				runId: params.runId,
				payload: {
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
				},
			});
			return { sessionId: id, ...(data.result as object) };
		}),
	);

	const baWait = tool(
		"ba_wait",
		"等待 networkIdle、navigation、url、selector 或 timeout。",
		{
			sessionId,
			embedRuntimeId,
			type: z.enum(["networkIdle", "navigation", "url", "selector", "timeout"]),
			urlPattern: z.string().optional(),
			selector: z.string().optional(),
			stableKey: z.string().optional(),
			timeoutMs: z.number().optional(),
		},
		async (params) => run(async () => {
			const sessionOpts = sessionOptionsFromParams(params);
			const id = await ensureAutomationSession(cfg, sessionOpts);
			return postAutomation(cfg, "/api/browser-automation/wait", {
				sessionId: id,
				condition: {
					type: params.type,
					urlPattern: params.urlPattern,
					selector: params.selector,
					stableKey: params.stableKey,
					timeoutMs: params.timeoutMs,
				},
			});
		}),
	);

	const baValidate = tool(
		"ba_validate",
		"断言 URL/title/元素/text 等，用于 catch silent failure。",
		{
			sessionId,
			embedRuntimeId,
			runId: z.string().optional(),
			type: z.enum(["url", "title", "elementExists", "elementCount", "elementText"]),
			pattern: z.string().optional(),
			role: z.string().optional(),
			name: z.string().optional(),
			minCount: z.number().optional(),
			maxCount: z.number().optional(),
			expectedText: z.string().optional(),
		},
		async (params) => run(async () => {
			const sessionOpts = sessionOptionsFromParams(params);
			const id = await ensureAutomationSession(cfg, sessionOpts);
			const data = await postAutomation<{ result: unknown }>(cfg, "/api/browser-automation/validate", {
				sessionId: id,
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
			return { sessionId: id, ...(data.result as object) };
		}),
	);

	const baFind = tool(
		"ba_find",
		"按 text/role/name 检索页面元素。命中静态文本时 interactiveAncestorRef 才是可点击目标。",
		{
			sessionId,
			embedRuntimeId,
			text: z.string().optional(),
			role: z.string().optional(),
			name: z.string().optional(),
			interactiveOnly: z.boolean().optional(),
			maxResults: z.number().optional(),
		},
		async (params) => run(async () => {
			const sessionOpts = sessionOptionsFromParams(params);
			const id = await ensureAutomationSession(cfg, sessionOpts);
			const data = await postAutomation<{ result: unknown }>(cfg, "/api/browser-automation/find", {
				sessionId: id,
				query: {
					text: params.text,
					role: params.role,
					name: params.name,
					interactiveOnly: params.interactiveOnly,
					maxResults: params.maxResults,
				},
			});
			return { sessionId: id, ...(data.result as object) };
		}),
	);

	const baReadPage = tool(
		"ba_read_page",
		"滚动收集页面正文。complete=false 时携带 nextStart 续读。",
		{
			sessionId,
			embedRuntimeId,
			maxPages: z.number().optional(),
			includeArtifact: z.boolean().optional(),
			startOffset: z.number().optional(),
		},
		async (params) => run(async () => {
			const sessionOpts = sessionOptionsFromParams(params);
			const id = await ensureAutomationSession(cfg, sessionOpts);
			const data = await postAutomation<{ result: unknown }>(cfg, "/api/browser-automation/read-page", {
				sessionId: id,
				opts: {
					maxPages: params.maxPages,
					includeArtifact: params.includeArtifact,
					startOffset: params.startOffset,
				},
			});
			return { sessionId: id, ...(data.result as object) };
		}),
	);

	const baScreenshot = tool(
		"ba_screenshot",
		"截取当前页或指定元素。返回 artifact（path/sha256/bytes），不回 base64。",
		{
			sessionId,
			embedRuntimeId,
			ref: z.string().optional(),
			format: z.enum(["png", "jpeg"]).optional(),
			quality: z.number().optional(),
		},
		async (params) => run(async () => {
			const sessionOpts = sessionOptionsFromParams(params);
			const id = await ensureAutomationSession(cfg, sessionOpts);
			const data = await postAutomation<{ artifact: unknown }>(cfg, "/api/browser-automation/screenshot", {
				sessionId: id,
				ref: params.ref,
				format: params.format,
				quality: params.quality,
			});
			return { sessionId: id, artifact: data.artifact };
		}),
	);

	const baPrintPdf = tool(
		"ba_print_pdf",
		"将当前页导出为 PDF 产物。",
		{
			sessionId,
			embedRuntimeId,
			printBackground: z.boolean().optional(),
			landscape: z.boolean().optional(),
			pageRanges: z.string().optional(),
			scale: z.number().optional(),
		},
		async (params) => run(async () => {
			const sessionOpts = sessionOptionsFromParams(params);
			const id = await ensureAutomationSession(cfg, sessionOpts);
			const data = await postAutomation<{ artifact: unknown }>(cfg, "/api/browser-automation/print-pdf", {
				sessionId: id,
				opts: {
					printBackground: params.printBackground,
					landscape: params.landscape,
					pageRanges: params.pageRanges,
					scale: params.scale,
				},
			});
			return { sessionId: id, artifact: data.artifact };
		}),
	);

	const baNetworkCapture = tool(
		"ba_network_capture",
		"有界 CDP Network 抓包。op=start 开始；op=stop 结束并返回 HAR artifact。",
		{
			sessionId,
			embedRuntimeId,
			op: z.enum(["start", "stop"]),
			captureId: z.string().optional(),
			urlFilter: z.string().optional(),
			includeBodies: z.boolean().optional(),
		},
		async (params) => run(async () => {
			const sessionOpts = sessionOptionsFromParams(params);
			const id = await ensureAutomationSession(cfg, sessionOpts);
			const data = await postAutomation<{ result: unknown }>(cfg, "/api/browser-automation/network/capture", {
				sessionId: id,
				captureId: params.captureId,
				op: params.op,
				opts: {
					urlFilter: params.urlFilter,
					includeBodies: params.includeBodies,
				},
			});
			return { sessionId: id, ...(data.result as object) };
		}),
	);

	const baCdp = tool(
		"ba_cdp",
		"调用白名单 CDP 方法。表外方法返回 CDP_METHOD_NOT_ALLOWED。",
		{
			sessionId,
			embedRuntimeId,
			method: z.string(),
			params: z.record(z.string(), z.unknown()).optional(),
		},
		async (params) => run(async () => {
			const sessionOpts = sessionOptionsFromParams(params);
			const id = await ensureAutomationSession(cfg, sessionOpts);
			return postAutomation(cfg, "/api/browser-automation/cdp", {
				sessionId: id,
				method: params.method,
				params: params.params,
			});
		}),
	);

	const baStartRun = tool(
		"ba_start_run",
		"创建带步级 checkpoint 的 run。",
		{
			sessionId,
			embedRuntimeId,
			workflowRunId: z.string().optional(),
		},
		async (params) => run(async () => {
			const sessionOpts = sessionOptionsFromParams(params);
			const id = await ensureAutomationSession(cfg, sessionOpts);
			return postAutomation(cfg, "/api/browser-automation/runs", {
				sessionId: id,
				workflowRunId: params.workflowRunId,
			});
		}),
	);

	return [
		baCreateSession,
		baObserve,
		baAct,
		baWait,
		baValidate,
		baFind,
		baReadPage,
		baScreenshot,
		baPrintPdf,
		baNetworkCapture,
		baCdp,
		baStartRun,
	];
}

export function createBrowserAutomationMcpServer(cfg: BrowserAutomationPluginConfig) {
	return createSdkMcpServer({
		name: BROWSER_AUTOMATION_MCP_SERVER_NAME,
		version: "1.0.0",
		instructions: BA_SYSTEM_PROMPT,
		tools: createBrowserAutomationMcpTools(cfg),
	});
}

export function browserAutomationMcpToolName(toolName: string): string {
	return `mcp__${BROWSER_AUTOMATION_MCP_SERVER_NAME}__${toolName}`;
}
