import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type StoToolkitLogger = {
	info?: (message: string) => void;
	warn?: (message: string) => void;
};

export type StoToolkitConfig = {
	baseUrl?: string;
	ssoAuthPath?: string;
	timeoutMs?: number;
	logger?: StoToolkitLogger;
};

const LOG_BODY_MAX = 4_000;

function truncateForLog(text: string, max = LOG_BODY_MAX): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}…(truncated ${text.length - max} chars)`;
}

type SsoAuthInfo = {
	stoToken?: string;
	userName?: string;
};

export interface StoApiResponse<T> {
	success: boolean;
	data: T | null;
	errCode?: string;
	errMessage?: string;
	traceId?: string;
}

const DEFAULT_SSO_AUTH_PATH = "~/.stoclaw/openclaw/sso-auth.json";
const DEFAULT_TIMEOUT_MS = 30_000;

function resolveTildePath(filePath: string): string {
	if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
		return resolve(homedir(), filePath.slice(2));
	}
	return resolve(filePath);
}

function generateTraceId(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function readSsoAuth(ssoAuthPath: string): Promise<SsoAuthInfo> {
	const resolved = resolveTildePath(ssoAuthPath);
	const raw = await readFile(resolved, "utf-8");
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	return {
		stoToken: typeof parsed.stoToken === "string" ? parsed.stoToken : undefined,
		userName: typeof parsed.userName === "string" ? parsed.userName : undefined,
	};
}

export type StoApiClient = {
	fetchJson<T>(path: string, init?: RequestInit): Promise<T>;
	getBaseUrl(): string;
};

export function createStoApiClient(config: StoToolkitConfig): StoApiClient {
	const baseUrl = (config.baseUrl ?? "").replace(/\/$/, "");
	const ssoAuthPath = config.ssoAuthPath?.trim() || DEFAULT_SSO_AUTH_PATH;
	const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const log = config.logger;

	if (!baseUrl) {
		throw new Error("sto-toolkit: baseUrl is required in plugin config");
	}

	async function authHeaders(): Promise<Record<string, string>> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"X-Trace-Id": generateTraceId(),
			"X-Source-Client": "stoclaw",
		};
		try {
			const sso = await readSsoAuth(ssoAuthPath);
			if (sso.stoToken) headers.stoToken = sso.stoToken;
		} catch {
			// SSO optional for some endpoints; API will reject if required.
		}
		return headers;
	}

	async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
		const method = (init.method ?? "GET").toUpperCase();
		const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
		const headers = {
			...(await authHeaders()),
			...(init.headers as Record<string, string> | undefined),
		};
		const requestBody =
			typeof init.body === "string" ? init.body : init.body ? String(init.body) : "";
		log?.info?.(
			`[workflow-api] >>> ${method} ${path} url=${url} body=${truncateForLog(requestBody || "(none)")}`,
		);

		let resp: Response;
		try {
			resp = await fetch(url, {
				...init,
				headers,
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log?.warn?.(`[workflow-api] <<< ${method} ${path} network-error: ${message}`);
			throw err;
		}

		const rawText = await resp.text();
		let body: StoApiResponse<T>;
		try {
			body = JSON.parse(rawText) as StoApiResponse<T>;
		} catch {
			log?.warn?.(
				`[workflow-api] <<< ${method} ${path} status=${resp.status} invalid-json response=${truncateForLog(rawText)}`,
			);
			throw new Error(`HTTP ${resp.status}: invalid JSON response`);
		}

		if (!resp.ok || !body.success || body.data === null) {
			const msg =
				body.errMessage
				|| (body.errCode ? `STO API error: ${body.errCode}` : `HTTP ${resp.status}`);
			log?.warn?.(
				`[workflow-api] <<< ${method} ${path} status=${resp.status} traceId=${body.traceId ?? "(none)"} error=${msg} response=${truncateForLog(rawText)}`,
			);
			throw new Error(msg);
		}

		log?.info?.(
			`[workflow-api] <<< ${method} ${path} status=${resp.status} traceId=${body.traceId ?? "(none)"} response=${truncateForLog(rawText)}`,
		);
		return body.data;
	}

	return {
		fetchJson,
		getBaseUrl: () => baseUrl,
	};
}
