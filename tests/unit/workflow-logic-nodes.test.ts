import { describe, it, expect } from 'vitest';
import { executeLogicNode } from '../../electron/services/workflow-runtime/logic-nodes';

describe('logic nodes', () => {
  it('action node echoes payload (exact, mirrors _handle_action_node)', async () => {
    const r = await executeLogicNode(
      { id: 'n1', type: 'action', config: { actionType: 'at' } } as any,
      { foo: 1 },
      {} as any,
    );
    expect(r.action).toBe('continue');
    expect(r.output).toEqual([
      { actionType: 'at', executed: true, payload: { foo: 1 } },
    ]);
  });

  it('condition node picks a branch by evaluating branch.condition (branches mode)', async () => {
    const r = await executeLogicNode(
      {
        id: 'n1',
        type: 'condition',
        config: { branches: [{ key: 'yes', condition: 'x>0' }] },
      } as any,
      { x: 5 },
      {} as any,
    );
    expect(r.action).toBe('continue');
    expect(r.output.branch).toBe('yes');
    expect(r.output.branchKey).toBe('yes');
    expect(r.output.matched).toBe(true);
  });

  it('condition node falls back when no branch matches', async () => {
    const r = await executeLogicNode(
      {
        id: 'n1',
        type: 'condition',
        config: { branches: [{ key: 'yes', condition: 'x>100' }] },
      } as any,
      { x: 5 },
      {} as any,
    );
    expect(r.action).toBe('continue');
    expect(r.output.branch).toBe('fallback');
    expect(r.output.matched).toBe(false);
  });

  it('condition node supports legacy expression mode (true/false branch)', async () => {
    const r = await executeLogicNode(
      {
        id: 'n1',
        type: 'condition',
        config: { condition: 'x==5', trueBranch: 'go', falseBranch: 'stop' },
      } as any,
      { x: 5 },
      {} as any,
    );
    expect(r.output.branch).toBe('go');
    expect(r.output.matched).toBe(true);
  });

  it('condition node resolves legacy template paths and in expressions', async () => {
    const r = await executeLogicNode(
      { id: 'n1', type: 'condition', config: { condition: "{{nodes.source.output.status}} in ['ok', 'done']", trueBranch: 'go', falseBranch: 'stop' } } as any,
      { nodes: { source: { output: { status: 'done' } } } },
      {} as any,
    );
    expect(r.output.branch).toBe('go');
  });

  it('transform node normalizes (pass-through) with empty config', async () => {
    const r = await executeLogicNode(
      { id: 'n1', type: 'transform', config: {} } as any,
      { a: 1 },
      {} as any,
    );
    expect(r.action).toBe('continue');
    expect(r.output).toBeDefined();
    expect(r.output.mode).toBe('normalize');
    expect(r.output.result).toEqual({ a: 1 });
  });

  it('transform node filters items (mode=filter)', async () => {
    const r = await executeLogicNode(
      {
        id: 'n1',
        type: 'transform',
        config: {
          transformMode: 'filter',
          filterField: 'status',
          filterOperator: '==',
          filterValue: 'done',
        },
      } as any,
      [{ status: 'done' }, { status: 'pending' }],
      {} as any,
    );
    expect(r.output.mode).toBe('filter');
    expect(r.output.items).toEqual([{ status: 'done' }]);
    expect(r.output.total).toBe(1);
  });

  it('transform node maps selected fields (mode=map)', async () => {
    const r = await executeLogicNode(
      {
        id: 'n1',
        type: 'transform',
        config: { transformMode: 'map', selectedFields: ['id', 'name'] },
      } as any,
      [{ id: 1, name: 'a', extra: 'x' }],
      {} as any,
    );
    expect(r.output.mode).toBe('map');
    expect(r.output.items).toEqual([{ id: 1, name: 'a' }]);
    expect(r.output.fields).toEqual(['id', 'name']);
  });

  it('transform node supports aggregate mode', async () => {
    const r = await executeLogicNode(
      { id: 'n1', type: 'transform', config: { transformMode: 'aggregate', summarySampleSize: 1 } } as any,
      [{ id: 1 }, { id: 2 }], {} as any,
    );
    expect(r.output).toMatchObject({ mode: 'aggregate', total: 2, sample: [{ id: 1 }] });
  });

  it('trigger passes through input (manual triggerType)', async () => {
    const r = await executeLogicNode(
      { id: 'n1', type: 'trigger', config: {} } as any,
      { trig: 1 },
      {} as any,
    );
    expect(r.action).toBe('continue');
    expect(r.output).toEqual({ trig: 1 });
  });

  it('trigger attaches _triggerType for webhook', async () => {
    const r = await executeLogicNode(
      { id: 'n1', type: 'trigger', config: { triggerType: 'webhook' } } as any,
      { trig: 1 },
      {} as any,
    );
    expect(r.output).toEqual({ trig: 1, _triggerType: 'webhook' });
  });

  it('startup_config remains transparent and preserves resolved runtime inputs', async () => {
    const r = await executeLogicNode(
      {
        id: 'n1',
        type: 'startup_config',
        config: { values: { a: 1 } },
      } as any,
      { b: 2 },
      {} as any,
    );
    expect(r.action).toBe('continue');
    expect(r.output).toEqual({ b: 2 });
  });

  it('startup_config passes through input when no config.values', async () => {
    const r = await executeLogicNode(
      { id: 'n1', type: 'startup_config', config: {} } as any,
      { s: 1 },
      {} as any,
    );
    expect(r.output).toEqual({ s: 1 });
  });

  it('output node passes through resolved payload (workflow_output source)', async () => {
    const r = await executeLogicNode(
      { id: 'n1', type: 'output', config: { format: 'structured_json' } } as any,
      { result: 'x' },
      {} as any,
    );
    expect(r.action).toBe('continue');
    expect(r.output).toEqual({ result: 'x' });
  });

  it('output node picks a declared node_output source from the upstream map', async () => {
    const r = await executeLogicNode(
      {
        id: 'n1',
        type: 'output',
        config: { sourceMode: 'node_output', sourceNodeId: 'up1' },
      } as any,
      { up1: { data: 42 }, other: { data: 0 } },
      {} as any,
    );
    expect(r.output).toEqual({ data: 42 });
  });

  it('default (unknown) node passes input through (client no-op)', async () => {
    const r = await executeLogicNode(
      { id: 'n1', type: 'whatever' } as any,
      { z: 1 },
      {} as any,
    );
    expect(r.action).toBe('continue');
    expect(r.output).toEqual({ z: 1 });
  });
});
