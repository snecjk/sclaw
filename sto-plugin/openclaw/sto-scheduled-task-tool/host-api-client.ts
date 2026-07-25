export type ScheduledTaskToolPluginConfig = {
	hostApiHost?: string;
	hostApiPort?: number;
	timeoutMs?: number;
};

export type CreateScheduledTaskRequest = {
	name: string;
	cronExpr: string;
	prompt: string;
	engineType: 'openclaw';
	agentId: string;
	enabled?: boolean;
	workflowCode?: string | null;
	/** 与 DingTalkMention[] 同构；落 schedule_tasks.dingtalk_recipients_json */
	dingtalkRecipients?: Array<{
		type: 'user' | 'group';
		displayName: string;
		userId?: string;
		openConversationId?: string;
		corpId?: string;
	}> | null;
};

export type CreateScheduledTaskResponse = {
	id: string;
	name: string;
	cronExpr: string;
	engineType: string;
	agentId: string;
	enabled: boolean;
	nextRunAt?: string | null;
	prompt?: string;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3210;
const DEFAULT_TIMEOUT_MS = 60_000;

function baseUrl(cfg: ScheduledTaskToolPluginConfig): string {
	const host = cfg.hostApiHost ?? DEFAULT_HOST;
	const port = cfg.hostApiPort ?? DEFAULT_PORT;
	return `http://${host}:${port}`;
}

async function fetchJson<T>(
	cfg: ScheduledTaskToolPluginConfig,
	path: string,
	init?: RequestInit,
): Promise<T> {
	const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${baseUrl(cfg)}${path}`, {
			...init,
			signal: controller.signal,
		});
		const payload = (await response.json()) as T & {
			success?: boolean;
			error?: string;
		};
		if (!response.ok || payload.success === false) {
			const message =
				typeof payload.error === 'string'
					? payload.error
					: `HTTP ${response.status}`;
			throw new Error(message);
		}
		return payload;
	} finally {
		clearTimeout(timer);
	}
}

/** POST /api/scheduled-tasks — 落 SQLite schedule_tasks，不写 Gateway jobs.json。 */
export async function postCreateScheduledTask(
	cfg: ScheduledTaskToolPluginConfig,
	body: CreateScheduledTaskRequest,
): Promise<CreateScheduledTaskResponse> {
	return fetchJson(cfg, '/api/scheduled-tasks', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}
