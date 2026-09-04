/**
 * Plan 闸门（T12）：解析 ```sclaw_plan``` / ```sclaw_step```，判断是否应触发方案确认。
 */
export interface AppDevPlanStep {
  id: string;
  title: string;
  fileHints?: string[];
}

export interface AppDevPlanDocument {
  /** 可编辑的需求说明。 */
  summary: string;
  steps: AppDevPlanStep[];
}

const PLAN_FENCE_RE = /```sclaw_plan\s*([\s\S]*?)```/i;
const STEP_FENCE_RE = /```sclaw_step\s*([\s\S]*?)```/gi;

/** 复杂需求启发式：首轮建站 / 多页 / 官网等；短小改动不触发。 */
const COMPLEX_RE = /(从零|官网|落地页|整站|多页|几个页面|新建.{0,8}页|搭建|完整应用|后台系统|管理后台)/i;
const SMALL_CHANGE_RE = /(改一个字|改下文案|改标题|改颜色|改圆角|微调|typo|错别字|把.{1,12}改成)/i;

const PLAN_GATE_DISABLED_KEY = 'stoclaw:app-dev-plan-gate-disabled';

/** 全局关闭 Plan 闸门（localStorage）；默认开启。 */
export function isAppDevPlanGateEnabled(): boolean {
  try {
    return localStorage.getItem(PLAN_GATE_DISABLED_KEY) !== '1';
  } catch {
    return true;
  }
}

export function setAppDevPlanGateEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(PLAN_GATE_DISABLED_KEY);
    else localStorage.setItem(PLAN_GATE_DISABLED_KEY, '1');
  } catch {
    // ignore
  }
}

export function shouldTriggerPlanGate(input: {
  userText: string;
  /** 会话内已有用户消息数（含本轮前）；0 = 首轮。 */
  priorUserMessageCount: number;
}): boolean {
  if (!isAppDevPlanGateEnabled()) return false;
  const text = input.userText.trim();
  if (!text) return false;
  // 已在确认执行 / 已带闸门约束 → 不再二次包装
  if (/已确认方案|不要再输出 sclaw_plan|系统约束\s*[·.]\s*方案闸门/.test(text)) return false;
  if (text.length < 8) return false;
  if (SMALL_CHANGE_RE.test(text) && text.length < 40) return false;
  if (COMPLEX_RE.test(text)) return true;
  // 首轮且描述较长 → 倾向先方案
  if (input.priorUserMessageCount === 0 && text.length >= 40) return true;
  // 「新增两个页面」类
  if (/新增\s*\d+\s*个?页面|加\s*\d+\s*个?页面|两个页面|三页/.test(text)) return true;
  return false;
}

/** 发送侧包装：要求 Agent 先出方案、先不改代码。 */
export function buildPlanFirstPrompt(userText: string): string {
  return [
    userText.trim(),
    '',
    '【系统约束 · 方案闸门】本需求较复杂：请先只输出 fenced JSON ```sclaw_plan',
    '{"summary":"...","steps":[{"id":"1","title":"...","fileHints":["..."]}]}',
    '```，不要写业务代码、不要改文件。等用户确认后再实现。',
  ].join('\n');
}

/** 若应触发闸门则返回包装后的发送文本，否则返回 null。 */
export function wrapUserTextForPlanGate(input: {
  userText: string;
  priorUserMessageCount: number;
}): string | null {
  if (!shouldTriggerPlanGate(input)) return null;
  return buildPlanFirstPrompt(input.userText);
}

export function extractSclawPlan(text: string): AppDevPlanDocument | null {
  const match = text.match(PLAN_FENCE_RE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim()) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const stepsRaw = (parsed as { steps?: unknown }).steps;
    if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) return null;
    const steps: AppDevPlanStep[] = [];
    for (const item of stepsRaw) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof (item as { id?: unknown }).id === 'string'
        ? (item as { id: string }).id.trim()
        : String(steps.length + 1);
      const title = typeof (item as { title?: unknown }).title === 'string'
        ? (item as { title: string }).title.trim()
        : '';
      if (!title) continue;
      const fileHints = Array.isArray((item as { fileHints?: unknown }).fileHints)
        ? ((item as { fileHints: unknown[] }).fileHints.filter((x): x is string => typeof x === 'string'))
        : undefined;
      steps.push({ id: id || String(steps.length + 1), title, fileHints });
    }
    if (steps.length === 0) return null;
    const summary = typeof (parsed as { summary?: unknown }).summary === 'string'
      ? (parsed as { summary: string }).summary.trim()
      : '';
    return {
      summary: summary || steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n'),
      steps,
    };
  } catch {
    return null;
  }
}

export function extractSclawStepUpdates(text: string): Array<{ id: string; status: string }> {
  const out: Array<{ id: string; status: string }> = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(STEP_FENCE_RE.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim()) as { id?: unknown; status?: unknown };
      if (typeof parsed.id === 'string' && typeof parsed.status === 'string') {
        out.push({ id: parsed.id, status: parsed.status });
      }
    } catch {
      // ignore
    }
  }
  return out;
}

export function buildPlanConfirmPrompt(plan: AppDevPlanDocument): string {
  const steps = plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n');
  return [
    '请按以下已确认方案开始实现，不要再输出 sclaw_plan，直接改代码：',
    '',
    '【需求】',
    plan.summary.trim() || '（见步骤）',
    '',
    '【步骤】',
    steps,
  ].join('\n');
}

/** 把契约 plan 转成 TodoCapsule 可用的派生计划。 */
export function planDocumentToTurnPlanItems(plan: AppDevPlanDocument): Array<{
  key: string;
  title: string;
  state: 'done' | 'active' | 'pending';
}> {
  return plan.steps.map((step, index) => ({
    key: step.id || `plan-${index}`,
    title: step.title,
    state: index === 0 ? 'active' as const : 'pending' as const,
  }));
}
