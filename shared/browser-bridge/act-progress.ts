/**
 * 动作成功态：fill/click 成功必须带「下一步」，同一输入再填就拦。
 * 不靠提示词。thinking 冻住时，模型仍会再调 fill/CDP——拦在工具层。
 */
import { isFailedToolPayload } from './failed-payload';
import type { PageObservation, PageObservationElement } from './page-observation';

export const FILL_DONE_HINT =
  '输入已写入。不要再 fill，也不要用 CDP Runtime.evaluate 改同一输入框。下一步对 nextActions 里的发送/提交按钮 bridge_click。';

export const CLICK_DONE_HINT =
  '点击已送达。用 nextActions 看页面，不要重复同一 ref，也不要连续截同一屏。';

export const REPEAT_FILL_HINT =
  '这个输入框刚才已经填成功了。不要再 fill / 不要再用 CDP 改同一框。请对 nextActions 或上次返回里的发送/提交按钮 bridge_click。';

export const FILL_PROGRESS_ABORT_COUNT = 3;

const SUBMIT_NAME_RE = /发送|提交|生成|开始|确认|创作|send|submit|go|create|build|generate/i;

function shortToolName(toolName: string): string {
  const parts = toolName.split('__');
  return parts[parts.length - 1] || toolName;
}

export type ActProgressKind = 'fill' | 'click';

export interface ActNextAction {
  ref: string;
  role: string;
  name?: string;
}

export function extractCdpExpression(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const rec = input as Record<string, unknown>;
  const params = rec.params;
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const expression = (params as Record<string, unknown>).expression;
    if (typeof expression === 'string') return expression;
  }
  return '';
}

/** 写 DOM，不是 querySelector 探测。 */
export function isCdpDomWrite(expression: string): boolean {
  if (!expression) return false;
  if (/(innerHTML|outerHTML|textContent|innerText)\s*=/.test(expression)) return true;
  if (/\.value\s*=/.test(expression) && /textarea|input|contenteditable|ProseMirror|tiptap/i.test(expression)) {
    return true;
  }
  if (/insertText|execCommand\s*\(\s*['"]insertText['"]/.test(expression)) return true;
  return false;
}

export function inspectFillLikeTool(toolName: string, input: unknown): { targetKey: string } | null {
  const short = shortToolName(toolName);
  if (short === 'bridge_fill' || short === 'ba_fill' || short === 'fill') {
    const rec = input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};
    const ref = typeof rec.ref === 'string' ? rec.ref.trim() : '';
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    return { targetKey: `fill:${ref || name || '*'}` };
  }
  if (short === 'bridge_cdp' || short === 'ba_cdp' || short === 'cdp') {
    const expression = extractCdpExpression(input);
    if (!isCdpDomWrite(expression)) return null;
    return { targetKey: /contenteditable|ProseMirror|tiptap/i.test(expression) ? 'ce' : 'dom-write' };
  }
  return null;
}

export function isProgressUnlockTool(toolName: string): boolean {
  const short = shortToolName(toolName);
  return short === 'bridge_click' || short === 'ba_click' || short === 'click'
    || short === 'bridge_navigate' || short === 'ba_navigate' || short === 'navigate';
}

export function actKindForCommand(
  action: string,
  payload: Record<string, unknown>,
): ActProgressKind | null {
  if (action === 'fill') return 'fill';
  if (action === 'click') return 'click';
  if (action === 'cdp' && inspectFillLikeTool('bridge_cdp', payload)) return 'fill';
  return null;
}

function asObservation(value: unknown): PageObservation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (!Array.isArray(rec.elements)) return null;
  return rec as PageObservation;
}

export function pickNextActions(
  elements: PageObservationElement[],
  filledRef?: string,
): ActNextAction[] {
  const clickable = elements.filter((el) => (
    el.clickable !== false && (el.role === 'button' || el.role === 'link' || el.clickable === true)
  ));
  const named = clickable.filter((el) => SUBMIT_NAME_RE.test(el.name ?? ''));
  if (named.length > 0) return named.slice(0, 5).map(toNextAction);

  const filled = filledRef ? elements.find((el) => el.ref === filledRef) : undefined;
  if (filled?.boundingBox) {
    const origin = filled.boundingBox;
    const ranked = clickable
      .filter((el) => el.ref !== filledRef && el.boundingBox)
      .map((el) => {
        const box = el.boundingBox!;
        const dx = box.x - (origin.x + origin.width);
        const dy = box.y - origin.y;
        return { el, dist: dx * dx + dy * dy };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5)
      .map((item) => toNextAction(item.el));
    if (ranked.length > 0) return ranked;
  }

  return clickable.slice(-3).map(toNextAction);
}

function toNextAction(el: PageObservationElement): ActNextAction {
  const next: ActNextAction = { ref: el.ref, role: el.role };
  if (el.name) next.name = el.name;
  return next;
}

export function annotateSuccessfulAct(input: {
  kind: ActProgressKind;
  result: unknown;
  observation?: unknown;
  filledRef?: string;
}): unknown {
  if (isFailedToolPayload(input.result)) return input.result;
  const hint = input.kind === 'fill' ? FILL_DONE_HINT : CLICK_DONE_HINT;
  const observation = asObservation(input.observation);
  const nextActions = observation
    ? pickNextActions(observation.elements, input.filledRef)
    : [];

  if (!input.result || typeof input.result !== 'object' || Array.isArray(input.result)) {
    return {
      result: input.result,
      success: true,
      actionHint: hint,
      ...(input.kind === 'fill' ? { filled: true } : {}),
      ...(nextActions.length > 0 ? { nextActions } : {}),
    };
  }

  const rec = input.result as Record<string, unknown>;
  const existing = typeof rec.actionHint === 'string' ? rec.actionHint.trim() : '';
  return {
    ...rec,
    ...(input.kind === 'fill' ? { filled: true } : {}),
    actionHint: existing && existing !== hint ? `${existing} ${hint}` : hint,
    ...(nextActions.length > 0 ? { nextActions } : {}),
  };
}

export async function attachSuccessfulActProgress(input: {
  action: string;
  payload: Record<string, unknown>;
  result: unknown;
  snapshot: () => Promise<unknown>;
}): Promise<unknown> {
  const kind = actKindForCommand(input.action, input.payload);
  if (!kind || isFailedToolPayload(input.result)) return input.result;
  const filledRef = typeof input.payload.ref === 'string' ? input.payload.ref : undefined;
  let observation: unknown;
  try {
    observation = await input.snapshot();
  } catch {
    observation = undefined;
  }
  return annotateSuccessfulAct({ kind, result: input.result, observation, filledRef });
}

export function toolResponseLooksSuccessful(response: unknown): boolean {
  if (response == null) return false;
  if (typeof response !== 'object') return true;
  const rec = response as Record<string, unknown>;
  if (rec.isError === true || rec.success === false) return false;
  const contents = rec.content;
  if (!Array.isArray(contents)) return rec.success !== false;
  for (const block of contents) {
    if (!block || typeof block !== 'object') continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim()) continue;
    if (text.includes('判定为空转') || text.includes('已经填成功') || text.includes('已经写入')) {
      return false;
    }
    try {
      const parsed = JSON.parse(text) as { success?: unknown };
      if (parsed && parsed.success === false) return false;
    } catch {
      /* 非 JSON 的拦截话术已在上面处理 */
    }
  }
  return true;
}

export interface FillProgressDecision {
  blocked: boolean;
  abort: boolean;
  count: number;
}

export interface FillProgressTracker {
  shouldBlock(targetKey: string): boolean;
  recordSuccess(targetKey: string): void;
  recordBlock(): FillProgressDecision;
  unlock(): void;
  reset(): void;
}

export function createFillProgressTracker(): FillProgressTracker {
  let lastTarget: string | null = null;
  let denyCount = 0;

  return {
    shouldBlock(targetKey: string): boolean {
      return lastTarget === targetKey;
    },
    recordSuccess(targetKey: string): void {
      lastTarget = targetKey;
      denyCount = 0;
    },
    recordBlock(): FillProgressDecision {
      denyCount += 1;
      return {
        blocked: true,
        abort: denyCount >= FILL_PROGRESS_ABORT_COUNT,
        count: denyCount,
      };
    },
    unlock(): void {
      lastTarget = null;
      denyCount = 0;
    },
    reset(): void {
      lastTarget = null;
      denyCount = 0;
    },
  };
}
