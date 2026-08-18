export type BrowserAutomationPluginConfig = {
	hostApiHost?: string;
	hostApiPort?: number;
	commandTimeoutMs?: number;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3210;

function baseUrl(cfg: BrowserAutomationPluginConfig): string {
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
		`${baseUrl(cfg)}/api/browser-automation/sessions`,
	);
	return data.sessions ?? [];
}

export async function postAutomation<T>(
	cfg: BrowserAutomationPluginConfig,
	path: string,
	body: Record<string, unknown>,
): Promise<T> {
	return fetchJson<T>(`${baseUrl(cfg)}${path}`, {
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
}): string {
	const header = `URL: ${observation.url ?? ""}\nTitle: ${observation.title ?? ""}\n`;
	const lines = (observation.elements ?? []).slice(0, 80).map((el) => {
		const flags = [el.clickable ? "click" : null, el.editable ? "edit" : null].filter(Boolean).join(",");
		return `${el.ref} [${el.role}] ${el.name}${flags ? ` (${flags})` : ""}`;
	});
	return `${header}${lines.join("\n")}`;
}
