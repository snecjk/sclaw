/**
 * Agent 输出规整 + 校验 — TS 移植自 memory-center/src/services/workflow_core。
 * - extractJsonFromText: 移植自 schema_validator.py:84
 * - validateOutputAgainstSchema: 移植自 schema_validator.py:7 (_validate_value 递归)
 * - normalizeAgentResultOutput: 移植自 output_templates.py:414（>2KB 落盘用注入的 processFileWriter）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDataDir } from '../../utils/paths';

const TAG_RE = /<[^>]+>/g;
const JSON_FENCE_RE = /```json\s*([\s\S]*?)```/i;

export function extractJsonFromText(text: string): any | null {
  if (!text || !text.trim()) return null;
  // 1) 直接 parse
  try { return JSON.parse(text); } catch { /* fallthrough */ }
  // 2) 去除 HTML 标签后再 parse
  const cleaned = text.replace(TAG_RE, '').trim();
  if (cleaned && cleaned !== text) {
    try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  }
  const target = cleaned || text;
  // 3) ```json fence
  const m = target.match(JSON_FENCE_RE);
  if (m) {
    try { return JSON.parse(m[1]); } catch { /* fallthrough */ }
  }
  // 4) 首个 { 到末个 } 的子串
  const first = target.indexOf('{');
  const last = target.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(target.slice(first, last + 1)); } catch { /* fallthrough */ }
  }
  return null;
}

export function createProcessFileWriter(runId: string, nodeId: string): (value: any, serialized: string) => any {
  return (_value, serialized) => {
    const directory = path.join(getDataDir(), 'workflow-runtime', 'workspaces', runId, nodeId, 'processFiles');
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, `result-${Date.now()}.json`);
    fs.writeFileSync(filePath, serialized, 'utf8');
    return {
      kind: 'generic_data_result', version: '1', status: 'succeeded',
      data: { filePath, uri: pathToFileURL(filePath).href },
      processFiles: [{ filePath, uri: pathToFileURL(filePath).href, name: path.basename(filePath), size: Buffer.byteLength(serialized), fileType: 'application/json' }],
    };
  };
}

export function validateOutputAgainstSchema(schema: any, output: any): { ok: boolean; reason?: string } {
  const errors: string[] = [];
  validateValue(schema, output, '');
  if (errors.length) return { ok: false, reason: errors.join('; ') };
  return { ok: true };

  function validateValue(s: any, value: any, path: string): void {
    if (!s || typeof s !== 'object') return;
    const expectedType = s.type;
    if (expectedType && !checkType(value, expectedType)) {
      errors.push(`${path || '输出'} 类型错误: 期望 ${expectedType}`);
      return;
    }
    if (Array.isArray(s.enum) && !s.enum.includes(value)) {
      errors.push(`${path || '输出'} 值不在允许范围: ${JSON.stringify(s.enum)}`);
      return;
    }
    if (expectedType === 'string') {
      const minLen = s.minLength;
      if (typeof minLen === 'number' && typeof value === 'string' && value.length < minLen) {
        errors.push(`${path || '输出'} 字符串长度不足: 至少需要 ${minLen} 个字符`);
      }
      return;
    }
    if (expectedType === 'array') {
      const minItems = s.minItems;
      if (typeof minItems === 'number' && Array.isArray(value) && value.length < minItems) {
        errors.push(`${path || '输出'} 数组元素不足: 至少需要 ${minItems} 项`);
      }
      const itemSchema = s.items;
      if (itemSchema && typeof itemSchema === 'object' && Array.isArray(value)) {
        value.forEach((item, idx) => validateValue(itemSchema, item, path ? `${path}[${idx}]` : `[${idx}]`));
      }
      return;
    }
    if (expectedType === 'object') {
      const required: string[] = s.required || [];
      const properties = s.properties || {};
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const field of required) {
          if (!(field in value)) errors.push(`缺少必填字段: ${path ? `${path}.${field}` : field}`);
        }
        for (const [name, prop] of Object.entries(properties)) {
          if (!prop || typeof prop !== 'object') continue;
          if (!(name in value)) continue;
          validateValue(prop, value[name], path ? `${path}.${name}` : name);
        }
      }
      return;
    }
  }
}

function checkType(value: any, typeName: string): boolean {
  switch (typeName) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && !Number.isNaN(value) && typeof value !== 'boolean';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'null': return value === null;
    default: return true; // 未知类型不校验
  }
}

/**
 * 移植自 output_templates.py:414 normalize_agent_result_output。
 * 客户端版：若 output 为空但有 rawText → extractJsonFromText；
 * 若结构化结果较大（>2KB）且注入了 ctx.processFileWriter → 落盘为 processFile 引用 {filePath,name,size,fileType}；
 * 否则原样返回 output。
 */
export function normalizeAgentResultOutput(
  output: any,
  contract: any,
  _nodeType: string,
  ctx: any,
): any {
  let result = output;
  if ((result === null || result === undefined) && ctx?.rawText) {
    result = extractJsonFromText(ctx.rawText);
  }
  if (result === null || result === undefined) return result;

  const resultKind = contract?.resultKind || 'generic_data_result';

  // The workflow contract always consumes the canonical result envelope.  Agent
  // models, however, commonly return the business payload directly (for
  // example `{ summary: '...' }`).  The server runtime normalizes that shape
  // before validation; keep the local runtime compatible so a valid task is not
  // retried and then marked failed just because the envelope was omitted.
  let normalized = result;
  if (typeof result === 'string') {
    const contentMode = contract?.contentMode || 'structured_json';
    if (contentMode === 'structured_json') {
      normalized = {
        kind: resultKind,
        version: '1',
        status: 'succeeded',
        data: { text: result },
        summary: { text: result },
      };
    } else {
      normalized = result;
    }
  } else if (typeof result === 'object' && !Array.isArray(result)) {
    if ('kind' in result && 'data' in result) {
      normalized = {
        ...result,
        version: result.version ?? '1',
        status: result.status ?? 'succeeded',
      };
    } else {
      normalized = {
        kind: resultKind,
        version: '1',
        status: 'succeeded',
        data: result,
      };
    }
  }

  const str = typeof normalized === 'string' ? normalized : JSON.stringify(normalized);
  const preferFile = contract?.preferFileOutput !== false;
  if (preferFile && str.length > 2048 && typeof ctx?.processFileWriter === 'function') {
    // >2KB 落盘（客户端 cwd 下的 processFiles/）
    return ctx.processFileWriter(normalized, str);
  }
  return normalized;
}
