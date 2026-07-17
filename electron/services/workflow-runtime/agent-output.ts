/**
 * Agent 输出规整 + 校验 — TS 移植自 memory-center/src/services/workflow_core。
 * - extractJsonFromText: 移植自 schema_validator.py:84
 * - validateOutputAgainstSchema: 移植自 schema_validator.py:7 (_validate_value 递归)
 * - normalizeAgentResultOutput: 移植自 output_templates.py:414（>2KB 落盘用注入的 processFileWriter）
 */
import fs from 'node:fs';
import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  const expectedKind = firstEnumValue(contract?.outputJsonSchema, 'kind') ?? resultKind;
  const expectedStatus = firstEnumValue(contract?.outputJsonSchema, 'status') ?? 'succeeded';
  const expectedVersion = firstEnumValue(contract?.outputJsonSchema, 'version') ?? '1';

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
    if ('data' in result) {
      normalized = {
        ...result,
        // Historical workflows often use business envelope values such as
        // kind="science-popularization", status="completed", version="1.0.0".
        // They describe the same successful payload but do not satisfy the
        // current cloud completion contract. Canonicalize wrapper metadata
        // while preserving data/summary/artifacts/processFiles verbatim.
        kind: normalizeEnvelopeValue(result.kind, expectedKind, contract?.outputJsonSchema, 'kind'),
        version: normalizeEnvelopeValue(result.version, expectedVersion, contract?.outputJsonSchema, 'version'),
        status: normalizeEnvelopeValue(result.status, expectedStatus, contract?.outputJsonSchema, 'status'),
      };
    } else {
      normalized = {
        kind: expectedKind,
        version: expectedVersion,
        status: expectedStatus,
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

function firstEnumValue(schema: any, field: string): unknown {
  const values = schema?.properties?.[field]?.enum;
  return Array.isArray(values) && values.length > 0 ? values[0] : undefined;
}

function normalizeEnvelopeValue(
  actual: unknown,
  fallback: unknown,
  schema: any,
  field: string,
): unknown {
  const allowed = schema?.properties?.[field]?.enum;
  if (!Array.isArray(allowed) || allowed.length === 0) return actual ?? fallback;
  return allowed.includes(actual) ? actual : fallback;
}

/**
 * Agent 的 JSON 只是声明，不能把其中的 filePath 当成已经落盘的事实。
 * 本地执行仅接受当前运行 workspace 内实际存在的文件，避免虚构产物被展示、上传或传给下游。
 */
export async function validateDeclaredArtifactFiles(output: unknown, workspaceDirectory: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!output || typeof output !== 'object') return { ok: true };
  const references = collectDeclaredFileReferences(output as Record<string, unknown>);
  for (const reference of references) {
    const filePath = toLocalFilePath(reference);
    if (!filePath) return { ok: false, reason: `${reference.label} 缺少本地 filePath` };
    const resolved = path.resolve(filePath);
    const relative = path.relative(path.resolve(workspaceDirectory), resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { ok: false, reason: `${reference.label} 必须位于当前运行工作区` };
    }
    try {
      if (!(await stat(resolved)).isFile()) {
        return { ok: false, reason: `${reference.label} 指向的文件不存在: ${resolved}` };
      }
    } catch {
      return { ok: false, reason: `${reference.label} 指向的文件不存在: ${resolved}` };
    }
  }
  return { ok: true };
}

/**
 * Complete process-file metadata from files the Agent already wrote.
 * The former server runtime owned this normalization; local execution must not
 * force the model to reproduce filesystem metadata perfectly in JSON.
 */
export async function reconcileProcessFiles(
  output: unknown,
  nodeWorkspaceDirectory: string,
): Promise<unknown> {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output;
  const record = output as Record<string, any>;
  if (!Array.isArray(record.processFiles) || record.processFiles.length === 0) return output;
  const workspace = path.resolve(nodeWorkspaceDirectory);
  const files = await listWorkspaceFiles(workspace);
  const byName = new Map<string, string[]>();
  for (const file of files) {
    const name = path.basename(file).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), file]);
  }

  const normalized = await Promise.all(record.processFiles.map(async (entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const item = { ...(entry as Record<string, any>) };
    let localPath = toLocalFilePath({
      filePath: typeof item.filePath === 'string' ? item.filePath : item.file_path,
      uri: typeof item.uri === 'string' ? item.uri : undefined,
    });
    if (localPath && !path.isAbsolute(localPath)) localPath = path.resolve(workspace, localPath);
    if (!localPath || !(await isWorkspaceFile(localPath, workspace))) {
      const declaredName = String(item.name || (localPath ? path.basename(localPath) : '')).trim().toLowerCase();
      const matches = declaredName ? (byName.get(declaredName) ?? []) : [];
      if (matches.length === 1) localPath = matches[0];
    }
    if (!localPath || !(await isWorkspaceFile(localPath, workspace))) return item;
    const info = await stat(localPath);
    item.filePath = localPath;
    item.name = String(item.name || path.basename(localPath));
    item.size = Number.isInteger(item.size) && item.size >= 0 ? item.size : info.size;
    item.fileType = String(item.fileType || item.contentType || inferFileType(localPath));
    item.uri = pathToFileURL(localPath).href;
    delete item.file_path;
    return item;
  }));
  return { ...record, processFiles: normalized };
}

async function listWorkspaceFiles(directory: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (current: string): Promise<void> => {
    let entries: Dirent[];
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) out.push(target);
    }
  };
  await visit(directory);
  return out;
}

async function isWorkspaceFile(filePath: string, workspace: string): Promise<boolean> {
  const resolved = path.resolve(filePath);
  const relative = path.relative(workspace, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  try { return (await stat(resolved)).isFile(); } catch { return false; }
}

function inferFileType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'application/json';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.xls') return 'application/vnd.ms-excel';
  if (ext === '.html' || ext === '.htm') return 'text/html';
  if (ext === '.md') return 'text/markdown';
  if (ext === '.txt') return 'text/plain';
  if (ext === '.pdf') return 'application/pdf';
  return ext ? ext.slice(1) : 'application/octet-stream';
}

function collectDeclaredFileReferences(output: Record<string, unknown>): Array<{ label: string; filePath?: string; uri?: string }> {
  const references: Array<{ label: string; filePath?: string; uri?: string }> = [];
  for (const field of ['artifacts', 'processFiles']) {
    const entries = output[field];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const value = entry as Record<string, unknown>;
      references.push({
        label: `${field}[${index}]`,
        filePath: typeof value.filePath === 'string' ? value.filePath : typeof value.file_path === 'string' ? value.file_path : undefined,
        uri: typeof value.uri === 'string' ? value.uri : undefined,
      });
    });
  }
  return references;
}

function toLocalFilePath(reference: { filePath?: string; uri?: string }): string | undefined {
  if (reference.filePath?.trim()) return reference.filePath.trim();
  const uri = reference.uri?.trim();
  if (!uri?.startsWith('file:')) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    // Claude occasionally returns file://C:/... instead of the canonical file:///C:/... form.
    return uri.replace(/^file:\/\/+/, '');
  }
}
