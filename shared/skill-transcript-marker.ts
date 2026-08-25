/**
 * SClaw-Skill transcript marker — 纯文本工具（无渲染依赖）。
 *
 * Chat 冷启动靠 marker 写进 OpenClaw `.jsonl` 恢复 `_skillMeta`。
 * 定时任务以 `extra.composerSegments` 为 skill 真源，**入库 prompt 必须剥掉 marker**，
 * 避免 `userText` 的 JSON 字面 `\n` 污染编辑/诊断。
 *
 * 格式：
 * - v1：`<!-- SClaw-Skill {"slug":"...","title":"...","userText":"..."} -->`
 * - v2：`<!-- SClaw-Skill:v2 [{"slug":"...","title":"..."}] -->`（前瞻兼容）
 */

/** 全局匹配 v1 对象 / v2 数组 payload。 */
export const SKILL_TRANSCRIPT_MARKER_RE =
  /<!--\s*SClaw-Skill(?::v2)?\s+(\[[\s\S]*?\]|\{[\s\S]*?\})\s*-->/g;

export type SkillTranscriptMarkerMeta = {
  slug: string;
  title: string;
};

function pushMeta(
  out: SkillTranscriptMarkerMeta[],
  seen: Set<string>,
  slug: unknown,
  title?: unknown,
): void {
  if (typeof slug !== 'string' || !slug.trim()) return;
  const s = slug.trim();
  if (seen.has(s)) return;
  seen.add(s);
  const t = typeof title === 'string' && title.trim() ? title.trim() : s;
  out.push({ slug: s, title: t });
}

/** 从正文解析全部 skill marker（v1/v2）；忽略 userText。 */
export function parseSkillTranscriptMarkers(text: string): SkillTranscriptMarkerMeta[] {
  if (!text) return [];
  const out: SkillTranscriptMarkerMeta[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(SKILL_TRANSCRIPT_MARKER_RE)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== 'object') continue;
          const rec = item as { slug?: unknown; title?: unknown };
          pushMeta(out, seen, rec.slug, rec.title);
        }
        continue;
      }
      if (parsed && typeof parsed === 'object') {
        const rec = parsed as { slug?: unknown; title?: unknown };
        pushMeta(out, seen, rec.slug, rec.title);
      }
    } catch {
      // 畸形 marker 忽略
    }
  }
  return out;
}

/**
 * 剥掉全部 SClaw-Skill HTML 注释；压缩剥后多余空行。
 * 幂等：无 marker 时仅 trimEnd 级空白整理不改变业务正文。
 */
export function stripSkillTranscriptMarkers(text: string): string {
  if (!text) return text;
  const stripped = text.replace(SKILL_TRANSCRIPT_MARKER_RE, '');
  return stripped
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

/**
 * 去掉 gateway 前缀的技能 defaultPrompt / 标题 / slug；保留后续 `[文件:]` 等 bake。
 * 纯文本、无渲染依赖——定时任务入库与 chat 展示共用。
 */
export function stripSkillGatewayPrefix(
  body: string,
  prompt: string,
  title: string,
  slug?: string,
): string {
  let text = body.trim();
  if (!text) return '';

  const prefixes = [...new Set(
    [prompt, title, slug]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  )];
  if (!prefixes.length) return text;

  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (text === prefix) return '';
      for (const separator of ['\n\n', '\n', ' ']) {
        const lead = `${prefix}${separator}`;
        if (text.startsWith(lead)) {
          text = text.slice(lead.length).trim();
          changed = true;
          break;
        }
      }
      if (changed) break;
      const lines = text.split('\n');
      if (lines.length > 1 && lines[0]?.trim() === prefix) {
        text = lines.slice(1).join('\n').trim();
        changed = true;
        break;
      }
    }
  }

  return text;
}
