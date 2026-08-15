/**
 * NL 建任务：从 prompt / 会话用户消息回填结构化字段。
 * 模型常把技能/工作流/附件只写进正文；此处兜底解析，与 Modal bake 对齐。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPlausibleSkillLabel } from '../../shared/scheduled-task-composer-segments';
import { getOpenClawConfigDir, getSkillsStoreGlobalDir } from '../utils/paths';
import { logger } from '../utils/logger';
import {
  parseMediaAttachedAttachments,
  parseStoClawOutboundPathsFromText,
} from './scheduled-task-attachments';
import type { NlSkillInput } from './scheduled-task-nl-create';

export {
  parseStoClawOutboundPathsFromText,
  stripStoClawOutboundPathsFromText,
} from './scheduled-task-attachments';

const SKILL_MARKER_RE = /<!--\s*SClaw-Skill\s+(\{[\s\S]*?\})\s*-->/g;
const FILE_PLACEHOLDER_RE = /\[文件:\s*([^\]]+)\]/g;
const SKILL_PLACEHOLDER_RE = /\[技能:\s*([^\]]+)\]/g;
const SKILL_QUOTED_RE = /(?:使用)?[「"']([^」"']+)[」"']\s*技能/g;
/** 使用技能"html"（标题） / 使用技能「xxx」 */
const SKILL_USE_QUOTED_RE = /使用技能\s*[「"']([^」"']+)[」"']/g;
const WORKFLOW_EXEC_RE =
  /(?:帮我)?执行\s*id\s*为[：:]\s*(wf_[a-zA-Z0-9]+)(?:\s*的工作流\s*【([^】]*)】)?/gi;
const WORKFLOW_INLINE_RE = /工作流\s+(wf_[a-zA-Z0-9]+)(?:\s*[（(]([^）)]*)[）)])?/gi;
const WORKFLOW_BARE_RE = /\b(wf_[a-zA-Z0-9]+)\b/g;

type HintAttachment = {
  fileName?: string;
  mimeType?: string;
  sourcePath: string;
  provenance?: { kind: string; [key: string]: unknown };
};

export type ComposerCreateHints = {
  attachments: HintAttachment[];
  skills: NlSkillInput[];
  workflowCode: string | null;
  workflowName: string | null;
  fileLabels: string[];
};

function pushSkill(out: NlSkillInput[], seen: Set<string>, slug: string, title?: string): void {
  const s = slug.trim();
  if (!s || seen.has(s)) return;
  seen.add(s);
  out.push({ slug: s, title: title?.trim() || undefined });
}

/** 从本地 skills-store 建 title/slug 索引（同步，供 NL 回填）。 */
export function buildLocalSkillLabelIndex(): Map<string, NlSkillInput> {
  const index = new Map<string, NlSkillInput>();
  const visit = (dir: string) => {
    if (!existsSync(dir)) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const slug of entries) {
      const skillMd = join(dir, slug, 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      let title = slug;
      try {
        const raw = readFileSync(skillMd, 'utf8');
        const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const titleMatch = fm?.[1]?.match(/^\s*title:\s*(.+)\s*$/m);
        if (titleMatch?.[1]) title = titleMatch[1].trim().replace(/^["']|["']$/g, '');
      } catch {
        // keep slug
      }
      const skill = { slug, title };
      index.set(slug.toLowerCase(), skill);
      index.set(title.toLowerCase(), skill);
    }
  };
  visit(getSkillsStoreGlobalDir());
  const storeRoot = join(getSkillsStoreGlobalDir(), '..');
  const usersRoot = join(storeRoot, 'users');
  if (existsSync(usersRoot)) {
    try {
      for (const user of readdirSync(usersRoot)) {
        visit(join(usersRoot, user, 'skills'));
      }
    } catch {
      // ignore
    }
  }
  return index;
}

export function resolveSkillLabel(
  label: string,
  index: Map<string, NlSkillInput> = buildLocalSkillLabelIndex(),
): NlSkillInput | null {
  const key = label.trim().toLowerCase();
  if (!key) return null;
  return index.get(key) ?? null;
}

/**
 * 从一段用户/工具文案提取 composer 结构化线索。
 */
export function extractComposerHintsFromText(text: string | null | undefined): ComposerCreateHints {
  const empty: ComposerCreateHints = {
    attachments: [],
    skills: [],
    workflowCode: null,
    workflowName: null,
    fileLabels: [],
  };
  if (!text?.trim()) return empty;

  const byPath = new Map<string, HintAttachment>();
  for (const att of parseMediaAttachedAttachments(text)) {
    const sourcePath = (att.sourcePath || '').trim();
    if (!sourcePath) continue;
    byPath.set(sourcePath, {
      fileName: att.fileName,
      mimeType: att.mimeType,
      sourcePath,
      provenance: att.provenance ?? { kind: 'local' },
    });
  }
  for (const att of parseStoClawOutboundPathsFromText(text)) {
    const sourcePath = (att.sourcePath || '').trim();
    if (!sourcePath || byPath.has(sourcePath)) continue;
    byPath.set(sourcePath, {
      fileName: att.fileName,
      mimeType: att.mimeType,
      sourcePath,
      provenance: att.provenance ?? { kind: 'local' },
    });
  }
  const attachments = [...byPath.values()];

  const fileLabels: string[] = [];
  for (const match of text.matchAll(FILE_PLACEHOLDER_RE)) {
    const name = (match[1] ?? '').trim();
    if (name) fileLabels.push(name);
  }
  for (let i = 0; i < attachments.length && i < fileLabels.length; i += 1) {
    // [文件: 名] 是展示名真源，勿用路径后缀改写（无扩展名的数据中心条目很常见）
    attachments[i] = {
      ...attachments[i],
      fileName: fileLabels[i],
    };
  }

  const skills: NlSkillInput[] = [];
  const seenSkills = new Set<string>();
  const skillIndex = buildLocalSkillLabelIndex();

  for (const match of text.matchAll(SKILL_MARKER_RE)) {
    try {
      const parsed = JSON.parse(match[1] ?? '') as { slug?: string; title?: string };
      if (parsed.slug?.trim()) {
        pushSkill(skills, seenSkills, parsed.slug, parsed.title);
      }
    } catch {
      // ignore
    }
  }
  for (const match of text.matchAll(SKILL_PLACEHOLDER_RE)) {
    const label = (match[1] ?? '').trim();
    if (!label) continue;
    // 模型偶发把「的定时任务，cron为…」误包成 [技能:…]——未解析到本地技能且标签不可信则丢弃
    const resolved = resolveSkillLabel(label, skillIndex);
    if (resolved) {
      pushSkill(skills, seenSkills, resolved.slug, resolved.title || label);
      continue;
    }
    // 兼容 `标题（slug）`：只取括号前标题再解析
    const bare = label.replace(/[（(][^）)]*[）)]\s*$/, '').trim();
    const resolvedBare = bare && bare !== label ? resolveSkillLabel(bare, skillIndex) : null;
    if (resolvedBare) {
      pushSkill(skills, seenSkills, resolvedBare.slug, resolvedBare.title || bare);
      continue;
    }
    if (!isPlausibleSkillLabel(label)) continue;
    pushSkill(skills, seenSkills, label, label);
  }
  for (const match of text.matchAll(SKILL_QUOTED_RE)) {
    const label = (match[1] ?? '').trim();
    if (!label || !isPlausibleSkillLabel(label)) continue;
    const resolved = resolveSkillLabel(label, skillIndex);
    if (resolved) pushSkill(skills, seenSkills, resolved.slug, resolved.title || label);
    else pushSkill(skills, seenSkills, label, label);
  }
  for (const match of text.matchAll(SKILL_USE_QUOTED_RE)) {
    const label = (match[1] ?? '').trim();
    if (!label || !isPlausibleSkillLabel(label)) continue;
    const resolved = resolveSkillLabel(label, skillIndex);
    if (resolved) pushSkill(skills, seenSkills, resolved.slug, resolved.title || label);
    else pushSkill(skills, seenSkills, label, label);
  }

  let workflowCode: string | null = null;
  let workflowName: string | null = null;
  for (const match of text.matchAll(WORKFLOW_EXEC_RE)) {
    workflowCode = (match[1] ?? '').trim() || workflowCode;
    workflowName = (match[2] ?? '').trim() || workflowName;
  }
  if (!workflowCode) {
    for (const match of text.matchAll(WORKFLOW_INLINE_RE)) {
      workflowCode = (match[1] ?? '').trim() || workflowCode;
      workflowName = (match[2] ?? '').trim() || workflowName;
    }
  }
  if (!workflowCode) {
    const bare = [...text.matchAll(WORKFLOW_BARE_RE)][0];
    if (bare?.[1]) workflowCode = bare[1];
  }

  return { attachments, skills, workflowCode, workflowName, fileLabels };
}

function mergeAttachments(
  primary: HintAttachment[] | null | undefined,
  fallback: HintAttachment[],
): HintAttachment[] | null {
  const map = new Map<string, HintAttachment>();
  for (const att of [...(primary ?? []), ...fallback]) {
    const key = att.sourcePath.trim();
    if (!key || map.has(key)) continue;
    map.set(key, {
      ...att,
      provenance: att.provenance ?? { kind: 'local' },
    });
  }
  const list = [...map.values()];
  return list.length ? list : null;
}

function mergeSkills(
  primary: NlSkillInput[] | null | undefined,
  skillCode: string | null | undefined,
  fallback: NlSkillInput[],
): NlSkillInput[] | null {
  const out: NlSkillInput[] = [];
  const seen = new Set<string>();
  for (const sk of [...(primary ?? []), ...(skillCode?.trim() ? [{ slug: skillCode.trim() }] : []), ...fallback]) {
    pushSkill(out, seen, sk.slug, sk.title);
  }
  return out.length ? out : null;
}

/**
 * 把 hints 合并进 create 入参：仅补空，不覆盖模型已显式传入的值。
 */
export function mergeComposerHintsIntoCreateInput<T extends {
  attachments?: HintAttachment[] | null;
  skills?: NlSkillInput[] | null;
  skillCode?: string | null;
  workflowCode?: string | null;
  workflowName?: string | null;
  prompt?: string;
}>(input: T, hintTexts: Array<string | null | undefined>): T {
  const combined = hintTexts.filter((t): t is string => Boolean(t?.trim())).join('\n\n');
  if (!combined && !input.prompt?.trim()) return input;
  const fromPrompt = extractComposerHintsFromText(input.prompt);
  const fromHints = extractComposerHintsFromText(combined);
  const attachments = mergeAttachments(
    input.attachments,
    [...fromHints.attachments, ...fromPrompt.attachments],
  );
  const skills = mergeSkills(
    input.skills,
    input.skillCode,
    [...fromHints.skills, ...fromPrompt.skills],
  );
  const workflowCode = input.workflowCode?.trim()
    || fromHints.workflowCode
    || fromPrompt.workflowCode
    || null;
  const workflowName = input.workflowName?.trim()
    || fromHints.workflowName
    || fromPrompt.workflowName
    || null;

  return {
    ...input,
    attachments,
    skills,
    skillCode: skills?.[0]?.slug ?? input.skillCode ?? null,
    workflowCode,
    workflowName,
  };
}

/**
 * 读取 OpenClaw 会话最近若干条用户消息正文（含 media attached / skill marker）。
 * 合并返回，避免「确认一下」之类短回复冲掉带附件的建任务原文。
 */
export async function readLatestOpenClawUserMessageText(
  sessionKey: string | null | undefined,
): Promise<string | null> {
  const key = sessionKey?.trim();
  if (!key || !key.startsWith('agent:')) return null;
  const parts = key.split(':');
  if (parts.length < 3) return null;
  const agentId = parts[1];
  const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
  const sessionsJsonPath = join(sessionsDir, 'sessions.json');
  if (!existsSync(sessionsJsonPath)) return null;

  let transcriptPath: string | null = null;
  try {
    const sessionsJson = JSON.parse(readFileSync(sessionsJsonPath, 'utf8')) as Record<string, unknown>;
    const entry = sessionsJson[key];
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const abs = (record.sessionFile ?? record.file ?? record.fileName ?? record.path) as string | undefined;
      if (typeof abs === 'string' && (abs.startsWith('/') || /^[A-Za-z]:[\\/]/.test(abs))) {
        transcriptPath = abs;
      } else if (abs) {
        transcriptPath = join(sessionsDir, abs.endsWith('.jsonl') ? abs : `${abs}.jsonl`);
      } else if (typeof record.sessionId === 'string') {
        transcriptPath = join(sessionsDir, `${record.sessionId}.jsonl`);
      }
    }
  } catch (err) {
    logger.warn('[scheduled-task-nl-hints] read sessions.json failed', err);
    return null;
  }
  if (!transcriptPath || !existsSync(transcriptPath)) return null;

  try {
    const raw = readFileSync(transcriptPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const userTexts: string[] = [];
    for (let i = lines.length - 1; i >= 0 && userTexts.length < 6; i -= 1) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(lines[i]!) as Record<string, unknown>;
      } catch {
        continue;
      }
      const message = (obj.message && typeof obj.message === 'object'
        ? obj.message
        : obj) as Record<string, unknown>;
      if (message.role !== 'user') continue;
      const content = message.content;
      const chunks: string[] = [];
      if (typeof content === 'string') chunks.push(content);
      else if (Array.isArray(content)) {
        for (const part of content) {
          if (part && typeof part === 'object' && (part as { type?: string }).type === 'text') {
            const text = (part as { text?: string }).text;
            if (typeof text === 'string') chunks.push(text);
          }
        }
      }
      const text = chunks.join('\n').trim();
      if (text) userTexts.push(text);
    }
    if (!userTexts.length) return null;
    // 优先带 media / skill marker / 工作流 id 的原文；否则拼最近几条
    const rich = userTexts.find((t) =>
      /\[media attached:/i.test(t)
      || /<!--\s*SClaw-Skill/i.test(t)
      || /\[技能:/i.test(t)
      || /\[文件:/i.test(t)
      || /\.stoclaw\/(?:openclaw\/media\/outbound|scheduled-tasks\/)/i.test(t)
      || /\bwf_[a-zA-Z0-9]+\b/.test(t)
    );
    return rich ?? userTexts.join('\n\n');
  } catch (err) {
    logger.warn('[scheduled-task-nl-hints] read transcript failed', err);
  }
  return null;
}
