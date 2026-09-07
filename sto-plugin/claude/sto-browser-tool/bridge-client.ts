import { pickBridgeSession } from "../../../shared/browser-bridge/pick-session.js";
import { annotateHealedSession } from "../../../shared/browser-bridge/failed-payload.js";
import { resolveCommandTimeoutMs } from "../../../shared/browser-bridge/command-budget.js";

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

type BridgeHttpPayload = {
	success?: boolean;
	error?: string;
	message?: string;
	currentSessionId?: string | null;
	commandId?: string;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, init);
	const payload = await response.json() as T & BridgeHttpPayload;
	if (!response.ok) {
		const code = typeof payload === "object" && payload && "error" in payload
			? String(payload.error)
			: "";
		const detail = typeof payload === "object" && payload && typeof payload.message === "string"
			? payload.message
			: "";
		const message = detail || code || `HTTP ${response.status}`;
		throw Object.assign(new Error(message), { status: response.status, payload });
	}
	return payload;
}

function isSessionStaleError(error: unknown): error is Error & { payload?: BridgeHttpPayload } {
	return error instanceof Error && (
		error.message === "SESSION_STALE"
		|| error.message === "Session not found"
	);
}

async function postCommand(
	cfg: BrowserBridgePluginConfig,
	sessionId: string,
	action: string,
	payload: Record<string, unknown>,
): Promise<{ commandId: string }> {
	return fetchJson<{ commandId: string }>(
		`${baseUrl(cfg)}/api/browser-bridge/command`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sessionId, action, payload }),
		},
	);
}

export async function listBridgeSessions(
	cfg: BrowserBridgePluginConfig,
): Promise<SessionSummary[]> {
	const data = await fetchJson<{ sessions: SessionSummary[] }>(
		`${baseUrl(cfg)}/api/browser-bridge/sessions`,
	);
	return data.sessions ?? [];
}

async function ensureExtensionSession(
	cfg: BrowserBridgePluginConfig,
	url?: string,
): Promise<string> {
	const data = await fetchJson<{ sessionId?: string }>(
		`${baseUrl(cfg)}/api/browser-bridge/ensure-session`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url }),
		},
	);
	if (!data.sessionId) {
		throw new Error("浏览器未连接。请安装 StoClaw Browser Bridge 扩展，并在 SClaw 中允许连接 Google Chrome。");
	}
	return data.sessionId;
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
			const url = typeof payload.url === "string" ? payload.url : undefined;
			sessionId = await ensureExtensionSession(cfg, url);
		} else {
			sessionId = target.sessionId;
		}
	}

	const timeoutMs = resolveCommandTimeoutMs(action, cfg.commandTimeoutMs);

	const postOrHeal = async (id: string): Promise<{ commandId: string; sessionId: string }> => {
		try {
			const commandResponse = await postCommand(cfg, id, action, payload);
			return { commandId: commandResponse.commandId, sessionId: id };
		} catch (error) {
			if (!isSessionStaleError(error) || embedOnly) throw error;
			const hinted = (error as { payload?: BridgeHttpPayload }).payload?.currentSessionId;
			const sessions = await listBridgeSessions(cfg);
			const target = hinted
				? sessions.find((session) => session.sessionId === hinted)
				: pickBridgeSession(sessions, { ...options, embedOnly });
			if (!target || target.sessionId === id) throw error;
			const commandResponse = await postCommand(cfg, target.sessionId, action, payload);
			return { commandId: commandResponse.commandId, sessionId: target.sessionId };
		}
	};

	const posted = await postOrHeal(sessionId);
	const requestedSessionId = sessionId;
	sessionId = posted.sessionId;
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const resultResponse = await fetchJson<{
			ready: boolean;
			result?: { result?: unknown };
		}>(
			`${baseUrl(cfg)}/api/browser-bridge/result?commandId=${encodeURIComponent(posted.commandId)}`,
		);
		if (resultResponse.ready && resultResponse.result) {
			return annotateHealedSession(
				resultResponse.result.result,
				requestedSessionId,
				posted.sessionId,
			);
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
