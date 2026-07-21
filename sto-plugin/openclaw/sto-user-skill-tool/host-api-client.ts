export type UserSkillToolPluginConfig = {
	hostApiHost?: string;
	hostApiPort?: number;
	timeoutMs?: number;
};

export type SaveUserSkillAsset = {
	path: string;
	content: string;
	encoding?: "utf8" | "base64";
};

export type SaveUserSkillRequest = {
	slug?: string;
	skillMd: string;
	name?: string;
	description?: string;
	assets?: SaveUserSkillAsset[];
	force?: boolean;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3210;
const DEFAULT_TIMEOUT_MS = 60_000;

function baseUrl(cfg: UserSkillToolPluginConfig): string {
	const host = cfg.hostApiHost ?? DEFAULT_HOST;
	const port = cfg.hostApiPort ?? DEFAULT_PORT;
	return `http://${host}:${port}`;
}

export async function postSaveUserSkill(
	cfg: UserSkillToolPluginConfig,
	body: SaveUserSkillRequest,
): Promise<Record<string, unknown>> {
	const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${baseUrl(cfg)}/api/skills/save-user`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		const payload = (await response.json()) as Record<string, unknown> & {
			success?: boolean;
			error?: string;
			code?: string;
		};
		if (!response.ok || payload.success === false) {
			const message =
				typeof payload.error === "string"
					? payload.error
					: `HTTP ${response.status}`;
			const code = typeof payload.code === "string" ? payload.code : "HOST_API_ERROR";
			throw new Error(`${code}: ${message}`);
		}
		return payload;
	} finally {
		clearTimeout(timer);
	}
}
