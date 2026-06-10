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
/** Phrases that trigger template search / new workflow draft (POST create). */
const WORKFLOW_CREATION_PATTERNS = [
  /创建工作流/i,
  /工作流.*创建/i,
  /创建.+工作流/i,
  /新建.+工作流/i,
  /搭建.+工作流/i,
];

/** Phrases that trigger start on an existing workflowId (POST start). */
const WORKFLOW_START_PATTERNS = [
  /(?:帮我|请)?.*(?:运行|执行|启动|跑).*(?:这个|该|此|刚才|上次|已有|当前).*(?:工作流|流程)/i,
  /(?:运行|执行|启动)(?:这个|该|此|刚才|上次)?(?:工作流|流程)/i,
  /(?:再|重新)(?:运行|执行|启动)(?:一次)?/i,
];

export function detectWorkflowIntent(text: string): boolean {
  if (!text || typeof text !== 'string') return false;

  // Check false positive patterns first
  for (const pattern of FALSE_POSITIVE_PATTERNS) {
    if (pattern.test(text)) return false;
  }

  if (WORKFLOW_CREATION_PATTERNS.some((p) => p.test(text))) return true;

  const lower = text.toLowerCase();
  return WORKFLOW_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

/** Whether to call workflow template search API before normal chat. */
export function shouldSearchWorkflowTemplates(text: string): boolean {
  if (isWorkflowStartIntent(text)) return false;
  return detectWorkflowIntent(text) || /工作流|workflow/i.test(text);
}

/**
 * User wants to start/run an already-saved workflow (POST /workflows/{id}/start).
 * Must be checked before creation intent — "运行这个工作流" is NOT template search.
 */
export function isWorkflowStartIntent(text: string): boolean {
  if (!text?.trim()) return false;
  if (isReExecutionIntent(text)) return true;
  if (WORKFLOW_START_PATTERNS.some((p) => p.test(text))) return true;

  const hasWorkflow = /工作流|流程|workflow/i.test(text);
  const hasRunVerb = /运行|执行|启动|跑一遍/i.test(text);
  const hasCreateVerb = /创建|新建|搭建|配置/i.test(text);

  // "帮我运行工作流" without create verb → start if session has saved workflow
  return hasWorkflow && hasRunVerb && !hasCreateVerb;
}

/**
 * User is starting a fresh workflow draft (template search → form → POST create).
 */
export function isNewWorkflowCreationIntent(text: string): boolean {
  if (!text?.trim()) return false;
  if (isWorkflowStartIntent(text)) return false;
  if (WORKFLOW_CREATION_PATTERNS.some((p) => p.test(text))) return true;
  return /(?:帮我|请|想要|我要).*(?:创建|新建|搭建).*(?:工作流|流程)/i.test(text);
}

/** Strip command boilerplate so search focuses on the workflow subject. */
export function extractWorkflowSearchQuery(text: string): string {
  let q = text.trim();
  q = q.replace(/(?:帮我|请|想要|我要)\s*/gi, '');
  q = q.replace(/(?:创建|执行|运行|启动)\s*(?:一个|一份)?\s*(?:工作流|流程)/gi, '');
  q = q.replace(/(?:工作流|流程)\s*(?:创建|执行|运行|启动)/gi, '');
  q = q.replace(/\s+/g, ' ').trim();
  return q;
}

/**
 * User wants to create a workflow but did not name a specific template
 * (e.g. "创建工作流", "帮我创建一个工作流").
 */
export function isUnspecifiedWorkflowCreation(text: string): boolean {
  if (!text?.trim()) return false;
  const trimmed = text.trim();
  const hasCreateIntent =
    isNewWorkflowCreationIntent(trimmed) ||
    /^(创建|新建|搭建)\s*(一个|一份)?\s*(工作流|流程)?$/i.test(trimmed);
  if (!hasCreateIntent) return false;
  const subject = extractWorkflowSearchQuery(trimmed);
  return !subject || /^(工作流|流程|workflow)$/i.test(subject);
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
    const query = extractWorkflowSearchQuery(text);
    const result = await searchWorkflowTemplates(query, limit);
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
  const reExecPatterns = /(?:执行刚才的|再跑一遍|再执行一次|重新执行|用上次参数|继续执行|运行这个|执行这个|启动这个)/i;
  return reExecPatterns.test(text);
}

/** Prompt when user wants to run but no saved workflow exists in session. */
export function buildWorkflowStartUnavailablePrompt(): string {
  return [
    '当前会话没有可运行的工作流记录。',
    '请先通过「创建xxx工作流」完成参数配置，或输入 / 从列表中选择模板。',
  ].join('\n');
}

const TEMPLATE_LIST_LIMIT = 10;

/** Build assistant prompt listing candidate templates for user selection. */
export function buildTemplateSelectionPrompt(
  templates: WorkflowTemplateSearchItem[],
  options?: { unspecified?: boolean },
): string {
  const lines = templates.slice(0, TEMPLATE_LIST_LIMIT).map((t, i) => {
    const desc = t.description ? ` — ${t.description}` : '';
    return `${i + 1}. ${t.label}${desc}`;
  });
  const header = options?.unspecified
    ? '请选择一个工作流模板：'
    : '检测到您想创建工作流，请确认要执行哪一个：';
  return [
    header,
    '',
    ...lines,
    '',
    '请回复序号（如 1）或工作流名称；也可点击输入框中的「选择工作流」或输入 / 打开列表。',
  ].join('\n');
}

export { TEMPLATE_LIST_LIMIT };

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
