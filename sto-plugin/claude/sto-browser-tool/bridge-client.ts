export type BrowserBridgePluginConfig = {
	hostApiHost?: string;
	hostApiPort?: number;
	commandTimeoutMs?: number;
};

export type BridgeCommandOptions = {
	sessionId?: string;
	/** When true, never fall back to Chrome extension sessions. */
	embedOnly?: boolean;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3210;

type SessionSummary = {
	sessionId: string;
	tabId: number;
	url: string;
	title: string;
	source?: string;
	embedRuntimeId?: string;
};

function baseUrl(cfg: BrowserBridgePluginConfig): string {
	const host = cfg.hostApiHost ?? DEFAULT_HOST;
	const port = cfg.hostApiPort ?? DEFAULT_PORT;
	return `http://${host}:${port}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, init);
	const payload = await response.json() as T & { success?: boolean; error?: string };
	if (!response.ok) {
		const message = typeof payload === "object" && payload && "error" in payload
			? String(payload.error)
			: `HTTP ${response.status}`;
		throw new Error(message);
	}
	return payload;
}

export async function listBridgeSessions(
	cfg: BrowserBridgePluginConfig,
): Promise<SessionSummary[]> {
	const data = await fetchJson<{ sessions: SessionSummary[] }>(
		`${baseUrl(cfg)}/api/browser-bridge/sessions`,
	);
	return data.sessions ?? [];
}

function isEmbedSession(session: SessionSummary): boolean {
	return session.source === 'embed' || session.tabId < 0;
}

function pickBridgeSession(
	sessions: SessionSummary[],
	options?: BridgeCommandOptions,
): SessionSummary | null {
	if (options?.sessionId) {
		const exact = sessions.find((session) => session.sessionId === options.sessionId);
		if (exact) return exact;
		if (options.embedOnly || options.sessionId.startsWith('embed-')) {
			return null;
		}
	}

	const embed = sessions.find(isEmbedSession);
	if (embed) return embed;
	if (options?.embedOnly) return null;
	return sessions[0] ?? null;
}

const RESULT_POLL_MS = 50;

export async function runBridgeCommand(
	cfg: BrowserBridgePluginConfig,
	action: "snapshot" | "click" | "fill" | "navigate" | "screenshot" | "evaluate" | "scroll" | "read_page" | "print_pdf" | "cdp" | "group_tabs" | "mark_tabs",
	payload: Record<string, unknown> = {},
	options?: BridgeCommandOptions,
): Promise<unknown> {
	const sessionIdFromOptions = options?.sessionId?.trim();
	const embedOnly = options?.embedOnly || Boolean(sessionIdFromOptions?.startsWith('embed-'));
	let sessionId = sessionIdFromOptions;

	if (!sessionId) {
		const sessions = await listBridgeSessions(cfg);
		const target = pickBridgeSession(sessions, { ...options, embedOnly });
		if (!target) {
			if (embedOnly) {
				throw new Error(
					`应用广场内置浏览器未就绪（sessionId=${options?.sessionId ?? 'embed'}）。请确认左侧页面已加载完成后再试。`,
				);
			}
			throw new Error(
				"浏览器未连接。应用广场内嵌预览未就绪，或请安装 StoClaw Browser Bridge 扩展并完成配对。",
			);
		}
		sessionId = target.sessionId;
	}

	const timeoutMs = cfg.commandTimeoutMs ?? 30_000;
	const commandResponse = await fetchJson<{ commandId: string }>(
		`${baseUrl(cfg)}/api/browser-bridge/command`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sessionId, action, payload }),
		},
	);
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const resultResponse = await fetchJson<{
			ready: boolean;
			result?: { result?: unknown };
		}>(
			`${baseUrl(cfg)}/api/browser-bridge/result?commandId=${encodeURIComponent(commandResponse.commandId)}`,
		);
		if (resultResponse.ready && resultResponse.result) {
			return resultResponse.result.result;
		}
		await new Promise((resolve) => setTimeout(resolve, RESULT_POLL_MS));
	}
	throw new Error(`浏览器命令超时: ${action}`);
}

export function bridgeOptionsFromParams(params: {
	sessionId?: string;
}): BridgeCommandOptions {
	const sessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : undefined;
	return {
		sessionId,
		embedOnly: Boolean(sessionId?.startsWith('embed-')),
	};
}
