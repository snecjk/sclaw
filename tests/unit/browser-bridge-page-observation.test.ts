// @vitest-environment node
/**
 * 统一观测契约：扁平 elements、超预算不空、AX/DOM 两条入口同形。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AX_CLICKABLE_ROLES,
  AX_EDITABLE_ROLES,
  AX_INTERACTIVE_ROLES,
} from '../../electron/services/browser-automation/ax-observer';
import {
  applyObservationCharBudget,
  flattenDomSnapshotToElements,
  flattenRawAxNodes,
  OBSERVATION_CLICKABLE_ROLES,
  OBSERVATION_EDITABLE_ROLES,
  OBSERVATION_INTERACTIVE_ROLES,
  toPageObservation,
  type DomSnapshotNode,
} from '../../shared/browser-bridge/page-observation';
import {
  EXTENSION_INTERACTIVE_MAX_NODES,
  PERCEPTION_CHAR_BUDGET,
  PERCEPTION_TRUNCATED_HINT,
} from '../../shared/browser-bridge/perception-budget';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

describe('观测契约与 AX 白名单对齐', () => {
  it('共享白名单与 ax-observer 逐值一致', () => {
    expect([...OBSERVATION_INTERACTIVE_ROLES].sort()).toEqual([...AX_INTERACTIVE_ROLES].sort());
    expect([...OBSERVATION_CLICKABLE_ROLES].sort()).toEqual([...AX_CLICKABLE_ROLES].sort());
    expect([...OBSERVATION_EDITABLE_ROLES].sort()).toEqual([...AX_EDITABLE_ROLES].sort());
  });
});

describe('flattenDomSnapshotToElements', () => {
  it('只保留可交互节点，丢掉包装层', () => {
    const tree: DomSnapshotNode[] = [{
      role: 'div',
      children: [
        { ref: '@e1', role: 'button', name: '提交', clickable: true },
        { role: 'span', children: [{ ref: '@e2', role: 'p', name: '说明文字' }] },
      ],
    }];
    expect(flattenDomSnapshotToElements(tree)).toEqual([
      { ref: '@e1', role: 'button', name: '提交', clickable: true },
    ]);
  });

  it('没有可交互节点时保留带 ref 的自命名节点，避免变空', () => {
    const tree: DomSnapshotNode[] = [
      { ref: '@e1', role: 'p', name: '只有文案' },
    ];
    expect(flattenDomSnapshotToElements(tree)).toEqual([
      { ref: '@e1', role: 'p', name: '只有文案' },
    ]);
  });
});

describe('flattenRawAxNodes', () => {
  it('只给交互 role 发 @eN，并保留 backendDOMNodeId 映射', () => {
    const result = flattenRawAxNodes([
      { role: { value: 'WebArea' }, name: { value: '首页' }, backendDOMNodeId: 1 },
      { role: { value: 'button' }, name: { value: '登录' }, backendDOMNodeId: 2 },
      { ignored: true, role: { value: 'link' }, name: { value: '忽略' }, backendDOMNodeId: 3 },
      { role: { value: 'textbox' }, name: { value: '账号' }, backendDOMNodeId: 4 },
    ], 400);
    expect(result.truncated).toBe(false);
    expect(result.elements).toEqual([
      { ref: '@e1', role: 'button', name: '登录', clickable: true },
      { ref: '@e2', role: 'textbox', name: '账号', editable: true },
    ]);
    expect(result.refToBackendNodeId.get('@e1')).toBe(2);
    expect(result.refToBackendNodeId.get('@e2')).toBe(4);
  });

  it('AX properties.editable=richtext 的 generic 进入 elements 并带 editableKind', () => {
    const result = flattenRawAxNodes([
      {
        role: { value: 'generic' },
        name: { value: '' },
        backendDOMNodeId: 276,
        properties: [{ name: 'editable', value: { value: 'richtext' } }],
      },
    ], 400);
    expect(result.elements).toEqual([
      { ref: '@e1', role: 'generic', editable: true, editableKind: 'richtext' },
    ]);
    expect(result.refToBackendNodeId.get('@e1')).toBe(276);
  });

  it('超出节点上限时截断且不重编号', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      role: { value: 'button' },
      name: { value: `B${i}` },
      backendDOMNodeId: i + 1,
    }));
    const result = flattenRawAxNodes(nodes, 3);
    expect(result.truncated).toBe(true);
    expect(result.elements.map((el) => el.ref)).toEqual(['@e1', '@e2', '@e3']);
  });
});

describe('applyObservationCharBudget', () => {
  it('超预算时丢掉 bbox、截尾，且 elements 非空、自述 truncated', () => {
    const elements = Array.from({ length: 4000 }, (_, i) => ({
      ref: `@e${i + 1}`,
      role: 'button',
      name: `很长的按钮文案用来撑爆预算 ${i} ${'x'.repeat(40)}`,
      clickable: true as const,
      boundingBox: { x: i, y: i, width: 80, height: 24 },
    }));
    const observation = toPageObservation({
      url: 'https://example.test',
      title: '大页',
      documentGeneration: 3,
      observationMode: 'ax',
      elements,
    });
    expect(JSON.stringify(observation).length).toBeGreaterThan(PERCEPTION_CHAR_BUDGET);

    const budgeted = applyObservationCharBudget(observation);
    expect(budgeted.elements.length).toBeGreaterThan(0);
    expect(budgeted.elements.length).toBeLessThan(elements.length);
    expect(budgeted.truncated).toBe(true);
    expect(budgeted.actionHint).toBe(PERCEPTION_TRUNCATED_HINT);
    expect(budgeted.elements.every((el) => el.boundingBox === undefined)).toBe(true);
    expect(JSON.stringify(budgeted).length).toBeLessThanOrEqual(PERCEPTION_CHAR_BUDGET);
    expect(budgeted.elements[0].ref).toBe('@e1');
  });

  it('toPageObservation 不产出 tree / backendNodeId / 假值字段', () => {
    const observation = toPageObservation({
      url: 'https://example.test',
      title: 'x',
      documentGeneration: 1,
      observationMode: 'dom',
      elements: [{ ref: '@e1', role: 'button', name: '确定', clickable: true }],
    });
    const json = JSON.stringify(observation);
    expect(json).not.toContain('"tree"');
    expect(json).not.toContain('backendNodeId');
    expect(observation.truncated).toBeUndefined();
    expect(observation.degradationRound).toBeUndefined();
  });
});

describe('扩展手抄副本不漂移', () => {
  it('background.js 默认 mode=ax，失败自述回退 DOM，AX 上限与 SSOT 一致', () => {
    const source = readFileSync(resolve(root, 'browser-extension/background.js'), 'utf8');
    expect(source).toContain("payload.mode === 'dom' ? 'dom' : 'ax'");
    expect(source).toContain("fallbackFrom = 'ax'");
    expect(source).toContain("unsupported = 'CDP_DOMAIN_UNSUPPORTED'");
    expect(source).toContain(`const AX_ELEMENT_LIMIT = ${EXTENSION_INTERACTIVE_MAX_NODES};`);
    expect(source).not.toContain('tree: nodes');
    for (const role of OBSERVATION_INTERACTIVE_ROLES) {
      expect(source, `background.js 缺少 AX role ${role}`).toContain(`${role}: true`);
    }
  });
});
