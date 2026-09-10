/**
 * embed 注入脚本的感知预算（步 2）：jsdom 真跑 buildSnapshot。
 *
 * 回归的是一次真实建站任务崩坏的第一环：isInteractive 里带着 li/span/div，name 取
 * 整棵后代 textContent，于是页面上每个 div 都产出一条完整记录，单次快照 13.9
 * 万字符——模型丢掉页面模型后开始用 shell 刨 transcript、对同一个 ref 连点。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCLAW_EMBED_BRIDGE_INJECT_SCRIPT } from '../../shared/sclaw-embed-bridge-inject';

interface SnapshotNode {
  ref?: string;
  role: string;
  name?: string;
  tag?: string;
  clickable?: boolean;
  editable?: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
  children?: SnapshotNode[];
}

interface Snapshot {
  url: string;
  title: string;
  nodeCount: number;
  truncated?: boolean;
  actionHint?: string;
  tree: SnapshotNode[];
}

function snapshot(): Snapshot {
  // eslint-disable-next-line no-eval
  (0, eval)(SCLAW_EMBED_BRIDGE_INJECT_SCRIPT);
  const bridge = (window as unknown as { __stoEmbedBridge: { buildSnapshot: () => Snapshot } })
    .__stoEmbedBridge;
  return bridge.buildSnapshot();
}

function flatten(nodes: SnapshotNode[]): SnapshotNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).__stoEmbedBridge;
});

describe('embed buildSnapshot 感知预算', () => {
  it('纯包装层折叠掉，不产出 ref', () => {
    document.body.innerHTML =
      '<div><div><div><section><button>提交</button></section></div></div></div>';

    const result = snapshot();

    expect(result.nodeCount).toBe(1);
    expect(result.tree).toHaveLength(1);
    expect(result.tree[0].role).toBe('button');
    expect(result.tree[0].name).toBe('提交');
  });

  it('div/span 不再因为后代文本而各自成节点', () => {
    const wrappers = Array.from(
      { length: 200 },
      (_, i) => `<div class="row"><span><div>行 ${i}</div></span></div>`,
    ).join('');
    document.body.innerHTML = `<div id="list">${wrappers}</div>`;

    const result = snapshot();

    // 200 行文本 = 200 个自带文本的叶子节点；中间三层包装层全部折叠。
    // 旧实现下 800+ 个元素每个都产出 ref + boundingBox。
    expect(result.nodeCount).toBe(200);
    expect(flatten(result.tree).every((node) => node.boundingBox === undefined)).toBe(true);
  });

  it('假值字段与冗余 tag 不再序列化', () => {
    document.body.innerHTML = '<p>只是一段文字</p>';

    const [node] = snapshot().tree;

    expect(node.role).toBe('p');
    expect('tag' in node).toBe(false);
    expect('clickable' in node).toBe(false);
    expect('editable' in node).toBe(false);
  });

  it('可交互节点保留 clickable/editable 与 boundingBox', () => {
    document.body.innerHTML = '<input aria-label="搜索" />';

    const [node] = snapshot().tree;

    expect(node.clickable).toBe(true);
    expect(node.editable).toBe(true);
    expect(node.boundingBox).toBeDefined();
    expect(node.role).toBe('text'); // inferRole 对 input 取 node.type
    expect(node.tag).toBe('input');
  });

  it('超出节点预算时截断并给出下一步话术', () => {
    document.body.innerHTML = Array.from({ length: 900 }, (_, i) => `<p>段 ${i}</p>`).join('');

    const result = snapshot();

    expect(result.nodeCount).toBe(600);
    expect(result.truncated).toBe(true);
    expect(result.actionHint).toContain('滚动');
    // 截断后的整份快照必须还在可控体积内（旧实现同页面 10 万字符量级）。
    expect(JSON.stringify(result).length).toBeLessThan(40_000);
  });

  it('零尺寸包装层不连带丢掉子树', () => {
    // jsdom 无布局：所有 getBoundingClientRect 都是 0，等价于包装层零尺寸。
    document.body.innerHTML = '<div style="display:contents"><button>确定</button></div>';

    expect(snapshot().tree[0].name).toBe('确定');
  });
});
