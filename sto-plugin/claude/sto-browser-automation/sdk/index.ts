import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { isEmbedAppChatSessionKey } from "../../../../shared/session-type.js";
import { getOrCreateBrowserAutomationToken } from "../../../../electron/utils/openclaw-auth.js";
import {
	BA_SYSTEM_PROMPT,
	BROWSER_AUTOMATION_MCP_SERVER_NAME,
	createBrowserAutomationMcpServer,
} from "../tools.js";

export interface ClaudeRuntimeOptions {
	systemPromptAppend?: string;
	mcpServers?: Record<string, McpServerConfig>;
}

export interface StoBrowserAutomationClaudeRuntimeContext {
	sessionKey: string;
	hostApiPort: number;
	hostApiHost?: string;
}

export function buildStoBrowserAutomationClaudeRuntimeOptions(
	context: StoBrowserAutomationClaudeRuntimeContext,
): ClaudeRuntimeOptions {
	if (isEmbedAppChatSessionKey(context.sessionKey)) {
		return {};
	}

	let authToken: string | undefined;
	try {
		authToken = getOrCreateBrowserAutomationToken();
	} catch {
		authToken = undefined;
	}

	return {
		systemPromptAppend: BA_SYSTEM_PROMPT,
		mcpServers: {
			[BROWSER_AUTOMATION_MCP_SERVER_NAME]: createBrowserAutomationMcpServer({
				hostApiHost: context.hostApiHost ?? "127.0.0.1",
				hostApiPort: context.hostApiPort,
				authToken,
			}),
		},
	};
}

export { BROWSER_AUTOMATION_MCP_SERVER_NAME, BA_SYSTEM_PROMPT } from "../tools.js";
