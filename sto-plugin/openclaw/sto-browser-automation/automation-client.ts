export type BrowserAutomationPluginConfig = {
	hostApiHost?: string;
	hostApiPort?: number;
	commandTimeoutMs?: number;
	/** 由 openclaw.json 插件 config 注入（主进程 C3 写入）；loopback API 的 Bearer token。 */
	authToken?: string;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3210;

function baseUrl(cfg: BrowserAutomationPluginConfig): string {
	const host = cfg.hostApiHost ?? DEFAULT_HOST;
	const port = cfg.hostApiPort ?? DEFAULT_PORT;
	return `http://${host}:${port}`;
}

/** 统一注入鉴权头（P0-3）：配置了 authToken 时所有请求携带 Authorization: Bearer。 */
function buildHeaders(cfg: BrowserAutomationPluginConfig, base?: Record<string, string>): Record<string, string> {
	const headers: Record<string, string> = { ...(base ?? {}) };
	if (cfg.authToken) {
		headers["Authorization"] = `Bearer ${cfg.authToken}`;
	}
	return headers;
}

async function fetchJson<T>(cfg: BrowserAutomationPluginConfig, url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, {
		...init,
		headers: buildHeaders(cfg, (init?.headers as Record<string, string> | undefined) ?? undefined),
	});
	const payload = await response.json() as T & { success?: boolean; error?: unknown };
	if (!response.ok) {
		if (response.status === 401) {
			throw new Error("BAP 鉴权失败：请重启 StoClaw 以刷新插件配置");
		}
		const errorPayload = typeof payload === "object" && payload ? payload.error : undefined;
		let message: string;
		if (typeof errorPayload === "string") {
			message = errorPayload;
		} else if (errorPayload && typeof errorPayload === "object" && "message" in errorPayload) {
			// 服务端结构化错误 { code, message }（如 401 UNAUTHORIZED / 403 HOST_MISMATCH）
			message = String((errorPayload as { message: unknown }).message);
		} else {
			message = `HTTP ${response.status}`;
		}
		throw new Error(message);
	}
	return payload;
}

export async function ensureAutomationSession(
	cfg: BrowserAutomationPluginConfig,
	params: { sessionId?: string; embedRuntimeId?: string; url?: string },
): Promise<string> {
	if (params.sessionId) {
		if (params.sessionId.startsWith('embed-')) {
			return params.sessionId;
		}
		const sessions = await listAutomationSessions(cfg);
		if (sessions.some((session) => session.sessionId === params.sessionId)) {
			return params.sessionId;
		}
	}

	if (params.embedRuntimeId) {
		const sessionId = `embed-${params.embedRuntimeId}`;
		const created = await fetchJson<{ session: { sessionId: string } }>(
			cfg,
			`${baseUrl(cfg)}/api/browser-automation/sessions`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ embedRuntimeId: params.embedRuntimeId }),
			},
		);
		return created.session.sessionId ?? sessionId;
	}

	if (params.url) {
		const created = await fetchJson<{ session: { sessionId: string } }>(
			cfg,
			`${baseUrl(cfg)}/api/browser-automation/sessions`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: params.url }),
			},
		);
		return created.session.sessionId;
	}

	throw new Error("sessionId, embedRuntimeId, or url is required");
}

export async function listAutomationSessions(cfg: BrowserAutomationPluginConfig) {
	const data = await fetchJson<{ sessions: Array<{ sessionId: string; source: string; url: string; title: string }> }>(
		cfg,
		`${baseUrl(cfg)}/api/browser-automation/sessions`,
	);
	return data.sessions ?? [];
}

export async function postAutomation<T>(
	cfg: BrowserAutomationPluginConfig,
	path: string,
	body: Record<string, unknown>,
): Promise<T> {
	return fetchJson<T>(cfg, `${baseUrl(cfg)}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

export function sessionOptionsFromParams(params: {
	sessionId?: string;
	embedRuntimeId?: string;
}) {
	const sessionId = typeof params.sessionId === "string" ? params.sessionId.trim() : undefined;
	const embedRuntimeId = typeof params.embedRuntimeId === "string" ? params.embedRuntimeId.trim() : undefined;
	return {
		sessionId: sessionId || (embedRuntimeId ? `embed-${embedRuntimeId}` : undefined),
		embedRuntimeId: embedRuntimeId || (sessionId?.startsWith("embed-") ? sessionId.slice("embed-".length) : undefined),
	};
}

export function formatObservationElements(observation: {
	elements?: Array<{ ref: string; role: string; name: string; clickable?: boolean; editable?: boolean }>;
	url?: string;
	title?: string;
	documentGeneration?: number;
	observationMode?: string;
	truncated?: boolean;
}): string {
	// 透出 documentGeneration / observationMode：ba_act 需携带代际（STALE_REF 语义），模式供判断回退
	const header = [
		`URL: ${observation.url ?? ""}`,
		`Title: ${observation.title ?? ""}`,
		`Mode: ${observation.observationMode ?? "dom"}`,
		`Generation: ${observation.documentGeneration ?? 0}${observation.truncated ? " (truncated)" : ""}`,
		"",
	].join("\n");
	const lines = (observation.elements ?? []).slice(0, 80).map((el) => {
		const flags = [el.clickable ? "click" : null, el.editable ? "edit" : null].filter(Boolean).join(",");
		return `${el.ref} [${el.role}] ${el.name}${flags ? ` (${flags})` : ""}`;
	});
	return `${header}${lines.join("\n")}`;
}
