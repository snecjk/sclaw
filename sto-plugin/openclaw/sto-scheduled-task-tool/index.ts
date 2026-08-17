import { Type } from './typebox-shim.js';
import { definePluginEntry, type OpenClawPluginApi } from './api.js';
import {
	evaluateScheduledTaskCreationBlock,
	isScheduledTaskExecutionSessionKey,
	SCHEDULED_TASK_CORE_PROMPT,
} from './shared/scheduled-task-instruction.js';
import { normalizeDingTalkMentions } from './shared/dingtalk-send/dingtalk-mention.js';
import {
	postCreateScheduledTask,
	type ScheduledTaskAttachmentInput,
	type ScheduledTaskSkillInput,
	type ScheduledTaskToolPluginConfig,
} from './host-api-client.js';

const TAG = 'sto-scheduled-task-tool';

/** 与 UI / cron-math 的最多离散时刻数对齐 */
const MAX_CRON_EXPR_PARTS = 12;

const CRON_EXPR_FIELD_DESCRIPTION =
	'5 段 cron（分钟 小时 日 月 星期），或用分号拼接最多 12 条独立 5 段。例：每天 9:00 为 "0 9 * * *"；每天 9:00 和 15:30 为 "0 9 * * *;30 15 * * *"；每月最后一天为 "0 9 L * *"。';

function looksLikeCronExprParam(expr: string): boolean {
	const parts = expr
		.split(';')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (parts.length === 0 || parts.length > MAX_CRON_EXPR_PARTS) return false;
	return parts.every((part) => part.split(/\s+/).length === 5);
}

/**
 * 普通会话：引导 NL 走 HostApi 统一建任务。
 * 落库字段与 Modal bake 对齐（skill_code / workflow_code / extra.composerSegments / attachments）。
 */
const SCHEDULED_TASK_CREATION_SYSTEM_PROMPT = [
	'定时任务创建（重要）：',
	'- 用户要求创建/安排定时或周期性任务时，必须调用 `create_scheduled_task`。',
	'- **禁止**调用内置 `cron` 工具（系统已禁用；会写入 Gateway jobs.json 造成双调度）。',
	'- 必填：name（短标题）、cronExpr、prompt（到点执行的**干净业务指令**）。',
	'- cronExpr：标准 5 段 `分钟 小时 日 月 星期`，按主机本地时区。一天多个独立时刻用 `;` 拼接（最多 12 条，从早到晚，各段日/星期必须相同），如每天 09:00 和 15:30 → `0 9 * * *;30 15 * * *`；不要写成笛卡尔积 `0,30 9,15 * * *`（会多跑 09:30、15:00）。每周多选如 `0 9 * * 1,3`；每月多选如 `0 9 1,15 * *`；当月最后一个自然日用 `L`（`0 9 L * *`，与日期同时选 `0 9 1,L * *`）。只要 30 号就写 `30`，不要用 L。',
	'- prompt 规则：只写到点要做的业务正文；可用 `@真实展示名`、`[文件: 真实文件名]`、`[技能: 真实技能标题]`（必须是会话里出现过的真实值，**禁止**照抄 `<…>` / `文件名` / `标题` 这类文档占位符）。**禁止**把收件人规则大块、`[media attached:…]`、调度说明塞进 prompt。',
	'- **结构化字段强制（与 UI Modal 同构；写入 extra.composerSegments，可多个）**：',
	'  · recipients：用户 @ 的钉钉人/群（完整 JSON）；**不写** dingtalk_recipients_json 列。',
	'  · attachments：本轮附图，sourcePath 必须复制用户消息里的 `[media attached: <绝对路径> (mime) | …]`；系统复制到任务持久目录。有文件却不传 attachments = 执行时丢附件。',
	'  · skills / skillCode：必须传 slug（可从 `<!-- SClaw-Skill {"slug":"…"} -->` 或技能目录读取）；可多个；**不写** skill_code 列。',
	'  · workflowCode / workflowName：任务内容若包含执行工作流，**必须**传（如 wf_xxx + 展示名）；可多个；**不写** workflow_code 列。',
].join('\n');

const recipientItemSchema = Type.Object({
	type: Type.Union([Type.Literal('user'), Type.Literal('group')]),
	displayName: Type.String({ description: '展示名' }),
	userId: Type.Optional(Type.String({ description: '钉钉 userId（type=user）' })),
	openConversationId: Type.Optional(
		Type.String({ description: '群 openConversationId（type=group）' }),
	),
	corpId: Type.Optional(Type.String({ description: '可选 corpId' })),
});

const attachmentItemSchema = Type.Object({
	sourcePath: Type.String({
		description:
			'本地绝对路径（通常为 ~/.stoclaw/openclaw/media/outbound/...），来自用户消息 [media attached: path (mime) | …]',
	}),
	fileName: Type.Optional(Type.String({ description: '文件名' })),
	mimeType: Type.Optional(Type.String({ description: 'MIME，如 application/vnd.ms-excel' })),
});

const skillItemSchema = Type.Object({
	slug: Type.String({ description: '技能 slug' }),
	title: Type.Optional(Type.String({ description: '技能展示标题' })),
});

function toolResult(payload: Record<string, unknown>) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
		details: payload,
	};
}

function normalizeAttachments(raw: unknown): ScheduledTaskAttachmentInput[] {
	if (!Array.isArray(raw)) return [];
	const out: ScheduledTaskAttachmentInput[] = [];
	const seen = new Set<string>();
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const record = item as Record<string, unknown>;
		const sourcePath =
			typeof record.sourcePath === 'string' ? record.sourcePath.trim() : '';
		if (!sourcePath || seen.has(sourcePath)) continue;
		seen.add(sourcePath);
		out.push({
			sourcePath,
			fileName:
				typeof record.fileName === 'string' && record.fileName.trim()
					? record.fileName.trim()
					: undefined,
			mimeType:
				typeof record.mimeType === 'string' && record.mimeType.trim()
					? record.mimeType.trim()
					: undefined,
		});
	}
	return out;
}

function normalizeSkills(raw: unknown, skillCode?: string): ScheduledTaskSkillInput[] {
	const out: ScheduledTaskSkillInput[] = [];
	const seen = new Set<string>();
	const push = (slug: string, title?: string) => {
		const s = slug.trim();
		if (!s || seen.has(s)) return;
		seen.add(s);
		out.push({ slug: s, title: title?.trim() || undefined });
	};
	if (Array.isArray(raw)) {
		for (const item of raw) {
			if (!item || typeof item !== 'object') continue;
			const record = item as Record<string, unknown>;
			if (typeof record.slug === 'string') {
				push(
					record.slug,
					typeof record.title === 'string' ? record.title : undefined,
				);
			}
		}
	}
	if (skillCode?.trim()) push(skillCode.trim());
	return out;
}

export default definePluginEntry({
	id: 'sto-scheduled-task-tool',
	name: '申通定时任务创建工具',
	description: '自然语言创建定时任务：经 HostApi 写入统一 schedule_tasks，不经 Gateway cron',
	register(api: OpenClawPluginApi) {
		const cfg = (api.pluginConfig ?? {}) as ScheduledTaskToolPluginConfig;
		api.logger.info?.(
			`[${TAG}] registering host=${cfg.hostApiHost ?? '127.0.0.1'}:${cfg.hostApiPort ?? 3210}`,
		);

		api.on('before_prompt_build', async (_event, ctx) => {
			if (isScheduledTaskExecutionSessionKey(ctx.sessionKey)) {
				return { appendSystemContext: SCHEDULED_TASK_CORE_PROMPT };
			}
			return { appendSystemContext: SCHEDULED_TASK_CREATION_SYSTEM_PROMPT };
		});

		api.on(
			'before_tool_call',
			(event, ctx) => {
				const decision = evaluateScheduledTaskCreationBlock({
					sessionKey: ctx.sessionKey ?? ctx.sessionId,
					toolName: event.toolName,
				});
				if (decision.blocked) {
					api.logger.warn?.(
						`[${TAG}] blocked tool=${event.toolName}: ${decision.reason}`,
					);
					return {
						block: true,
						blockReason: decision.reason,
					};
				}
			},
			{ priority: 110 },
		);

		api.registerTool((toolContext) => ({
			name: 'create_scheduled_task',
			label: '创建定时任务',
			description: [
				'创建 OpenClaw 本地定时任务（立即生效，写入 StoClaw 统一 schedule_tasks）。',
				'cronExpr 为单条 5 段，或用分号拼接最多 12 条独立 5 段（一天多个时刻；每月最后一天用 L）。',
				'落库与 UI Modal 同构：prompt 干净；recipients→extra.composerSegments；attachments 持久化；skills→skill_code；workflowCode→workflow_code。',
				'若用户消息含文件/技能/工作流：必须传 attachments（media 绝对路径）、skills/skillCode、workflowCode/workflowName；禁止只写进 prompt。',
				'禁止使用内置 cron 工具。',
			].join(' '),
			parameters: Type.Object({
				name: Type.String({ description: '任务短标题，例如「生成周报」' }),
				cronExpr: Type.String({
					description: CRON_EXPR_FIELD_DESCRIPTION,
				}),
				prompt: Type.String({
					description:
						'到点业务指令（干净）。用真实 @名 / [文件:真实文件名] / [技能:真实标题]；禁止照抄 <技能slug/名称> 等文档占位；不要塞收件人规则大块或 media attached 行。',
				}),
				agentId: Type.Optional(
					Type.String({ description: '目标 agent id；缺省 main' }),
				),
				workflowCode: Type.Optional(
					Type.String({ description: '工作流实例 id（如 wf_xxx）；任务含执行工作流时必传' }),
				),
				workflowName: Type.Optional(
					Type.String({ description: '工作流展示名' }),
				),
				skillCode: Type.Optional(
					Type.String({ description: '主技能 slug（与 skills[0] 等价）' }),
				),
				skills: Type.Optional(
					Type.Array(skillItemSchema, {
						description: '用到的技能列表（slug + title）；有技能时必传',
					}),
				),
				enabled: Type.Optional(
					Type.Boolean({ description: '是否立即启用；缺省 true' }),
				),
				recipients: Type.Optional(
					Type.Array(recipientItemSchema, {
						description:
							'钉钉收件人（DingTalkMention[]）。用户 @ 选人时必须传入；写入 extra.composerSegments。',
					}),
				),
				attachments: Type.Optional(
					Type.Array(attachmentItemSchema, {
						description:
							'附图。来自 [media attached: path (mime) | …] 时必须传 sourcePath。',
					}),
				),
			}),
			execute: async (_toolCallId, params) => {
				const name = typeof params.name === 'string' ? params.name.trim() : '';
				const cronExpr =
					typeof params.cronExpr === 'string' ? params.cronExpr.trim() : '';
				const prompt =
					typeof params.prompt === 'string' ? params.prompt.trim() : '';
				const agentId =
					typeof params.agentId === 'string' && params.agentId.trim()
						? params.agentId.trim()
						: 'main';
				const workflowCode =
					typeof params.workflowCode === 'string' && params.workflowCode.trim()
						? params.workflowCode.trim()
						: null;
				const workflowName =
					typeof params.workflowName === 'string' && params.workflowName.trim()
						? params.workflowName.trim()
						: null;
				const skillCode =
					typeof params.skillCode === 'string' && params.skillCode.trim()
						? params.skillCode.trim()
						: null;
				const enabled =
					typeof params.enabled === 'boolean' ? params.enabled : true;
				const recipients = normalizeDingTalkMentions(params.recipients);
				const attachments = normalizeAttachments(params.attachments);
				const skills = normalizeSkills(params.skills, skillCode ?? undefined);
				const sessionKey =
					typeof toolContext.sessionKey === 'string' && toolContext.sessionKey.trim()
						? toolContext.sessionKey.trim()
						: null;

				if (!name || !cronExpr || !prompt) {
					const missing: string[] = [];
					if (!name) missing.push('name');
					if (!cronExpr) missing.push('cronExpr');
					if (!prompt) missing.push('prompt');
					return toolResult({
						type: 'scheduled_task_created',
						success: false,
						error: `缺少必填参数: ${missing.join(', ')}`,
					});
				}

				if (!looksLikeCronExprParam(cronExpr)) {
					return toolResult({
						type: 'scheduled_task_created',
						success: false,
						error: 'cronExpr 必须是标准 5 段，多个独立时刻用分号拼接（最多 12 条）',
						cronExpr,
					});
				}

				api.logger.info?.(
					`[${TAG}] create_scheduled_task name=${name} cron=${cronExpr} agent=${agentId}`
					+ ` recipients=${recipients.length} attachments=${attachments.length}`
					+ ` skills=${skills.length} workflow=${workflowCode ?? '-'} session=${sessionKey ?? '-'}`,
				);

				try {
					const task = await postCreateScheduledTask(cfg, {
						name,
						cronExpr,
						prompt,
						engineType: 'openclaw',
						agentId,
						enabled,
						workflowCode,
						workflowName,
						skillCode: skills[0]?.slug ?? skillCode,
						skills: skills.length ? skills : null,
						dingtalkRecipients: null,
						recipients: recipients.length ? recipients : null,
						extra: null,
						attachments: attachments.length ? attachments : null,
						sessionKey,
					});
					return toolResult({
						type: 'scheduled_task_created',
						success: true,
						task: {
							id: task.id,
							name: task.name,
							cronExpr: task.cronExpr,
							engineType: task.engineType,
							agentId: task.agentId,
							enabled: task.enabled,
							nextRunAt: task.nextRunAt ?? null,
							skillCode: task.skillCode ?? skills[0]?.slug ?? null,
							workflowCode: task.workflowCode ?? workflowCode,
							recipientCount: recipients.length,
							attachmentCount: attachments.length,
						},
						message: `已创建定时任务「${task.name}」（${task.cronExpr}）。`,
					});
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					api.logger.warn?.(`[${TAG}] create failed: ${message}`);
					return toolResult({
						type: 'scheduled_task_created',
						success: false,
						error: message,
					});
				}
			},
		}), { name: 'create_scheduled_task' });

		api.logger.info?.(`[${TAG}] plugin registered successfully`);
	},
});
