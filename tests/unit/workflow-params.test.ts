import { describe, expect, it } from 'vitest';
import { resolveSchemaHash, resolveTemplateId } from '../../sto-plugin/openclaw/sto-workflow-tool/workflow-params';

describe('resolveTemplateId', () => {
  it('accepts templateId', () => {
    expect(resolveTemplateId({ templateId: 'tpl_abc' })).toBe('tpl_abc');
  });

  it('accepts id alias', () => {
    expect(resolveTemplateId({ id: 'tpl_abc' })).toBe('tpl_abc');
  });

  it('rejects missing or literal undefined string', () => {
    expect(() => resolveTemplateId({})).toThrow(/缺少 templateId/);
    expect(() => resolveTemplateId({ templateId: 'undefined' })).toThrow(/缺少 templateId/);
  });
});

describe('resolveSchemaHash', () => {
  it('accepts non-empty schemaHash', () => {
    expect(resolveSchemaHash({ schemaHash: 'hash123' })).toBe('hash123');
  });

  it('rejects empty schemaHash', () => {
    expect(() => resolveSchemaHash({ schemaHash: '' })).toThrow(/缺少 schemaHash/);
    expect(() => resolveSchemaHash({})).toThrow(/缺少 schemaHash/);
  });
});
