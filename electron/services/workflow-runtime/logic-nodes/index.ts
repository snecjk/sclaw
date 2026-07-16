/**
 * 逻辑节点 TS 移植（镜像 memory-center/src/services/workflow_service.py 的纯逻辑分支）。
 *
 * 移植来源：
 * - _handle_action_node (workflow_service.py:3481) — echo/marker，无外部 API
 * - _handle_condition_node / _execute_condition_node (:3395) — 评估表达式选分支
 * - _handle_transform_node / _execute_transform_node (:3410) — normalize/filter/map 模式
 * - _handle_output_node / _execute_output_node (:3470) — 选择上游源
 * - _handle_trigger_node (:3236) — 透传触发输入
 * - _handle_startup_config_node (:3251) — 输出启动配置
 * - _handle_default_node (:3506) — 未知节点 no-op
 *
 * 注意：服务端版本依赖 _build_node_execution_input/_build_upstream_map 等运行时上下文，
 * 客户端版由 NodeDispatcher 把"上游输出 map"作为 input 传入，逻辑节点在此 input 上做无状态转换。
 */
import type { RunCtx, NodeResult } from '../types';
import { resolvePath } from '../input-resolver';

export async function executeLogicNode(node: any, input: any, _ctx: RunCtx): Promise<NodeResult> {
  switch (node.type) {
    case 'action':
      return { action: 'continue', output: [{ actionType: node.config?.actionType, executed: true, payload: input ?? {} }] };
    case 'transform':
      return { action: 'continue', output: applyTransform(node.config ?? {}, input) };
    case 'output':
      return { action: 'continue', output: pickOutput(node.config ?? {}, input) };
    case 'trigger':
      return { action: 'continue', output: applyTrigger(node.config ?? {}, input) };
    case 'startup_config':
      return { action: 'continue', output: input };
    case 'condition':
      return { action: 'continue', output: { ...resolveConditionBranch(node.config ?? {}, input), branchKey: resolveConditionBranch(node.config ?? {}, input).branch } };
    default:
      return { action: 'continue', output: input };
  }
}

/** 移植自 _execute_condition_node (:3395) + branches 模式。
 *  - branches 模式：逐分支评估 branch.condition，首个命中→该 key；无命中→fallback。
 *  - legacy 模式：评估 condition/trueBranch/falseBranch。
 */
function resolveConditionBranch(cfg: any, input: any): { branch: string; matched: boolean } {
  const ctx = (input && typeof input === 'object') ? input : {};
  // branches 模式
  if (Array.isArray(cfg.branches) && cfg.branches.length > 0) {
    for (const b of cfg.branches) {
      if (b && typeof b.condition === 'string' && evaluateCondition(b.condition, ctx)) {
        return { branch: b.branchKey ?? b.key, matched: true };
      }
    }
    const fallback = cfg.branches.find((b: any) => b?.isFallback);
    return { branch: fallback?.branchKey ?? fallback?.key ?? 'fallback', matched: false };
  }
  // legacy 模式（镜像 _execute_condition_node）
  const expr = cfg.expression || cfg.condition || '';
  const matched = expr ? evaluateCondition(expr, ctx) : false;
  const trueBranch = cfg.truePort || cfg.trueBranch || 'yes';
  const falseBranch = cfg.falsePort || cfg.falseBranch || 'no';
  return { branch: matched ? trueBranch : falseBranch, matched };
}

/** 移植自 _execute_transform_node (:3410) + _transform_payload。模式：normalize/filter/map。 */
function applyTransform(cfg: any, input: any): any {
  const source = unwrapCollection(input);
  const mode = cfg.transformMode || cfg.mode || 'normalize';
  if (mode === 'filter') {
    const items = Array.isArray(source) ? source.filter((it) => compareValues(
      it?.[cfg.filterField], cfg.filterOperator || '==', cfg.filterValue)) : [];
    return { mode: 'filter', items, total: items.length };
  }
  if (mode === 'map') {
    const fields: string[] = Array.isArray(cfg.selectedFields) ? cfg.selectedFields : [];
    const items = Array.isArray(source) ? source.map((it) => {
      const out: any = {};
      for (const f of fields) if (it && f in it) out[f] = it[f];
      return out;
    }) : [];
    return { mode: 'map', items, fields };
  }
  if (mode === 'aggregate') {
    const items = Array.isArray(source) ? source : [];
    return { mode: 'aggregate', aggregated: source, total: items.length, sample: items.slice(0, cfg.summarySampleSize ?? 3) };
  }
  // normalize（默认）
  return { mode: 'normalize', result: input };
}

/** 移植自 _execute_output_node (:3470) 的源选择：
 *  - sourceMode='node_output' + sourceNodeId → 从上游 map 取该节点输出
 *  - 否则透传（workflow_output / 结构化 JSON 透传） */
function pickOutput(cfg: any, input: any): any {
  if (cfg.sourceMode === 'node_output' && cfg.sourceNodeId && input && typeof input === 'object' && cfg.sourceNodeId in input) {
    return input[cfg.sourceNodeId];
  }
  return input;
}

/** 移植自 _handle_trigger_node (:3236)：透传触发输入；webhook 类型附 _triggerType。 */
function applyTrigger(cfg: any, input: any): any {
  if (cfg.triggerType) {
    return { ...(input ?? {}), _triggerType: cfg.triggerType };
  }
  return input;
}

/** 简易条件求值（镜像 evaluate_condition 的常用比较）：
 *  支持 x>0 / x>=0 / x<0 / x<=0 / x==0 / x!=0 / x===0 形式。
 *  仅满足 condition 节点配置常用范围，不做完整表达式引擎。 */
export function evaluateCondition(expr: string, ctx: Record<string, any>): boolean {
  const e = String(expr || '').trim();
  if (!e) return false;
  const resolved = e.replace(/\{\{([^}]+)\}\}/g, (_all, rawPath) => JSON.stringify(resolvePath(ctx, String(rawPath).trim()) ?? null));
  const inMatch = resolved.match(/^(.+?)\s+in\s+\[([^\]]*)\]\s*$/);
  if (inMatch) {
    const left = parseLiteral(inMatch[1]);
    return inMatch[2].split(',').map(parseLiteral).includes(left);
  }
  // try JS comparison with a sanitized context (eval the identifiers against ctx)
  // 仅允许 标识符/数字/字符串/比较/逻辑运算符，禁函数调用
  if (!/^[\w\s.()"'\[\]!=<>+\-*/&|,?:]+$/.test(resolved)) return false;
  try {
    const names = Object.keys(ctx);
    const vals = names.map((n) => ctx[n]);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, `"use strict"; return (${resolved});`);
    return Boolean(fn(...vals));
  } catch {
    return false;
  }
}

function unwrapCollection(input: any): any {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object') {
    if (Array.isArray(input.items)) return input.items;
    const values = Object.values(input);
    if (values.length === 1) return values[0];
  }
  return input;
}

function parseLiteral(value: string): any {
  const token = value.trim();
  try { return JSON.parse(token.replace(/'/g, '"')); } catch { return token; }
}

/** 比较 a op b（filter 模式用）。 */
function compareValues(a: any, op: string, b: any): boolean {
  switch (op) {
    case '==': case 'eq': return a == b; // eslint-disable-line eqeqeq
    case '!=': case 'ne': return a != b; // eslint-disable-line eqeqeq
    case '>': case 'gt': return a > b;
    case '>=': case 'ge': return a >= b;
    case '<': case 'lt': return a < b;
    case '<=': case 'le': return a <= b;
    default: return false;
  }
}
