import type {
  ComposerSegment,
  PersistedComposerSegment,
} from '@/lib/dingtalk-mention-composer';
import { unescapeLiteralNewlines } from '../../../../shared/text-escape';
import { reconstructComposerSegmentsFromPrompt } from '../../../../shared/scheduled-task-composer-segments';

/**
 * NL 落库常把正文只放在 prompt、segments 里只有 chip。
 * 编辑回填时把干净正文织进 segments，避免只剩 @/文件 chip。
 */
export function mergeInstructionTextIntoSegments(
  segments: PersistedComposerSegment[],
  instructions: string,
  options?: { unescapeLiteralNewlines?: boolean },
): PersistedComposerSegment[] {
  const hasText = segments.some((seg) => seg.type === 'text' && seg.text.trim());
  if (hasText) return segments;

  const prompt = options?.unescapeLiteralNewlines
    ? unescapeLiteralNewlines(instructions)
    : instructions;

  const attachments = segments
    .filter((s): s is Extract<PersistedComposerSegment, { type: 'file' }> => s.type === 'file')
    .map((s) => ({
      fileName: s.fileName,
      mimeType: s.mimeType || 'application/octet-stream',
      sourcePath: s.filePath || s.stagedPath || '',
      persistentPath: s.filePath || s.stagedPath || '',
      provenance: s.provenance as { kind: string; [key: string]: unknown } | undefined,
    }));
  const skills = segments
    .filter((s): s is Extract<PersistedComposerSegment, { type: 'skill' }> => s.type === 'skill')
    .map((s) => ({ slug: s.slug, title: s.title }));
  const mentions = segments
    .filter((s): s is Extract<PersistedComposerSegment, { type: 'mention' }> => s.type === 'mention')
    .map((s) => s.mention);
  const workflows = segments.filter(
    (s): s is Extract<PersistedComposerSegment, { type: 'workflow' }> => s.type === 'workflow',
  );
  const wfSeg = workflows[0];

  const reconstructed = reconstructComposerSegmentsFromPrompt({
    prompt,
    attachments,
    skills,
    mentions,
    workflowCode: wfSeg?.id,
    workflowName: wfSeg?.name,
  }) as PersistedComposerSegment[];

  const usedWorkflowIds = new Set(
    reconstructed
      .filter((s): s is Extract<PersistedComposerSegment, { type: 'workflow' }> => s.type === 'workflow')
      .map((s) => s.id),
  );
  const leftoverWorkflows = workflows.filter((w) => !usedWorkflowIds.has(w.id));
  return leftoverWorkflows.length > 0
    ? [...reconstructed, ...leftoverWorkflows]
    : reconstructed;
}

function stickChipsToAdjacentText(segments: ComposerSegment[]): ComposerSegment[] {
  const next = segments.map((seg) => (
    seg.type === 'text' ? { ...seg, text: seg.text } : seg
  ));
  for (let i = 0; i < next.length; i += 1) {
    const seg = next[i];
    if (seg.type !== 'text') continue;
    const prevIsChip = i > 0 && next[i - 1]?.type !== 'text';
    const nextIsChip = i < next.length - 1 && next[i + 1]?.type !== 'text';
    if (prevIsChip) seg.text = seg.text.replace(/^[ \t]*\n+/, '');
    if (nextIsChip) seg.text = seg.text.replace(/[\n\r]+[ \t]*$/, '');
  }
  return next.filter((seg) => seg.type !== 'text' || seg.text);
}

function weaveLeftoverWorkflowsByName(
  segments: ComposerSegment[],
  leftovers: Array<Extract<ComposerSegment, { type: 'workflow' }>>,
): ComposerSegment[] {
  let result = segments;
  for (const workflow of leftovers) {
    const name = workflow.name.trim();
    if (!name) {
      result = [...result, workflow];
      continue;
    }
    let woven = false;
    const next: ComposerSegment[] = [];
    for (const seg of result) {
      if (woven || seg.type !== 'text') {
        next.push(seg);
        continue;
      }
      const idx = seg.text.indexOf(name);
      if (idx < 0) {
        next.push(seg);
        continue;
      }
      const before = seg.text.slice(0, idx);
      const after = seg.text.slice(idx + name.length);
      if (before) next.push({ type: 'text', text: before });
      next.push(workflow);
      if (after) next.push({ type: 'text', text: after });
      woven = true;
    }
    result = woven ? next : [...result, workflow];
  }
  return result;
}

function relocateWorkflowsIfNameAppearsInText(segments: ComposerSegment[]): ComposerSegment[] {
  const workflows = segments.filter(
    (seg): seg is Extract<ComposerSegment, { type: 'workflow' }> => seg.type === 'workflow',
  );
  if (workflows.length === 0) return segments;
  const textBlob = segments
    .filter((seg): seg is Extract<ComposerSegment, { type: 'text' }> => seg.type === 'text')
    .map((seg) => seg.text)
    .join('');
  const movable = workflows.filter((wf) => wf.name.trim() && textBlob.includes(wf.name.trim()));
  if (movable.length === 0) return segments;
  const movableIds = new Set(movable.map((wf) => wf.id));
  const body = segments.filter((seg) => !(seg.type === 'workflow' && movableIds.has(seg.id)));
  return weaveLeftoverWorkflowsByName(body, movable);
}

export function applyBeautifiedTextToSegments(
  segments: ComposerSegment[],
  beautified: string,
): ComposerSegment[] {
  const chips = segments.filter((seg) => seg.type !== 'text');
  const trimmed = beautified.trim();
  if (!trimmed) return chips;
  if (chips.length === 0) return [{ type: 'text', text: trimmed }];

  const mentions = chips
    .filter((seg): seg is Extract<ComposerSegment, { type: 'mention' }> => seg.type === 'mention')
    .map((seg) => seg.mention);
  const skills = chips
    .filter((seg): seg is Extract<ComposerSegment, { type: 'skill' }> => seg.type === 'skill')
    .map((seg) => ({ slug: seg.slug, title: seg.title }));
  const workflows = chips.filter(
    (seg): seg is Extract<ComposerSegment, { type: 'workflow' }> => seg.type === 'workflow',
  );
  const files = chips.filter(
    (seg): seg is Extract<ComposerSegment, { type: 'file' }> => seg.type === 'file',
  );

  const reconstructed = reconstructComposerSegmentsFromPrompt({
    prompt: trimmed,
    attachments: [],
    skills,
    mentions,
    workflowCode: workflows[0]?.id,
    workflowName: workflows[0]?.name,
  });

  const usedWorkflowIds = new Set<string>();
  const result: ComposerSegment[] = [];
  for (const seg of reconstructed) {
    if (seg.type === 'file') continue;
    if (seg.type === 'workflow') {
      const original = workflows.find((w) => w.id === seg.id) ?? workflows[0];
      usedWorkflowIds.add(seg.id);
      result.push({
        type: 'workflow',
        id: seg.id,
        name: original?.name || seg.name,
        source: original?.source || seg.source,
      });
      continue;
    }
    result.push(seg);
  }
  for (const file of files) result.push(file);
  const leftoverWorkflows = workflows.filter((workflow) => !usedWorkflowIds.has(workflow.id));
  return stickChipsToAdjacentText(
    relocateWorkflowsIfNameAppearsInText([...result, ...leftoverWorkflows]),
  );
}
