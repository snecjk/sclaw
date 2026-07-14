import { describe, it, expect } from 'vitest';
import { extractJsonFromText, validateOutputAgainstSchema, normalizeAgentResultOutput } from '../../electron/services/workflow-runtime/agent-output';
import { compileAgentRunSpec } from '../../electron/services/workflow-runtime/agent-spec';

describe('agent-output', () => {
  it('extracts json from fenced block', () => {
    expect(extractJsonFromText('before ```json\n{"a":1}\n``` after')).toEqual({ a: 1 });
  });
  it('extracts bare json object from text', () => {
    expect(extractJsonFromText('result: {"b":2} done')).toEqual({ b: 2 });
  });
  it('extracts pure json string directly', () => {
    expect(extractJsonFromText('{"c":3}')).toEqual({ c: 3 });
  });
  it('returns null when no json', () => {
    expect(extractJsonFromText('no json here')).toBeNull();
  });
  it('returns null for empty', () => {
    expect(extractJsonFromText('')).toBeNull();
    expect(extractJsonFromText('   ')).toBeNull();
  });
  it('validates output against schema', () => {
    expect(validateOutputAgainstSchema({ type:'object', required:['x'] }, { x: 1 }).ok).toBe(true);
  });
  it('rejects missing required', () => {
    const r = validateOutputAgainstSchema({ type:'object', required:['x'] }, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
  it('rejects non-object when object expected', () => {
    expect(validateOutputAgainstSchema({ type:'object', required:[] }, 'notobj').ok).toBe(false);
  });
  it('validates nested required via properties', () => {
    const r = validateOutputAgainstSchema(
      { type:'object', required:[], properties:{ child:{ type:'object', required:['k'] } } },
      { child: {} });
    expect(r.ok).toBe(false);
  });
});

describe('normalizeAgentResultOutput', () => {
  it('returns output as-is when small', () => {
    expect(normalizeAgentResultOutput({ a: 1 }, {}, 'agent_task', {})).toEqual({ a: 1 });
  });
  it('extracts from rawText when output null', () => {
    expect(normalizeAgentResultOutput(null, {}, 'agent_task', { rawText: '```json\n{"a":1}\n```' })).toEqual({ a: 1 });
  });
  it('writes processFile when >2KB and writer provided', () => {
    const big = { data: 'x'.repeat(3000) };
    const writer = (result: any, str: string) => ({ filePath: '/p/f.json', name: 'f.json', size: str.length, fileType: 'json' });
    const out = normalizeAgentResultOutput(big, { preferFileOutput: true }, 'agent_task', { processFileWriter: writer });
    expect((out as any).filePath).toBe('/p/f.json');
  });
});

describe('compileAgentRunSpec', () => {
  it('builds spec with client_local provider + default contract', () => {
    const spec = compileAgentRunSpec({ type:'agent_data_fetch', config:{ businessConfig:{ kind:'agent_data_fetch' } } }, {});
    expect(spec.target.provider).toBe('client_local');
    expect(spec.target.kind).toBe('agent_data_fetch');
    expect(spec.completionContract.maxAttempts).toBe(2);
    expect(spec.completionContract.onIncomplete).toBe('retry');
    expect(spec.prompt).toBe('');
  });
});
