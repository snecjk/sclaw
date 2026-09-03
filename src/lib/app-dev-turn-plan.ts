/**
 * AppDev 生成待办派生器（P1 交互改造 T02 · Wave 1 纯前端版）
 *
 * 从轮次流式文本中提取「阶段叙述」（phase-text）作为待办项：
 * - 若模型先输出了编号/符号清单（≥2 项），视为完整计划：后续阶段叙述
 *   或工具完成数推进当前进度，未到达的项为 pending；
 * - 否则每个阶段叙述即一个待办项：生成中最后一项 active、之前的 done；
 * - 无阶段叙述但有工具调用时，以最近工具描述兜底出一项。
 *
 * Wave 2（T12 后）切换为 ```sclaw_plan fenced JSON 契约，本派生器永驻降级。
 */
import type { ToolStatus } from '@/stores/chat';
import { describeAppDevTool } from '@/lib/app-dev-tool-rollup';

export type AppDevTurnPlanItemState = 'done' | 'active' | 'pending';

export interface AppDevTurnPlanItem {
  key: string;
  title: string;
  state: AppDevTurnPlanItemState;
}

export interface AppDevTurnPlan {
  items: AppDevTurnPlanItem[];
  /** 已完成项数（胶囊 x/N 的 x）。 */
  doneCount: number;
  /** 待办总数（胶囊 x/N 的 N）。 */
  totalCount: number;
  /** 当前进行中的任务名（无则 null）。 */
  activeTitle: string | null;
}

const EMPTY_PLAN: AppDevTurnPlan = {
  items: [],
  doneCount: 0,
  totalCount: 0,
  activeTitle: null,
};

export function emptyAppDevTurnPlan(): AppDevTurnPlan {
  return EMPTY_PLAN;
}

const PLAN_ITEM_RE = /^\s*(?:[-*•]|\d{1,2}[.、)])\s+(.+?)\s*$/;
const FENCE_RE = /^\s*```/;
const MAX_TITLE_LENGTH = 40;
const MAX_PLAN_ITEMS = 12;
const MAX_PHASE_ITEMS = 8;

function truncateTitle(text: string): string {
  return text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH - 1)}…` : text;
}

/** 去掉行内 markdown 修饰（加粗/标题/行内代码），折叠空白。 */
function cleanNarrationLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ParsedNarration {
  /** 显式计划清单（≥2 项），无则 null。 */
  planTitles: string[] | null;
  /** 计划清单之后出现的阶段叙述（用于推进计划进度）。 */
  phaseTitlesAfterPlan: string[];
  /** 全部阶段叙述（无计划时作为待办项来源）。 */
  phaseTitles: string[];
}

function parseNarration(texts: readonly string[]): ParsedNarration {
  const lines: string[] = [];
  let inFence = false;
  for (const text of texts) {
    if (!text) continue;
    for (const rawLine of text.split('\n')) {
      if (FENCE_RE.test(rawLine)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      lines.push(rawLine);
    }
  }

  // 第一段「连续 ≥2 条清单行」视为计划
  let planTitles: string[] | null = null;
  let planEndIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const match = PLAN_ITEM_RE.exec(lines[i]!);
    if (!match) continue;
    const run: string[] = [];
    let j = i;
    while (j < lines.length) {
      const itemMatch = PLAN_ITEM_RE.exec(lines[j]!);
      if (!itemMatch) break;
      const title = cleanNarrationLine(itemMatch[1]!);
      if (title) run.push(title);
      j += 1;
    }
    if (run.length >= 2) {
      planTitles = run.slice(0, MAX_PLAN_ITEMS);
      planEndIndex = j - 1;
    }
    break;
  }

  const phaseTitles: string[] = [];
  const phaseTitlesAfterPlan: string[] = [];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    if (PLAN_ITEM_RE.test(line)) return;
    const title = cleanNarrationLine(line);
    // 过短行（语气词/标点）不作为阶段叙述
    if (title.length < 4) return;
    const key = title;
    if (seen.has(key)) return;
    seen.add(key);
    phaseTitles.push(title);
    if (planEndIndex >= 0 && index > planEndIndex) {
      phaseTitlesAfterPlan.push(title);
    }
  });

  return { planTitles, phaseTitlesAfterPlan, phaseTitles };
}

function finalizeStates(
  titles: readonly string[],
  currentIndex: number,
  sending: boolean,
): AppDevTurnPlan {
  const items: AppDevTurnPlanItem[] = titles.map((title, index) => {
    let state: AppDevTurnPlanItemState;
    if (!sending) {
      state = 'done';
    } else if (index < currentIndex) {
      state = 'done';
    } else if (index === currentIndex) {
      state = 'active';
    } else {
      state = 'pending';
    }
    return { key: `plan-${index}`, title: truncateTitle(title), state };
  });
  const doneCount = items.filter((item) => item.state === 'done').length;
  const active = sending ? items.find((item) => item.state === 'active') : undefined;
  return {
    items,
    doneCount,
    totalCount: items.length,
    activeTitle: active?.title ?? null,
  };
}

/**
 * 派生待办清单。
 * @param texts 轮次内 assistant 叙述文本（streamingMessages 文本 + 当前 streamText，按序）
 * @param tools 轮次工具调用
 * @param sending 生成中（false = 轮已结束，全部记 done）
 */
export function deriveAppDevTurnPlan(input: {
  texts: readonly string[];
  tools: readonly ToolStatus[];
  sending: boolean;
}): AppDevTurnPlan {
  const { texts, tools, sending } = input;
  const narration = parseNarration(texts);

  if (narration.planTitles) {
    const completedTools = tools.filter((tool) => tool.status === 'completed').length;
    // 阶段叙述优先推进：最新一条叙述 = 当前任务；
    // 模型不给叙述时按已完成工具数推进（完成 k 个工具 → 进行第 k 项，0 起）
    const advanced = narration.phaseTitlesAfterPlan.length > 0
      ? narration.phaseTitlesAfterPlan.length - 1
      : completedTools;
    const currentIndex = Math.min(Math.max(advanced, 0), narration.planTitles.length - 1);
    return finalizeStates(narration.planTitles, currentIndex, sending);
  }

  if (narration.phaseTitles.length > 0) {
    const titles = narration.phaseTitles.slice(-MAX_PHASE_ITEMS);
    return finalizeStates(titles, titles.length - 1, sending);
  }

  if (tools.length > 0) {
    const lastTool = tools[tools.length - 1]!;
    return finalizeStates([describeAppDevTool(lastTool)], 0, sending);
  }

  return EMPTY_PLAN;
}
