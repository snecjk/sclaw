import { normalizeBridgeSessionId } from "../../../shared/browser-bridge/pick-session.js";

/** TODO(web-bridge): 与 shared/browser-bridge/ship-gate.ts 保持一致。上线前 false。 */
const WEB_BRIDGE_ORDINARY_CHAT_ENABLED = false;

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
		throw new Error("浏览器未连接。请安装 SClaw Web Bridge 扩展，并在 SClaw 中允许连接 Google Chrome。");
	}
	return data.sessionId;
}

function isEmbedSession(session: SessionSummary): boolean {
	return session.source === 'embed' || session.tabId < 0 || session.sessionId.startsWith('embed-');
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
	if (options?.embedOnly) {
		return sessions.find(isEmbedSession) ?? null;
	}
	const extension = sessions.find((session) => !isEmbedSession(session));
	if (extension) return extension;
	return sessions[0] ?? null;
}

const RESULT_POLL_MS = 50;

/**
 * 超时预算（与 shared/browser-bridge/command-budget.ts 保持一致）。
 * 按动作的预算是生效值，config 里的 commandTimeoutMs 只是天花板：注入的 30s
 * 曾盖过 snapshot 的 45s 预算，让慢页面的快照必然假超时。
 */
const COMMAND_TIMEOUT_CEILING_MS = 240_000;
const ACTION_BUDGET_MS: Record<string, number> = {
	read_page: 45_000,
	screenshot: 45_000,
	snapshot: 45_000,
};
const DEFAULT_ACTION_BUDGET_MS = 25_000;

function resolveCommandTimeoutMs(action: string, configuredCeilingMs?: number): number {
	const budget = ACTION_BUDGET_MS[action] ?? DEFAULT_ACTION_BUDGET_MS;
	const configured =
		typeof configuredCeilingMs === "number" && Number.isFinite(configuredCeilingMs) && configuredCeilingMs > 0
			? configuredCeilingMs
			: COMMAND_TIMEOUT_CEILING_MS;
	return Math.min(budget, configured, COMMAND_TIMEOUT_CEILING_MS);
}

/**
 * 会话自愈必须对模型可见（与 shared/browser-bridge/failed-payload.ts 保持一致）。
 * 命令被改投到另一个会话却仍返回裸 success:true 时，模型会继续拿错误 / 编造的
 * sessionId 重试——实测出现过同一个 ref 连点 16 次、每次换一个不存在的会话。
 */
function annotateHealedSession(
	value: unknown,
	requestedSessionId: string | undefined,
	actualSessionId: string,
): unknown {
	if (!requestedSessionId || requestedSessionId === actualSessionId) return value;
	const note = `你请求的会话 ${requestedSessionId} 不存在，命令实际在 ${actualSessionId} 上执行。`
		+ `后续调用请改用 ${actualSessionId} 或直接省略 sessionId；不要再猜测会话 ID。`;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { result: value, healedSessionId: actualSessionId, requestedSessionId, actionHint: note };
	}
	return {
		...(value as Record<string, unknown>),
		healedSessionId: actualSessionId,
		requestedSessionId,
		actionHint: note,
	};
}

export async function runBridgeCommand(
	cfg: BrowserBridgePluginConfig,
	action: "snapshot" | "click" | "fill" | "navigate" | "screenshot" | "evaluate" | "scroll" | "read_page" | "print_pdf" | "cdp" | "group_tabs" | "mark_tabs",
	payload: Record<string, unknown> = {},
	options?: BridgeCommandOptions,
): Promise<unknown> {
	const sessionIdFromOptions = normalizeBridgeSessionId(options?.sessionId);
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
			// TODO(web-bridge): WEB_BRIDGE_ORDINARY_CHAT_ENABLED = true 后自动 ensure-session。
			if (WEB_BRIDGE_ORDINARY_CHAT_ENABLED) {
				const url = typeof payload.url === "string" ? payload.url : undefined;
				sessionId = await ensureExtensionSession(cfg, url);
			} else {
				throw new Error(
					"浏览器未连接。应用广场内嵌预览未就绪，或请安装浏览器扩展并完成配对。",
				);
			}
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

export function formatAccessibilityTree(tree: unknown[]): string {
	// 紧凑序列化：缩进对模型没有价值，但在大快照上是几万字符的纯开销。
	return JSON.stringify(tree);
}

export function bridgeOptionsFromParams(params: {
	sessionId?: string;
}): BridgeCommandOptions {
	const sessionId = normalizeBridgeSessionId(params.sessionId);
	return {
		sessionId,
		embedOnly: Boolean(sessionId?.startsWith('embed-')),
	};
}
