/**
 * Workflow Intent Recognition Hook
 *
 * Detects when a user's natural language message indicates intent
 * to create or execute a workflow, even without `/` slash commands.
 */
import { searchWorkflowTemplates } from '@/lib/workflow-api';
import type { WorkflowTemplateSearchItem } from '@/types/workflow';

/** Keywords that suggest workflow intent */
const WORKFLOW_KEYWORDS = [
  '工作流',
  'workflow',
  '流程',
  '创建',
  '执行',
  '运行',
  '启动',
  '开始',
  '帮我做',
  '帮我生成',
  '帮我创建',
  '帮我执行',
  '做一份',
  '生成一份',
  '对账',
  '结算',
];

/** Phrases that should NOT trigger workflow mode (false positive guards) */
const FALSE_POSITIVE_PATTERNS = [
  /工作流.?(顺畅|顺利|完成|结束|搞定)/,
  /今天.?(流程|工作流)/,
  /这个.?(流程|工作流).?(不错|很好|可以)/,
];

/** Minimum match score to auto-proceed without user confirmation */
const HIGH_CONFIDENCE_THRESHOLD = 0.85;
/** Minimum match score to show template list for user selection */
const LOW_CONFIDENCE_THRESHOLD = 0.6;

export interface WorkflowIntentResult {
  hasIntent: boolean;
  templates: WorkflowTemplateSearchItem[];
  bestMatch: WorkflowTemplateSearchItem | null;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Detect if user text contains workflow-related intent.
 * Returns true if keywords are present AND not a false positive.
 */
export function detectWorkflowIntent(text: string): boolean {
  if (!text || typeof text !== 'string') return false;

  // Check false positive patterns first
  for (const pattern of FALSE_POSITIVE_PATTERNS) {
    if (pattern.test(text)) return false;
  }

  const lower = text.toLowerCase();
  return WORKFLOW_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Resolve workflow template from user text by calling backend search.
 * Returns matched templates with confidence level.
 */
export async function resolveTemplateFromText(
  text: string,
  limit = 5,
): Promise<WorkflowIntentResult> {
  try {
    const result = await searchWorkflowTemplates(text, limit);
    const allItems = [
      ...(result.matchedItems ?? []),
      ...(result.recommendedItems ?? []),
    ];

    if (allItems.length === 0) {
      return { hasIntent: false, templates: [], bestMatch: null, confidence: 'low' };
    }

    // Sort by matchScore descending
    allItems.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    const best = allItems[0];
    const score = best.matchScore ?? 0;

    let confidence: WorkflowIntentResult['confidence'] = 'low';
    if (score >= HIGH_CONFIDENCE_THRESHOLD) confidence = 'high';
    else if (score >= LOW_CONFIDENCE_THRESHOLD) confidence = 'medium';

    return {
      hasIntent: true,
      templates: allItems,
      bestMatch: best,
      confidence,
    };
  } catch (err) {
    console.error('[resolveTemplateFromText] search failed:', err);
    return { hasIntent: false, templates: [], bestMatch: null, confidence: 'low' };
  }
}

/**
 * Check if user message is a cancellation intent during workflow configuration.
 */
export function isWorkflowCancelIntent(text: string): boolean {
  if (!text) return false;
  const cancelPatterns = /(?:取消|不执行|不做了|算了|停止|退出|放弃)/i;
  return cancelPatterns.test(text);
}

/**
 * Check if user message indicates immediate execution without separate confirmation.
 */
export function isImmediateExecutionIntent(text: string): boolean {
  if (!text) return false;
  const immediatePatterns = /(?:创建并执行|创建并运行|直接执行|立即执行|马上执行)/i;
  return immediatePatterns.test(text);
}

/**
 * Check if user message is a re-execution intent for a remembered workflow.
 */
export function isReExecutionIntent(text: string): boolean {
  if (!text) return false;
  const reExecPatterns = /(?:执行刚才的|再跑一遍|再执行一次|重新执行|用上次参数|继续执行)/i;
  return reExecPatterns.test(text);
}

/** Build assistant prompt listing candidate templates for user selection. */
export function buildTemplateSelectionPrompt(templates: WorkflowTemplateSearchItem[]): string {
  const lines = templates.slice(0, 3).map((t, i) => {
    const desc = t.description ? ` — ${t.description}` : '';
    return `${i + 1}. ${t.label}${desc}`;
  });
  return [
    '检测到您想创建工作流，请确认要执行哪一个：',
    '',
    ...lines,
    '',
    '请回复序号（如 1）或工作流名称；也可输入 / 打开工作流选择器。',
  ].join('\n');
}

/** Prompt when workflow intent is detected but no template matched confidently. */
export function buildWorkflowClarificationPrompt(): string {
  return [
    '未能识别您要创建的具体工作流。',
    '请明确工作流名称（例如：「创建结算对账工作流」），或输入 / 从列表中选择。',
  ].join('\n');
}

/**
 * Resolve user's template selection from a numbered list or name match.
 */
export function resolveTemplateSelectionFromText(
  text: string,
  templates: WorkflowTemplateSearchItem[],
): WorkflowTemplateSearchItem | null {
  const trimmed = text.trim();
  if (!trimmed || templates.length === 0) return null;

  const numMatch = trimmed.match(/^(?:选|选择)?\s*([1-9])\s*$/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < templates.length) return templates[idx];
  }

  const lower = trimmed.toLowerCase();
  const byLabel = templates.find((t) => lower.includes(t.label.toLowerCase()));
  if (byLabel) return byLabel;

  return templates.find((t) => lower.includes(t.id.toLowerCase())) ?? null;
}
