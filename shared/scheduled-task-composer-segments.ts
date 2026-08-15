/**
 * 定时任务 composerSegments 与 gateway prompt 的互转（无渲染依赖）。
 *
 * NL 稀疏入库曾按 files+skills+text+mentions+workflows 分堆，导致编辑回填
 * chip 堆两端、正文留空洞。此处按 prompt 行内占位顺序重建交错 segments。
 *
 * 另：模型偶发把调度说明误包成 `[技能: 的定时任务，cron为…]`，需校验标签可信性，
 * 避免假 skill 前缀落库、编辑打开成橙色扳手 chip。
 */
import type { DingTalkMention } from './dingtalk-send/dingtalk-mention';

export type ScheduledTaskSkillRef = { slug: string; title?: string };

export type ScheduledTaskAttachmentRef = {
  fileName: string;
  mimeType: string;
  sourcePath?: string;
  persistentPath?: string;
  provenance?: { kind: string; [key: string]: unknown };
};

export type ScheduledTaskComposerSegment =
  | {
    type: 'file';
    fileName: string;
    mimeType: string;
    fileSize: number;
    preview: null;
    filePath: string;
    stagedPath: string;
    provenance?: ScheduledTaskAttachmentRef['provenance'];
  }
  | { type: 'skill'; slug: string; title: string }
  | { type: 'text'; text: string }
  | { type: 'mention'; mention: DingTalkMention }
  | { type: 'workflow'; id: string; name: string; source: 'mine' };

/** 技能展示名合理上限；超长多半是误包的叙述句 */
export const SKILL_LABEL_MAX_LEN = 64;

/** 调度说明误包进 `[技能:]` 的典型脏特征 */
const SKILL_LABEL_JUNK_RE =
  /定时任务|cron\s*[为:=]|每整点|\d+\s*\*\s*\*|整点执行|每天上午|每周/i;

/**
 * 工具 schema / 系统提示里的尖括号占位被模型原样抄进 prompt，
 * 如 `[技能: <技能slug/名称>]`、`[文件: 文件名]`。
 */
const SKILL_LABEL_TEMPLATE_RE =
  /[<>]|技能\s*slug|slug\s*\/\s*名称|^标题$|^名称$|^文件名$|^展示名$|^skill$|^slug$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionKey(m: DingTalkMention): string {
  return m.type === 'group'
    ? `g:${m.openConversationId ?? m.displayName}`
    : `u:${m.userId ?? m.displayName}`;
}

function fileLabelMatches(fileName: string, sourcePath: string, label: string): boolean {
  const normalizedLabel = label.replace(/］/g, ']').trim();
  if (!normalizedLabel) return false;
  const name = (fileName || '').replace(/］/g, ']').trim();
  if (name === normalizedLabel) return true;
  const base = name.split(/[/\\]/).pop() ?? name;
  if (base === normalizedLabel) return true;
  const pathBase = (sourcePath || '').split(/[/\\]/).pop() ?? '';
  return Boolean(pathBase) && pathBase === normalizedLabel;
}

/**
 * 占位标签是否像真技能名（而非误包的 cron/叙述句 / schema 尖括号模板）。
 * `knownSkills` 有值时：还必须能对上已知 skill（含 `标题（slug）`）。
 */
export function isPlausibleSkillLabel(
  label: string,
  knownSkills?: ScheduledTaskSkillRef[] | null,
): boolean {
  const t = label.replace(/］/g, ']').trim();
  if (!t) return false;
  if (t.length > SKILL_LABEL_MAX_LEN) return false;
  if (SKILL_LABEL_JUNK_RE.test(t)) return false;
  if (SKILL_LABEL_TEMPLATE_RE.test(t)) return false;
  if (knownSkills && knownSkills.length > 0) {
    return Boolean(matchSkillByLabel(t, knownSkills));
  }
  return true;
}

/** `[技能: 标题]` / `[技能: 标题（slug）]` / slug 与已知列表对齐 */
export function matchSkillByLabel(
  label: string,
  skills: ScheduledTaskSkillRef[],
): ScheduledTaskSkillRef | null {
  const t = label.replace(/］/g, ']').trim();
  if (!t) return null;
  for (const sk of skills) {
    const title = (sk.title || sk.slug || '').trim();
    const slug = (sk.slug || '').trim();
    if (!title && !slug) continue;
    if (t === title || (slug && t === slug)) return sk;
    if (title && slug) {
      if (t === `${title}（${slug}）` || t === `${title}(${slug})`) return sk;
      if (t === `${slug}（${title}）` || t === `${slug}(${title})`) return sk;
    }
    // 模型偶写「标题（html）」而 slug 实为 html
    if (title && t.startsWith(`${title}（`) && t.endsWith('）')) return sk;
    if (title && t.startsWith(`${title}(`) && t.endsWith(')')) return sk;
  }
  return null;
}

/**
 * 清洗 prompt 里不可信的 `[技能: …]`：
 * - 调度说明等脏包 → 整段删除
 * - 其它未知标签 → 降级为纯文本（去掉方括号）
 * - 已知技能 → 保留为 `[技能: title]`；同一 skill 只留**最后一次**出现（避免错误前置抢走行内位置）
 */
export function sanitizeSkillPlaceholdersInPrompt(
  prompt: string,
  knownSkills: ScheduledTaskSkillRef[] = [],
): string {
  if (!prompt) return prompt;

  type Hit = {
    start: number;
    end: number;
    label: string;
    known: ScheduledTaskSkillRef | null;
  };
  const hits: Hit[] = [];
  const re = /\[技能:\s*([^\]]*)\]/g;
  let m: RegExpExecArray | null = re.exec(prompt);
  while (m) {
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      label: String(m[1] ?? '').trim(),
      known: matchSkillByLabel(String(m[1] ?? '').trim(), knownSkills),
    });
    m = re.exec(prompt);
  }

  const lastIndexByKey = new Map<string, number>();
  hits.forEach((hit, index) => {
    if (!hit.known) return;
    const key = hit.known.slug.trim() || (hit.known.title || '').trim();
    if (key) lastIndexByKey.set(key, index);
  });

  let out = '';
  let cursor = 0;
  hits.forEach((hit, index) => {
    out += prompt.slice(cursor, hit.start);
    cursor = hit.end;
    if (!hit.label) return;
    if (hit.known) {
      // 即便进了 known 列表，schema 尖括号模板仍丢弃
      const rawTitle = (hit.known.title || hit.known.slug).trim();
      if (!isPlausibleSkillLabel(rawTitle) && !isPlausibleSkillLabel(hit.known.slug)) {
        return;
      }
      const key = hit.known.slug.trim() || (hit.known.title || '').trim();
      if (key && lastIndexByKey.get(key) !== index) return; // 更早的重复占位丢掉
      const title = rawTitle.replace(/]/g, '］');
      out += `[技能: ${title}]`;
      return;
    }
    if (SKILL_LABEL_JUNK_RE.test(hit.label)
      || SKILL_LABEL_TEMPLATE_RE.test(hit.label)
      || hit.label.length > SKILL_LABEL_MAX_LEN) {
      return;
    }
    if (knownSkills.length === 0 && isPlausibleSkillLabel(hit.label)) {
      out += prompt.slice(hit.start, hit.end);
      return;
    }
    out += hit.label;
  });
  out += prompt.slice(cursor);

  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 正文是否已引用该技能（`[技能:]` 或「标题」/技能叙述），避免再前置一份 */
export function promptAlreadyReferencesSkill(
  body: string,
  skill: ScheduledTaskSkillRef,
): boolean {
  const title = (skill.title || skill.slug || '').trim();
  const slug = (skill.slug || '').trim();
  if (!title && !slug) return false;
  for (const match of body.matchAll(/\[技能:\s*([^\]]*)\]/g)) {
    const label = (match[1] ?? '').trim();
    if (!label) continue;
    if (matchSkillByLabel(label, [skill])) return true;
    if (title && label.includes(title)) return true;
    if (slug && label.includes(slug) && label.length <= slug.length + title.length + 8) return true;
  }
  // NL：使用「标题」技能 / 「标题」技能（slug）
  if (title) {
    const quoted = new RegExp(`[「"']${escapeRegExp(title)}[」"']`);
    if (quoted.test(body)) return true;
  }
  return false;
}

/** 正文是否已有对应 `[文件:]` 或原样文件名 */
export function promptAlreadyReferencesFile(
  body: string,
  fileName: string,
): boolean {
  const name = fileName.replace(/］/g, ']').trim();
  if (!name) return false;
  if (body.includes(`[文件: ${name}]`)) return true;
  if (body.includes(name)) return true;
  return false;
}

/**
 * 把附件/技能织进 NL 正文对应位置（替换「标题」技能、根据…和… 等），
 * 而不是一律 `[文件:][技能:]\n\n正文` 前置——否则编辑 chip 全堆最上。
 * 无法定位的剩余项返回给调用方决定是否再前置。
 */
export function weaveStructuredRefsIntoPrompt(input: {
  prompt: string;
  attachments: ScheduledTaskAttachmentRef[];
  skills: ScheduledTaskSkillRef[];
}): {
  prompt: string;
  remainingAttachments: ScheduledTaskAttachmentRef[];
  remainingSkills: ScheduledTaskSkillRef[];
} {
  let body = String(input.prompt || '').trim();
  const skills = input.skills.filter((sk) => isPlausibleSkillLabel(sk.title || sk.slug));
  const attachments = [...input.attachments];

  // 剥掉历史错误前置的 `[文件:]…[技能:]\n\n`，再织回正文（幂等）
  const stackedPrefix = body.match(
    /^((?:\[文件:\s*[^\]]*\]\s*|\[技能:\s*[^\]]*\]\s*)+)(?:\n{2,}|\n)([\s\S]+)$/,
  );
  if (stackedPrefix?.[2]?.trim()) {
    const head = stackedPrefix[1];
    const rest = stackedPrefix[2].trim();
    // 仅当正文侧已是叙述（无同构占位，或仅有部分）时剥头，避免误伤本就交错的 gateway 文
    const headHasFile = /\[文件:/.test(head);
    const headHasSkill = /\[技能:/.test(head);
    const restHasFile = /\[文件:/.test(rest);
    const restHasSkill = /\[技能:/.test(rest);
    if ((headHasFile && !restHasFile) || (headHasSkill && !restHasSkill)) {
      body = rest;
    }
  }

  body = sanitizeSkillPlaceholdersInPrompt(body, skills);

  const remainingSkills: ScheduledTaskSkillRef[] = [];
  for (const sk of skills) {
    if (promptAlreadyReferencesSkill(body, sk) && /\[技能:/.test(body)) {
      // 已有方括号占位
      continue;
    }
    const title = (sk.title || sk.slug).trim();
    const slug = sk.slug.trim();
    const placeholder = `[技能: ${title.replace(/]/g, '］')}]`;
    const patterns: RegExp[] = [];
    if (title && slug) {
      patterns.push(new RegExp(
        `[「"']${escapeRegExp(title)}[」"']\\s*技能\\s*[（(]${escapeRegExp(slug)}[）)]`,
      ));
    }
    if (title) {
      patterns.push(new RegExp(`[「"']${escapeRegExp(title)}[」"']\\s*技能`));
      patterns.push(new RegExp(`使用\\s*[「"']${escapeRegExp(title)}[」"']`));
    }
    let woven = false;
    for (const re of patterns) {
      if (!re.test(body)) continue;
      body = body.replace(re, (matched) => (
        matched.startsWith('使用') ? `使用 ${placeholder}` : placeholder
      ));
      woven = true;
      break;
    }
    if (!woven) {
      if (promptAlreadyReferencesSkill(body, sk)) {
        // 有「标题」但上面没替换成功：仍视为已引用，不前置
        continue;
      }
      remainingSkills.push(sk);
    }
  }

  const remainingAttachments: ScheduledTaskAttachmentRef[] = [];
  const unusedForWeave = [...attachments];
  for (const att of attachments) {
    const name = (att.fileName || '').trim();
    if (!name) {
      remainingAttachments.push(att);
      continue;
    }
    if (body.includes(`[文件: ${name}]`) || body.includes(`[文件: ${name.replace(/]/g, '］')}]`)) {
      const idx = unusedForWeave.indexOf(att);
      if (idx >= 0) unusedForWeave.splice(idx, 1);
      continue;
    }
    if (body.includes(name)) {
      body = body.replace(name, `[文件: ${name.replace(/]/g, '］')}]`);
      const idx = unusedForWeave.indexOf(att);
      if (idx >= 0) unusedForWeave.splice(idx, 1);
      continue;
    }
  }

  // 常见 NL：「根据 A 和 B，使用…」——两附件时整体替换描述段
  if (unusedForWeave.length > 0) {
    const accordingTo = body.match(/根据([^，,\n]{2,80})([，,]\s*使用|[，,])/);
    if (accordingTo && !/\[文件:/.test(accordingTo[1] ?? '')) {
      const woven = unusedForWeave
        .map((att) => `[文件: ${(att.fileName || '未知文件').replace(/]/g, '］')}]`)
        .join(' 和 ');
      body = `${body.slice(0, accordingTo.index)}根据 ${woven}${accordingTo[2]}${body.slice(
        (accordingTo.index ?? 0) + accordingTo[0].length,
      )}`;
      unusedForWeave.length = 0;
    }
  }
  remainingAttachments.push(...unusedForWeave);

  return {
    prompt: body
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    remainingAttachments,
    remainingSkills,
  };
}

/** segments 是否含明显假 skill chip（存量编辑回填用） */
export function composerSegmentsHaveBogusSkills(
  segments: Array<{ type?: string; slug?: string; title?: string }> | null | undefined,
): boolean {
  if (!segments?.length) return false;
  return segments.some((s) => {
    if (s?.type !== 'skill') return false;
    const label = (s.title || s.slug || '').trim();
    return !isPlausibleSkillLabel(label);
  });
}

/**
 * 旧 NL 分堆 / 前缀堆砌：chip 全在正文前（file/skill 开头且首个大段 text 前无 chip）。
 * 含 `file file skill text…` 这种前置形态。
 */
export function composerSegmentsLookNlStacked(
  segments: Array<{ type?: string }> | null | undefined,
): boolean {
  if (!segments?.length) return false;
  const types = segments.map((s) => s?.type ?? '');
  const firstText = types.indexOf('text');
  const lastText = types.lastIndexOf('text');
  if (firstText < 0) return false;
  if (types.slice(firstText, lastText + 1).some((t) => t !== 'text')) {
    // text 之间已有 chip → 可能仍是「file skill \n\n text mention」前置：
    // 若开头连续 file/skill，且其后才出现较长 text，仍视为需重织
    const head = types.slice(0, firstText);
    if (head.length >= 1 && head.every((t) => t === 'file' || t === 'skill')) {
      const firstLongText = segments.findIndex((s, i) => (
        s?.type === 'text'
        && typeof (s as { text?: string }).text === 'string'
        && ((s as { text?: string }).text?.length ?? 0) > 20
        && i >= firstText
      ));
      if (firstLongText > 0 && types.slice(0, firstLongText).every(
        (t) => t === 'file' || t === 'skill' || t === 'text',
      )) {
        const onlyShortGaps = types.slice(0, firstLongText).every((t, i) => {
          if (t !== 'text') return true;
          const text = (segments[i] as { text?: string })?.text ?? '';
          return text.trim().length <= 2;
        });
        if (onlyShortGaps) return true;
      }
    }
    return false;
  }
  const head = types.slice(0, firstText);
  const tail = types.slice(lastText + 1);
  if (head.length === 0 && tail.length === 0) return false;
  const headOk = head.every((t) => t === 'file' || t === 'skill');
  const tailOk = tail.every((t) => t === 'mention' || t === 'workflow');
  return headOk && tailOk;
}

/**
 * 按 gateway prompt 里 `[文件:]` / `[技能:]` / `@名` / 工作流执行句的出现顺序
 * 重建交错 composerSegments。
 *
 * 先 weave：把前置堆砌 / NL「标题」技能 织成行内占位，再 tokenize。
 */
export function reconstructComposerSegmentsFromPrompt(input: {
  prompt: string;
  attachments: ScheduledTaskAttachmentRef[];
  skills: ScheduledTaskSkillRef[];
  mentions: DingTalkMention[];
  workflowCode?: string | null;
  workflowName?: string | null;
}): ScheduledTaskComposerSegment[] {
  const knownSkills = input.skills.filter((sk) => (
    isPlausibleSkillLabel(sk.title || sk.slug)
  ));
  const woven = weaveStructuredRefsIntoPrompt({
    prompt: input.prompt,
    attachments: input.attachments,
    skills: knownSkills,
  });
  let prompt = woven.prompt;
  const tailParts: string[] = [];
  for (const att of woven.remainingAttachments) {
    if (!promptAlreadyReferencesFile(prompt, att.fileName || '')) {
      tailParts.push(`[文件: ${(att.fileName || '未知文件').replace(/]/g, '］')}]`);
    }
  }
  for (const sk of woven.remainingSkills) {
    if (!promptAlreadyReferencesSkill(prompt, sk)) {
      tailParts.push(`[技能: ${(sk.title || sk.slug).replace(/]/g, '］')}]`);
    }
  }
  if (tailParts.length > 0) {
    prompt = `${tailParts.join(' ')}\n\n${prompt}`.trim();
  }
  prompt = sanitizeSkillPlaceholdersInPrompt(prompt, knownSkills);

  const unusedFiles = [...input.attachments];
  const unusedSkills = [...knownSkills];
  const usedMentionKeys = new Set<string>();
  const usedWorkflowIds = new Set<string>();
  const segments: ScheduledTaskComposerSegment[] = [];

  const mentionNames = [...input.mentions]
    .map((m) => m.displayName?.trim())
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => b.length - a.length);

  const parts = [
    String.raw`\[文件:\s*([^\]]*)\]`,
    String.raw`\[技能:\s*([^\]]*)\]`,
    String.raw`(?:帮我)?执行\s*id\s*为\s*[:：]?\s*([A-Za-z0-9_-]+)\s*的工作流\s*(?:【([^】]*)】)?`,
    // NL「执行工作流wf_xxx（名称）」——空格可有可无
    String.raw`执行工作流\s*(wf_[A-Za-z0-9_-]+)\s*[（(]([^）)]*)[）)]`,
  ];
  if (mentionNames.length > 0) {
    parts.push(`@(?:${mentionNames.map(escapeRegExp).join('|')})`);
  }
  const tokenRe = new RegExp(parts.join('|'), 'g');

  let lastIndex = 0;
  let match: RegExpExecArray | null = tokenRe.exec(prompt);
  while (match) {
    const before = prompt.slice(lastIndex, match.index);
    if (before) segments.push({ type: 'text', text: before });

    if (match[1] !== undefined) {
      const label = match[1].trim();
      const fileIndex = unusedFiles.findIndex((att) => (
        fileLabelMatches(att.fileName, att.sourcePath || att.persistentPath || '', label)
      ));
      const att = fileIndex >= 0
        ? unusedFiles.splice(fileIndex, 1)[0]
        : unusedFiles.shift();
      const path = att?.sourcePath || att?.persistentPath || '';
      segments.push({
        type: 'file',
        fileName: label || att?.fileName || '未知文件',
        mimeType: att?.mimeType || 'application/octet-stream',
        fileSize: 0,
        preview: null,
        filePath: path,
        stagedPath: path,
        provenance: att?.provenance,
      });
    } else if (match[2] !== undefined) {
      const label = match[2].trim();
      const matched = matchSkillByLabel(label, unusedSkills);
      if (matched) {
        const skillIndex = unusedSkills.indexOf(matched);
        if (skillIndex >= 0) unusedSkills.splice(skillIndex, 1);
        segments.push({
          type: 'skill',
          slug: matched.slug,
          title: matched.title || matched.slug,
        });
      } else if (matchSkillByLabel(label, knownSkills)) {
        // duplicate known skill placeholder
      } else if (isPlausibleSkillLabel(label)) {
        segments.push({ type: 'skill', slug: label, title: label });
      } else {
        segments.push({ type: 'text', text: label });
      }
    } else if (match[3] !== undefined || match[5] !== undefined) {
      const workflowId = (match[3] ?? match[5] ?? '').trim();
      const workflowName = (match[4] ?? match[6] ?? '').trim()
        || (input.workflowCode === workflowId ? (input.workflowName || workflowId) : workflowId);
      usedWorkflowIds.add(workflowId);
      segments.push({
        type: 'workflow',
        id: workflowId,
        name: workflowName,
        source: 'mine',
      });
    } else {
      const raw = match[0];
      const displayName = raw.startsWith('@') ? raw.slice(1) : raw;
      const mention = input.mentions.find((m) => m.displayName === displayName);
      if (mention) {
        usedMentionKeys.add(mentionKey(mention));
        segments.push({ type: 'mention', mention });
      } else {
        segments.push({ type: 'text', text: raw });
      }
    }

    lastIndex = match.index + match[0].length;
    match = tokenRe.exec(prompt);
  }

  const tail = prompt.slice(lastIndex);
  if (tail) segments.push({ type: 'text', text: tail });

  for (const att of unusedFiles) {
    const path = att.sourcePath || att.persistentPath || '';
    segments.push({
      type: 'file',
      fileName: att.fileName,
      mimeType: att.mimeType,
      fileSize: 0,
      preview: null,
      filePath: path,
      stagedPath: path,
      provenance: att.provenance,
    });
  }
  for (const sk of unusedSkills) {
    segments.push({ type: 'skill', slug: sk.slug, title: sk.title || sk.slug });
  }
  for (const m of input.mentions) {
    if (!usedMentionKeys.has(mentionKey(m))) {
      segments.push({ type: 'mention', mention: m });
    }
  }
  const wf = input.workflowCode?.trim();
  if (wf && !usedWorkflowIds.has(wf)) {
    segments.push({
      type: 'workflow',
      id: wf,
      name: input.workflowName?.trim() || wf,
      source: 'mine',
    });
  }

  const merged: ScheduledTaskComposerSegment[] = [];
  for (const seg of segments) {
    if (seg.type === 'text') {
      const text = seg.text.replace(/\n{3,}/g, '\n\n');
      if (!text) continue;
      const prev = merged[merged.length - 1];
      if (prev?.type === 'text') {
        prev.text = `${prev.text}${text}`.replace(/\n{3,}/g, '\n\n');
        continue;
      }
      merged.push({ type: 'text', text });
      continue;
    }
    merged.push(seg);
  }
  return merged;
}
