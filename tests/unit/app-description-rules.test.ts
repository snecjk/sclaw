import { describe, expect, it } from 'vitest';
import { normalizeAppDescription } from '../../electron/services/app-dev-service';
import { resolveFirstPushAppDescription } from '../../electron/services/code-collab-service';

describe('application description rules', () => {
  it('normalizes descriptions and enforces the server-side limit', () => {
    expect(normalizeAppDescription('  查询快递状态  ')).toBe('查询快递状态');
    expect(normalizeAppDescription(undefined)).toBe('');
    expect(() => normalizeAppDescription('描'.repeat(201))).toThrow('应用描述不能超过 200 个字符');
    expect(() => normalizeAppDescription({})).toThrow('应用描述格式不正确');
  });

  it('preserves legacy first-push fallback and explicit empty semantics', () => {
    expect(resolveFirstPushAppDescription('查询助手', undefined)).toBe('查询助手 应用');
    expect(resolveFirstPushAppDescription('查询助手', '')).toBeNull();
    expect(resolveFirstPushAppDescription('查询助手', '  处理异常件  ')).toBe('处理异常件');
  });
});
