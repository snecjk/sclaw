/**
 * NL `create_scheduled_task` 落库对齐 Modal bake：
 * - prompt 干净（可含 @名 / [文件:] / [技能:] / 工作流执行句；**不含** `<!-- SClaw-Skill -->`）
 * - recipients / skills / workflows → extra.composerSegments（可多个）
 * - attachments → extra.composerAttachments（再由 persist 拷到任务目录）
 * - skill_code / workflow_code / dingtalk_recipients_json 列恒 null（extra 真源）
 */
import { basename } from 'node:path';
import type { DingTalkMention } from '../../shared/dingtalk-send/dingtalk-mention';
import { hasResolvedDingTalkMentions } from '../../shared/dingtalk-send/dingtalk-mention';
import {
  parseSkillTranscriptMarkers,
  stripSkillTranscriptMarkers,
} from '../../shared/skill-transcript-marker';
import {
  isPlausibleSkillLabel,
  promptAlreadyReferencesFile,
  promptAlreadyReferencesSkill,
  reconstructComposerSegmentsFromPrompt,
  sanitizeSkillPlaceholdersInPrompt,
  weaveStructuredRefsIntoPrompt,
} from '../../shared/scheduled-task-composer-segments';
import { unescapeLiteralNewlines } from '../../shared/text-escape';
import type { CreateScheduleTaskInput } from '../db/models/dto/schedule-task.dto';
import {
  prepareScheduledTaskAttachmentsForSave,
  type TaskComposerAttachmentRecord,
} from './scheduled-task-attachments';

export type NlSkillInput = { slug: string; title?: string };

function escapeGatewayPlaceholderLabel(value: string): string {
  return value.replace(/]/g, '］');
}

function collectMentions(input: {
  recipients?: DingTalkMention[] | null;
  dingtalkRecipients?: DingTalkMention[] | null;
  extra?: Record<string, unknown> | null;
}): DingTalkMention[] {
  const fromParam = [
    ...(Array.isArray(input.recipients) ? input.recipients : []),
    ...(Array.isArray(input.dingtalkRecipients) ? input.dingtalkRecipients : []),
  ];
  const fromExtra: DingTalkMention[] = [];
  const segments = input.extra?.composerSegments;
  if (Array.isArray(segments)) {
    for (const seg of segments) {
      if (!seg || typeof seg !== 'object') continue;
      const record = seg as { type?: string; mention?: DingTalkMention };
      if (record.type === 'mention' && record.mention) fromExtra.push(record.mention);
    }
  }
  const merged = new Map<string, DingTalkMention>();
  for (const m of [...fromExtra, ...fromParam]) {
    const key = m.type === 'group'
      ? `g:${m.openConversationId ?? m.displayName}`
      : `u:${m.userId ?? m.displayName}`;
    if (!merged.has(key)) merged.set(key, m);
  }
  const list = [...merged.values()];
  return hasResolvedDingTalkMentions(list) ? list : list.filter((m) => m.displayName?.trim());
}

function collectSkills(input: {
  skillCode?: string | null;
  skills?: NlSkillInput[] | null;
  extra?: Record<string, unknown> | null;
  /** NL 常把 chat 里的 SClaw-Skill marker 粘进 prompt：先收 slug 再剥注释 */
  prompt?: string | null;
}): NlSkillInput[] {
  const out: NlSkillInput[] = [];
  const seen = new Set<string>();
  const push = (slug: string, title?: string) => {
    const s = slug.trim();
    const t = title?.trim() || s;
    // 拒绝模型误包的「的定时任务，cron为…」等假 skill
    if (!s || seen.has(s)) return;
    if (!isPlausibleSkillLabel(t) && !isPlausibleSkillLabel(s)) return;
    seen.add(s);
    out.push({ slug: s, title: t });
  };
  if (Array.isArray(input.skills)) {
    for (const sk of input.skills) {
      if (sk?.slug) push(sk.slug, sk.title);
    }
  }
  if (input.skillCode?.trim()) push(input.skillCode.trim());
  const segments = input.extra?.composerSegments;
  if (Array.isArray(segments)) {
    for (const seg of segments) {
      if (!seg || typeof seg !== 'object') continue;
      const record = seg as { type?: string; slug?: string; title?: string };
      if (record.type === 'skill' && record.slug) push(record.slug, record.title);
    }
  }
  if (input.prompt) {
    for (const sk of parseSkillTranscriptMarkers(input.prompt)) {
      push(sk.slug, sk.title);
    }
  }
  return out;
}

function buildGatewayBody(input: {
  prompt: string;
  attachments: TaskComposerAttachmentRecord[];
  skills: NlSkillInput[];
  mentions: DingTalkMention[];
  workflowCode?: string | null;
  workflowName?: string | null;
}): string {
  // 优先把附件/技能织进 NL 正文（「标题」技能、根据…和…），避免一律前置堆砌
  const woven = weaveStructuredRefsIntoPrompt({
    prompt: input.prompt.trim(),
    attachments: input.attachments,
    skills: input.skills,
  });
  let body = woven.prompt;

  const parts: string[] = [];
  for (const att of woven.remainingAttachments) {
    const name = escapeGatewayPlaceholderLabel(att.fileName || basename(att.sourcePath || '') || '未知文件');
    if (!promptAlreadyReferencesFile(body, name)) {
      parts.push(`[文件: ${name}]`);
    }
  }
  for (const sk of woven.remainingSkills) {
    if (promptAlreadyReferencesSkill(body, sk)) continue;
    const label = escapeGatewayPlaceholderLabel((sk.title || sk.slug).trim() || '未知技能');
    parts.push(`[技能: ${label}]`);
  }
  for (const m of input.mentions) {
    const token = `@${m.displayName}`;
    if (m.displayName?.trim() && !body.includes(token)) {
      parts.push(token);
    }
  }

  if (parts.length > 0) {
    body = `${parts.join(' ')}\n\n${body}`.trim();
  }

  const wf = input.workflowCode?.trim();
  if (wf) {
    const label = (input.workflowName?.trim() || wf).trim();
    const exec = `帮我执行 id 为：${wf} 的工作流 【${label}】`;
    if (!body.includes(wf)) {
      body = body ? `${body}\n\n${exec}` : exec;
    }
  }

  return sanitizeSkillPlaceholdersInPrompt(body.trim(), input.skills);
}

/**
 * 把 NL / 宽松 create 入参收敛成与 Modal 同构的 CreateScheduleTaskInput 字段。
 *
 * **重要**：Modal 手动创建也会走 `createTask` → 本函数。若 `extra.composerSegments`
 * 已由 UI bake 好（交错的 text/chip），必须原样保留——不得抽成
 * `files+skills+text+mentions+workflows` 重排，否则编辑回填 chip 全堆两端、排版乱，
 * 且会误标 `createdVia: 'nl'`。
 */
export function alignScheduledTaskCreateToComposerModel(
  input: CreateScheduleTaskInput & {
    recipients?: DingTalkMention[] | null;
    skills?: NlSkillInput[] | null;
    workflowName?: string | null;
  },
): CreateScheduleTaskInput {
  const prepared = prepareScheduledTaskAttachmentsForSave({
    prompt: input.prompt,
    extra: input.extra,
    attachments: input.attachments,
  });

  const attachments = (
    Array.isArray(prepared.extra?.composerAttachments)
      ? prepared.extra!.composerAttachments
      : []
  ) as TaskComposerAttachmentRecord[];

  // 以「入参是否已带 composerSegments」判断 UI bake，不能看 prepare 之后——
  // prepare 会为 NL 稀疏入参补 file segments，若据此当 UI 会跳过 NL 重建。
  const inputSegments = Array.isArray(input.extra?.composerSegments)
    ? (input.extra!.composerSegments as unknown[]).filter((seg) => (
      Boolean(seg && typeof seg === 'object' && typeof (seg as { type?: string }).type === 'string')
    ))
    : [];

  // UI Modal 已 bake 的 segments：保留 prepare 同步路径后的交错顺序
  if (inputSegments.length > 0) {
    const preserved = Array.isArray(prepared.extra?.composerSegments)
      ? (prepared.extra!.composerSegments as unknown[]).filter((seg) => (
        Boolean(seg && typeof seg === 'object' && typeof (seg as { type?: string }).type === 'string')
      ))
      : inputSegments;
    const priorVia = (prepared.extra as { createdVia?: string } | null | undefined)?.createdVia;
    const extra: Record<string, unknown> = {
      ...(prepared.extra && typeof prepared.extra === 'object' ? prepared.extra : {}),
      composerSegments: preserved,
      composerAttachments: attachments,
      createdVia: priorVia === 'nl' ? 'nl' : 'ui',
    };
    // 手动创建：Modal gatewayText 常带 <!-- SClaw-Skill ... -->；任务以 segments 为 skill 真源，prompt 必须剥掉。
    return {
      ...input,
      prompt: stripSkillTranscriptMarkers(prepared.prompt).trim(),
      skillCode: null,
      workflowCode: null,
      dingtalkRecipients: null,
      extra,
      attachments: attachments.map((att) => ({
        id: att.id,
        fileName: att.fileName,
        mimeType: att.mimeType,
        sourcePath: att.sourcePath || att.persistentPath || '',
        provenance: att.provenance ?? { kind: 'local' },
      })),
    };
  }

  const mentions = collectMentions({
    recipients: input.recipients,
    dingtalkRecipients: input.dingtalkRecipients,
    extra: prepared.extra,
  });
  const skills = collectSkills({
    skillCode: input.skillCode,
    skills: input.skills,
    extra: prepared.extra,
    prompt: prepared.prompt,
  });
  const workflowCode = input.workflowCode?.trim() || null;
  const workflowName = input.workflowName?.trim() || null;

  // NL 入口：模型常把 JSON.stringify 的 `\n` 当字面字符塞进 prompt，导致执行气泡显示
  // 字面 `\n`、编辑回填不转 `<br>`。此处归一化（仅 NL 稀疏入口；UI 有 segments 已在上面返回）。
  // 同时剥 SClaw-Skill marker（可能从 chat 粘贴进来；skill 已收入 segments）。
  // sanitizeSkillPlaceholders 在 buildGatewayBody 内再跑：去掉误包的假 `[技能:]`。
  const normalizedPrompt = unescapeLiteralNewlines(
    stripSkillTranscriptMarkers(prepared.prompt),
  );

  const prompt = stripSkillTranscriptMarkers(buildGatewayBody({
    prompt: normalizedPrompt,
    attachments,
    skills,
    mentions,
    workflowCode,
    workflowName,
  }));

  // 按 prompt 行内占位顺序重建交错 segments（避免 files/skills 堆前、mention/workflow 堆后）
  const composerSegments = reconstructComposerSegmentsFromPrompt({
    prompt,
    attachments,
    skills,
    mentions,
    workflowCode,
    workflowName,
  });

  const extra: Record<string, unknown> = {
    ...(prepared.extra && typeof prepared.extra === 'object' ? prepared.extra : {}),
    composerSegments,
    composerAttachments: attachments,
    createdVia: 'nl',
  };

  return {
    ...input,
    prompt,
    // extra 真源：单值列停写（技能/工作流只在 composerSegments）
    skillCode: null,
    workflowCode: null,
    dingtalkRecipients: null,
    extra,
    // 顶层 attachments 已并入 extra；避免 create 再重复解析时丢 provenance
    attachments: attachments.map((att) => ({
      id: att.id,
      fileName: att.fileName,
      mimeType: att.mimeType,
      sourcePath: att.sourcePath || att.persistentPath || '',
      provenance: att.provenance ?? { kind: 'local' },
    })),
  };
}
