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
	type ScheduledTaskToolPluginConfig,
} from './host-api-client.js';

const TAG = 'sto-scheduled-task-tool';

/** 普通会话：引导 NL 走 HostApi 统一建任务，禁止内置 cron（会写 jobs.json）。 */
const SCHEDULED_TASK_CREATION_SYSTEM_PROMPT = [
	'定时任务创建（重要）：',
	'- 用户要求创建/安排定时或周期性任务时，必须调用 `create_scheduled_task`。',
	'- **禁止**调用内置 `cron` 工具（系统已禁用；会写入 Gateway jobs.json 造成双调度）。',
	'- 传入：name（短标题）、cronExpr（标准 5 段，如 `0 9 * * *`）、prompt（到点要执行的业务指令原文）。',
	'- 可选 agentId（缺省 main）、workflowCode（若任务要跑某工作流实例）。',
	'- 若本轮对话含 StoClaw 钉钉收件人 JSON（用户 @ 选人），必须把结构化收件人原样传入可选参数 `recipients`；**禁止**把收件人规则大块烘进 prompt。',
	'- prompt 只写业务指令，保持干净。',
	'- 创建成功后简短确认任务名、cron 与 nextRunAt；无需再弹确认、不要重复创建。',
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

function toolResult(payload: Record<string, unknown>) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
		details: payload,
	};
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
				// 模块 B：纯执行语义。钉钉格式/必发由统一执行器 systemPromptAppend（OpenClaw 下 prepend 进 message）条件注入。
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

		api.registerTool({
			name: 'create_scheduled_task',
			label: '创建定时任务',
			description: [
				'创建 OpenClaw 本地定时任务（立即生效，写入 StoClaw 统一 schedule_tasks）。',
				'用户说「每天/每周/每月 … 做某事」时使用。',
				'必须传标准 5 段 cronExpr；prompt 为到点执行的业务指令（不要塞收件人规则大块）。',
				'若用户 @ 了钉钉收件人，传入 recipients（与对话收件人 JSON 同构），系统写入 dingtalk_recipients_json。',
				'禁止使用内置 cron 工具。',
			].join(' '),
			parameters: Type.Object({
				name: Type.String({ description: '任务短标题，例如「生成周报」' }),
				cronExpr: Type.String({
					description: '标准 5 段 cron，例如 "0 9 * * *"（每天 9:00）',
				}),
				prompt: Type.String({
					description: '到点要执行的业务指令原文（不要塞调度说明或收件人规则大块）',
				}),
				agentId: Type.Optional(
					Type.String({ description: '目标 agent id；缺省 main' }),
				),
				workflowCode: Type.Optional(
					Type.String({ description: '可选工作流实例 id（如 wf_xxx）' }),
				),
				enabled: Type.Optional(
					Type.Boolean({ description: '是否立即启用；缺省 true' }),
				),
				recipients: Type.Optional(
					Type.Array(recipientItemSchema, {
						description:
							'可选钉钉收件人（与 DingTalkMention[] 同构）。来自用户 @ 选人时必须传入。',
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
				const enabled =
					typeof params.enabled === 'boolean' ? params.enabled : true;
				const recipients = normalizeDingTalkMentions(params.recipients);
				const dingtalkRecipients = recipients.length > 0 ? recipients : null;

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

				const cronParts = cronExpr.split(/\s+/);
				if (cronParts.length !== 5) {
					return toolResult({
						type: 'scheduled_task_created',
						success: false,
						error: 'cronExpr 必须是标准 5 段表达式',
						cronExpr,
					});
				}

				api.logger.info?.(
					`[${TAG}] create_scheduled_task name=${name} cron=${cronExpr} agent=${agentId} recipients=${dingtalkRecipients?.length ?? 0}`,
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
						dingtalkRecipients,
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
							recipientCount: dingtalkRecipients?.length ?? 0,
						},
						message: `已创建定时任务「${task.name}」（${task.cronExpr}）`,
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
		});

		api.logger.info?.(`[${TAG}] plugin registered successfully`);
	},
});
