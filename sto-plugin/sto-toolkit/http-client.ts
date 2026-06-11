import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type StoToolkitConfig = {
	baseUrl?: string;
	ssoAuthPath?: string;
	timeoutMs?: number;
};

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

	if (!baseUrl) {
		throw new Error("sto-toolkit: baseUrl is required in plugin config");
	}

	async function authHeaders(): Promise<Record<string, string>> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"X-Trace-Id": generateTraceId(),
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
		const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
		const headers = {
			...(await authHeaders()),
			...(init.headers as Record<string, string> | undefined),
		};
		const resp = await fetch(url, {
			...init,
			headers,
			signal: AbortSignal.timeout(timeoutMs),
		});
		const body = (await resp.json()) as StoApiResponse<T>;
		if (!resp.ok || !body.success || body.data === null) {
			const msg =
				body.errMessage
				|| (body.errCode ? `STO API error: ${body.errCode}` : `HTTP ${resp.status}`);
			throw new Error(msg);
		}
		return body.data;
	}

	return {
		fetchJson,
		getBaseUrl: () => baseUrl,
	};
}
