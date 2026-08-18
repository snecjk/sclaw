import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { isEmbedAppChatSessionKey } from "../../../../shared/session-type.js";
import {
	BROWSER_MCP_SERVER_NAME,
	BRIDGE_SYSTEM_PROMPT,
	createBrowserMcpServer,
	EMBED_BRIDGE_SYSTEM_PROMPT,
} from "../tools.js";

export interface ClaudeRuntimeOptions {
	systemPromptAppend?: string;
	mcpServers?: Record<string, McpServerConfig>;
}

export interface StoBrowserToolClaudeRuntimeContext {
	sessionKey: string;
	hostApiPort: number;
	hostApiHost?: string;
}

export function buildStoBrowserToolClaudeRuntimeOptions(
	context: StoBrowserToolClaudeRuntimeContext,
): ClaudeRuntimeOptions {
	const isEmbedSession = isEmbedAppChatSessionKey(context.sessionKey);

	return {
		systemPromptAppend: isEmbedSession ? EMBED_BRIDGE_SYSTEM_PROMPT : BRIDGE_SYSTEM_PROMPT,
		mcpServers: {
			[BROWSER_MCP_SERVER_NAME]: createBrowserMcpServer({
				hostApiHost: context.hostApiHost ?? "127.0.0.1",
				hostApiPort: context.hostApiPort,
			}),
		},
	};
}

export { BROWSER_MCP_SERVER_NAME } from "../tools.js";
