/**
 * AX 感知层（计划 §四 B6）：经 CDP `Accessibility.getFullAXTree` 抓全量 AX 节点组装树，
 * 作为 P1 感知层主路径（DOM 注入观察为回退路径）。
 *
 * 关键架构变更：AX 模式下 ref ↔ backendNodeId 映射由主进程 RefTable 持有
 * （per session+generation），不再依赖页内 refMap；DOM 模式维持页内 refMap 不动。
 *
 * ⚠️ §六 R1 / §十.2：Electron 40 embed webview（guest 进程）对 Accessibility 域的
 * 转发行为未经实机 PoC 验证——域不支持/无数据时抛 CDP_DOMAIN_UNSUPPORTED，
 * 由 observer(B5)/service(B4) 回退 DOM 注入观察，接口不变。本模块全部单测走 mock CDP。
 */
import {
  BROWSER_AUTOMATION_AX_NODE_BUDGET,
  BROWSER_AUTOMATION_AX_QUADS_BATCH,
  type BrowserAutomationBoundingBox,
  type BrowserAutomationElementRef,
  type BrowserAutomationErrorCode,
  type BrowserAutomationFindMatch,
  type BrowserAutomationFindQuery,
} from '../../../shared/browser-automation/types';
import type { BrowserAutomationCdpSession } from './cdp-session';

/**
 * 可交互 AX role 白名单（17 种）：只对它们颁发 @eN ref。
 * 注：计划 §四 B6 原文列出 15 种；补齐 menuitemcheckbox/menuitemradio 至 17 种（偏差已记录）。
 */
export const AX_INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  'link',
  'button',
  'textbox',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'checkbox',
  'radio',
  'switch',
  'option',
  'searchbox',
  'slider',
  'spinbutton',
  'treeitem',
]);

const AX_CLICKABLE_ROLES: ReadonlySet<string> = new Set([
  'link',
  'button',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'checkbox',
  'radio',
  'switch',
  'option',
  'treeitem',
]);

const AX_EDITABLE_ROLES: ReadonlySet<string> = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'slider',
  'spinbutton',
]);

function axError(code: BrowserAutomationErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function hasErrorCode(error: unknown): boolean {
  return typeof (error as { code?: unknown } | null)?.code === 'string';
}

/** per (session, generation) 的 ref ↔ backendNodeId 映射；AX 模式下 ref 由主进程分配。 */
export class RefTable {
  private counter = 0;
  private readonly refByBackendNodeId = new Map<number, string>();
  private readonly backendNodeIdByRef = new Map<string, number>();
  private readonly metaByRef = new Map<string, { role: string; name: string; stableKey: string }>();

  constructor(readonly generation: number) {}

  assign(backendNodeId: number, meta: { role: string; name: string }): string {
    const existing = this.refByBackendNodeId.get(backendNodeId);
    if (existing) return existing;
    this.counter += 1;
    const ref = `@e${this.counter}`;
    const stableKey = `ax-${backendNodeId}`;
    this.refByBackendNodeId.set(backendNodeId, ref);
    this.backendNodeIdByRef.set(ref, backendNodeId);
    this.metaByRef.set(ref, { role: meta.role, name: meta.name, stableKey });
    return ref;
  }

  resolve(ref: string): number | undefined {
    return this.backendNodeIdByRef.get(ref);
  }

  resolveStableKey(ref: string): string | undefined {
    return this.metaByRef.get(ref)?.stableKey;
  }

  size(): number {
    return this.backendNodeIdByRef.size;
  }
}

/** AX 树的内部节点（含无 ref 的静态节点，供 find 检索与父链上溯）。 */
export interface AxTreeNode {
  nodeId: string;
  backendNodeId?: number;
  role: string;
  name: string;
  value?: string;
  description?: string;
  ignored: boolean;
  interactive: boolean;
  states: string[];
  /** 父节点在 nodes 数组中的下标；根为 -1。 */
  parentIndex: number;
  depth: number;
  /** 预算降级折叠标记：子树被裁掉，凭本节点 ref 可下钻。 */
  collapsed: boolean;
  ref?: string;
  parentRef?: string;
  boundingBox?: BrowserAutomationBoundingBox;
}

/** 一次 AX 抓取的主进程留存（find 检索 / collapsed 下钻的依据）。 */
export interface AxSnapshot {
  generation: number;
  nodes: AxTreeNode[];
  refTable: RefTable;
  truncated: boolean;
  degradationRound: 0 | 1 | 2 | 3;
  rawNodeCount: number;
}

export interface AxCaptureOptions {
  /** 字符预算，默认 BROWSER_AUTOMATION_AX_NODE_BUDGET。 */
  budget?: number;
  interactiveOnly?: boolean;
  /** collapsed 子树下钻：抓该 ref（上一代际 RefTable 解析）对应的子树。 */
  ref?: string;
  /** 解析 opts.ref 所需的上一代际映射表。 */
  refTable?: RefTable;
}

export interface AxCaptureResult {
  elements: BrowserAutomationElementRef[];
  refTable: RefTable;
  snapshot: AxSnapshot;
  truncated: boolean;
  /** 0=完整；1=子树折叠；2=尾部弹出；3=字段长度减半（与计划 0|1|2 相比扩到 3，见偏差说明）。 */
  degradationRound: 0 | 1 | 2 | 3;
  rawNodeCount: number;
}

interface RawAxValue {
  value?: unknown;
}

interface RawAxNode {
  nodeId: string;
  ignored?: boolean;
  role?: RawAxValue;
  name?: RawAxValue;
  value?: RawAxValue;
  description?: RawAxValue;
  properties?: Array<{ name: string; value?: RawAxValue }>;
  childIds?: string[];
  backendDOMNodeId?: number;
}

function stringValue(slot: RawAxValue | undefined): string | undefined {
  const value = slot?.value;
  return typeof value === 'string' ? value : undefined;
}

function collectStates(node: RawAxNode): string[] {
  const states: string[] = [];
  for (const prop of node.properties ?? []) {
    const value = prop.value?.value;
    if (value === true && ['disabled', 'checked', 'selected', 'focused', 'required', 'readonly', 'modal'].includes(prop.name)) {
      states.push(prop.name);
    }
    if (prop.name === 'expanded' && value === true) states.push('expanded');
    if (prop.name === 'expanded' && value === false) states.push('collapsed');
  }
  return states;
}

/** 单节点序列化字符估算（ref/role/name/value/description/bbox 摘要的均摊开销）。 */
function estimateNodeChars(node: AxTreeNode): number {
  return (
    48
    + node.role.length
    + node.name.length
    + (node.value?.length ?? 0)
    + (node.description?.length ?? 0)
  );
}

function estimateTotalChars(nodes: AxTreeNode[], kept: Set<number>): number {
  let total = 0;
  for (const index of kept) total += estimateNodeChars(nodes[index]);
  return total;
}

/** 子树是否含交互节点（interactiveOnly 裁剪与折叠候选共用的标记）。 */
function markSubtreeInteractive(nodes: AxTreeNode[]): boolean[] {
  const hasInteractive = new Array<boolean>(nodes.length).fill(false);
  // nodes 按文档序排列，父先于子 → 倒序一遍即可自底向上聚合
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (node.interactive) hasInteractive[i] = true;
    if (node.parentIndex >= 0 && hasInteractive[i]) {
      hasInteractive[node.parentIndex] = true;
    }
  }
  return hasInteractive;
}

/**
 * 抓全量 AX 树并按预算组装。任何一步抛错（含域不支持/无数据）→ 包装
 * CDP_DOMAIN_UNSUPPORTED 上抛；已带错误码的失败（如 CDP_TIMEOUT）原样上抛。
 */
export async function captureAxTree(
  cdp: BrowserAutomationCdpSession,
  generation: number,
  opts?: AxCaptureOptions,
): Promise<AxCaptureResult> {
  const budget = opts?.budget ?? BROWSER_AUTOMATION_AX_NODE_BUDGET;

  let rawNodes: RawAxNode[];
  try {
    // getFullAXTree 不需要 Accessibility.enable（§四 B6）；DOM 域为 getContentQuads 前置。
    await cdp.enableDomains('DOM');
    const result = await cdp.send<{ nodes?: RawAxNode[] }>('Accessibility.getFullAXTree');
    rawNodes = Array.isArray(result?.nodes) ? result.nodes : [];
  } catch (error) {
    if (hasErrorCode(error)) throw error;
    throw axError(
      'CDP_DOMAIN_UNSUPPORTED',
      `Accessibility.getFullAXTree unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (rawNodes.length === 0) {
    // 空树仍当域不可用并回退 DOM。Electron 40.10.4 实机 PoC（scripts/ax-webview-poc.cjs）
    // 在 BrowserWindow 与 <webview> guest 上均可不经 Accessibility.enable 拿到非空树；
    // 保留本分支覆盖未绘制/跨站点隔离等仍返回空数组的情况。
    throw axError('CDP_DOMAIN_UNSUPPORTED', 'Accessibility.getFullAXTree returned no data');
  }

  // ── 组装内部树（文档序，父先于子）──
  const indexByNodeId = new Map<string, number>();
  rawNodes.forEach((node, index) => indexByNodeId.set(node.nodeId, index));
  const parentOf = new Map<number, number>();
  rawNodes.forEach((node, index) => {
    for (const childId of node.childIds ?? []) {
      const childIndex = indexByNodeId.get(childId);
      if (childIndex !== undefined) parentOf.set(childIndex, index);
    }
  });

  let nodes: AxTreeNode[] = rawNodes.map((raw, index) => {
    const parentIndex = parentOf.get(index) ?? -1;
    const role = stringValue(raw.role) ?? '';
    return {
      nodeId: raw.nodeId,
      backendNodeId: typeof raw.backendDOMNodeId === 'number' ? raw.backendDOMNodeId : undefined,
      role,
      name: stringValue(raw.name) ?? '',
      value: stringValue(raw.value),
      description: stringValue(raw.description),
      ignored: raw.ignored === true,
      interactive: AX_INTERACTIVE_ROLES.has(role.toLowerCase()),
      states: collectStates(raw),
      parentIndex,
      depth: 0, // 下方统一回填
      collapsed: false,
    };
  });
  // 回填 depth（getFullAXTree 返回文档序、父先于子，顺序单趟即可读到已回填的父深度）
  for (let i = 0; i < nodes.length; i += 1) {
    const parentIndex = nodes[i].parentIndex;
    if (parentIndex >= 0) {
      nodes[i] = { ...nodes[i], depth: nodes[parentIndex].depth + 1 };
    }
  }

  const rawNodeCount = nodes.length;

  // ── 下钻：只保留 opts.ref 对应的子树 ──
  if (opts?.ref) {
    const backendNodeId = opts.refTable?.resolve(opts.ref);
    if (backendNodeId === undefined) {
      throw axError('ELEMENT_NOT_FOUND', `无法解析下钻 ref（可能已换代）: ${opts.ref}`);
    }
    const subtreeRoot = nodes.find((node) => node.backendNodeId === backendNodeId);
    if (!subtreeRoot) {
      throw axError('ELEMENT_NOT_FOUND', `下钻目标不在当前 AX 树中: ${opts.ref}`);
    }
    // 以 nodeId 父子关系收集子树成员（childIds 是 AX 原始数据里唯一可靠的父子依据）
    const childIdsByNodeId = new Map<string, string[]>();
    rawNodes.forEach((raw) => childIdsByNodeId.set(raw.nodeId, raw.childIds ?? []));
    const subtreeIds = new Set<string>([subtreeRoot.nodeId]);
    const stack = [subtreeRoot.nodeId];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const childId of childIdsByNodeId.get(current) ?? []) {
        if (subtreeIds.has(childId)) continue;
        subtreeIds.add(childId);
        stack.push(childId);
      }
    }
    // 重建 parent 映射后裁剪：下钻根成为新根（parentIndex=-1）
    const parentNodeIdOf = new Map<string, string>();
    rawNodes.forEach((raw) => {
      for (const childId of raw.childIds ?? []) parentNodeIdOf.set(childId, raw.nodeId);
    });
    nodes = nodes.filter((node) => subtreeIds.has(node.nodeId));
    const indexById = new Map<string, number>();
    nodes.forEach((node, index) => indexById.set(node.nodeId, index));
    nodes = nodes.map((node) => {
      const parentNodeId = parentNodeIdOf.get(node.nodeId);
      const parentIndex = parentNodeId !== undefined ? indexById.get(parentNodeId) ?? -1 : -1;
      return { ...node, parentIndex, depth: 0 };
    });
    for (let i = 0; i < nodes.length; i += 1) {
      const parentIndex = nodes[i].parentIndex;
      if (parentIndex >= 0) {
        nodes[i] = { ...nodes[i], depth: nodes[parentIndex].depth + 1 };
      }
    }
  }

  // 子节点索引（折叠/裁剪用）
  const buildChildrenOf = (): Map<number, number[]> => {
    const childrenOf = new Map<number, number[]>();
    nodes.forEach((node, index) => {
      if (node.parentIndex >= 0) {
        const list = childrenOf.get(node.parentIndex) ?? [];
        list.push(index);
        childrenOf.set(node.parentIndex, list);
      }
    });
    return childrenOf;
  };
  const childrenOf = buildChildrenOf();

  const kept = new Set<number>(nodes.map((_, index) => index));

  // ── interactiveOnly：先做"子树含交互节点"标记，再裁掉无交互子树的纯静态节点 ──
  if (opts?.interactiveOnly) {
    const hasInteractive = markSubtreeInteractive(nodes);
    nodes.forEach((node, index) => {
      if (index === 0) return; // 根保留
      if (!node.interactive && !hasInteractive[index]) {
        kept.delete(index);
      }
    });
  }

  // ── 三轮降级（字符预算，增量计数避免 O(n²) 重估）──
  let degradationRound: 0 | 1 | 2 | 3 = 0;
  let currentChars = estimateTotalChars(nodes, kept);

  if (currentChars > budget) {
    degradationRound = 1;
    // 轮 1：子树折叠——最深的"子树无交互节点"的容器优先，标 collapsed 保留下钻 ref
    const hasInteractive = markSubtreeInteractive(nodes);
    const candidates = nodes
      .map((node, index) => ({ node, index }))
      .filter(({ index }) =>
        index !== 0
        && kept.has(index)
        && !hasInteractive[index]
        && (childrenOf.get(index)?.some((child) => kept.has(child)) ?? false))
      .sort((a, b) => b.node.depth - a.node.depth);
    for (const { node, index } of candidates) {
      if (currentChars <= budget) break;
      // 折叠收益 = 被摘除后代的字符和 - 折叠标记自身的常量开销（collapsed 字段计入 48B 均摊）
      let removedChars = 0;
      const stack = [...(childrenOf.get(index) ?? [])];
      const dropping: number[] = [];
      while (stack.length > 0) {
        const child = stack.pop() as number;
        if (!kept.has(child)) continue;
        dropping.push(child);
        removedChars += estimateNodeChars(nodes[child]);
        for (const grandchild of childrenOf.get(child) ?? []) stack.push(grandchild);
      }
      for (const child of dropping) kept.delete(child);
      currentChars -= removedChars;
      nodes[index] = { ...node, collapsed: true };
    }
  }

  if (currentChars > budget) {
    degradationRound = 2;
    // 轮 2：尾部弹出——从文档序末尾逐节点摘除（保根）
    for (let index = nodes.length - 1; index >= 1 && currentChars > budget; index -= 1) {
      if (!kept.delete(index)) continue;
      currentChars -= estimateNodeChars(nodes[index]);
    }
  }

  if (currentChars > budget) {
    degradationRound = 3;
    // 轮 3：name/value/description 长度减半（循环直到达标或降到下限 8 字符）
    let floorHit = false;
    while (currentChars > budget && !floorHit) {
      floorHit = true;
      for (const index of kept) {
        const node = nodes[index];
        const halve = (value: string | undefined): string | undefined =>
          value !== undefined && value.length > 8 ? value.slice(0, Math.ceil(value.length / 2)) : value;
        const nextName = halve(node.name) ?? node.name;
        const nextValue = halve(node.value);
        const nextDescription = halve(node.description);
        const saved =
          (node.name.length - nextName.length)
          + ((node.value?.length ?? 0) - (nextValue?.length ?? 0))
          + ((node.description?.length ?? 0) - (nextDescription?.length ?? 0));
        if (saved > 0) {
          floorHit = false;
          currentChars -= saved;
          nodes[index] = { ...node, name: nextName, value: nextValue, description: nextDescription };
        }
      }
    }
  }

  const truncated = degradationRound > 0;

  // ── ref 颁发（只对交互 role + 被折叠节点发 @eN）──
  const refTable = new RefTable(generation);
  for (const index of kept) {
    const node = nodes[index];
    if (!node.interactive && !node.collapsed) continue;
    if (node.backendNodeId === undefined) continue;
    const ref = refTable.assign(node.backendNodeId, { role: node.role, name: node.name });
    nodes[index] = { ...nodes[index], ref };
  }
  // parentRef：父链上最近一个持 ref 的祖先
  for (const index of kept) {
    const node = nodes[index];
    if (!node.ref) continue;
    let cursor = node.parentIndex;
    while (cursor >= 0) {
      const ancestor = nodes[cursor];
      if (kept.has(cursor) && ancestor.ref) {
        nodes[index] = { ...nodes[index], parentRef: ancestor.ref };
        break;
      }
      cursor = ancestor.parentIndex;
    }
  }

  // ── bbox：DOM.getContentQuads 按 backendNodeId 批量补齐（失败跳过，字段 optional）──
  const quadTargets = Array.from(kept).filter((index) => {
    const node = nodes[index];
    return node.ref !== undefined && node.backendNodeId !== undefined;
  });
  for (let offset = 0; offset < quadTargets.length; offset += BROWSER_AUTOMATION_AX_QUADS_BATCH) {
    const batch = quadTargets.slice(offset, offset + BROWSER_AUTOMATION_AX_QUADS_BATCH);
    const results = await Promise.allSettled(
      batch.map((index) =>
        cdp.send<{ quads?: number[][] }>('DOM.getContentQuads', {
          backendNodeId: nodes[index].backendNodeId,
        })),
    );
    results.forEach((result, batchIndex) => {
      if (result.status !== 'fulfilled') return; // describeNode/quads 失败的节点跳过 bbox
      const index = batch[batchIndex];
      const quads = result.value?.quads;
      if (!Array.isArray(quads) || quads.length === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const quad of quads) {
        if (!Array.isArray(quad) || quad.length < 8) continue;
        for (let p = 0; p < 8; p += 2) {
          minX = Math.min(minX, quad[p]);
          maxX = Math.max(maxX, quad[p]);
          minY = Math.min(minY, quad[p + 1]);
          maxY = Math.max(maxY, quad[p + 1]);
        }
      }
      if (minX === Infinity) return;
      nodes[index] = {
        ...nodes[index],
        boundingBox: {
          x: Math.round(minX),
          y: Math.round(minY),
          width: Math.round(maxX - minX),
          height: Math.round(maxY - minY),
        },
      };
    });
  }

  // ── 元素投影（只有持 ref 的节点进入观察面）──
  const elements: BrowserAutomationElementRef[] = [];
  for (const index of Array.from(kept).sort((a, b) => a - b)) {
    const node = nodes[index];
    if (!node.ref) continue;
    const role = node.role.toLowerCase();
    elements.push({
      ref: node.ref,
      stableKey: refTable.resolveStableKey(node.ref) ?? `ax-${node.backendNodeId ?? node.nodeId}`,
      role: node.role,
      name: node.name,
      tag: '',
      selector: '',
      clickable: AX_CLICKABLE_ROLES.has(role),
      editable: AX_EDITABLE_ROLES.has(role),
      value: node.value,
      states: node.states,
      boundingBox: node.boundingBox,
      backendNodeId: node.backendNodeId,
      parentRef: node.parentRef,
      hasCollapsedSubtree: node.collapsed || undefined,
    });
  }

  // 快照落 kept 子集：parentIndex 重建为子集内下标（最近的 kept 祖先为父；无则 -1 视根）
  const keptOrder = Array.from(kept).sort((a, b) => a - b);
  const keptIndexOf = new Map<number, number>();
  keptOrder.forEach((oldIndex, newIndex) => keptIndexOf.set(oldIndex, newIndex));
  const keptNodes = keptOrder.map((oldIndex) => {
    const node = nodes[oldIndex];
    let cursor = node.parentIndex;
    let parentIndex = -1;
    while (cursor >= 0) {
      const mapped = keptIndexOf.get(cursor);
      if (mapped !== undefined) {
        parentIndex = mapped;
        break;
      }
      cursor = nodes[cursor].parentIndex;
    }
    return { ...node, parentIndex };
  });

  return {
    elements,
    refTable,
    snapshot: {
      generation,
      nodes: keptNodes,
      refTable,
      truncated,
      degradationRound,
      rawNodeCount,
    },
    truncated,
    degradationRound,
    rawNodeCount,
  };
}

/**
 * find 的树内检索（B4.find 的 AX 路径）：
 * - text 命中静态（无 ref）节点时沿父链上溯最近可交互节点，填 interactiveAncestorRef；
 * - 无 ref 命中的 ref 字段回退为 interactiveAncestorRef（保证 FindMatch.ref 契约非空，偏差已记录）；
 * - path 为祖先链（根 → 父，≤6 层）。
 */
export function searchAxSnapshot(
  snapshot: AxSnapshot,
  query: BrowserAutomationFindQuery,
): BrowserAutomationFindMatch[] {
  const text = query.text?.trim().toLowerCase();
  const role = query.role?.trim().toLowerCase();
  const name = query.name?.trim().toLowerCase();
  const interactiveOnly = query.interactiveOnly ?? true;

  // snapshot.nodes 的 parentIndex 已在 captureAxTree 内重建为子集内下标，可直接沿父链行走
  const nodeByIndex = snapshot.nodes;
  const ancestorPath = (node: AxTreeNode): Array<{ ref?: string; role: string; name: string }> => {
    const path: Array<{ ref?: string; role: string; name: string }> = [];
    let cursor = node.parentIndex;
    while (cursor >= 0 && path.length < 6) {
      const ancestor = nodeByIndex[cursor];
      if (!ancestor) break;
      path.unshift({ ref: ancestor.ref, role: ancestor.role, name: ancestor.name });
      cursor = ancestor.parentIndex;
    }
    return path;
  };

  const nearestInteractiveAncestor = (node: AxTreeNode): AxTreeNode | undefined => {
    let cursor = node.parentIndex;
    while (cursor >= 0) {
      const ancestor = nodeByIndex[cursor];
      if (!ancestor) break;
      if (ancestor.interactive && ancestor.ref) return ancestor;
      cursor = ancestor.parentIndex;
    }
    return undefined;
  };

  const matches: BrowserAutomationFindMatch[] = [];
  nodeByIndex.forEach((node, index) => {
    if (index === 0) return; // 根不参与命中
    const haystack = `${node.name}\n${node.value ?? ''}`.toLowerCase();
    const textHit = text !== undefined && text.length > 0 && haystack.includes(text);
    if (text !== undefined && text.length > 0 && !textHit) return;
    if (role !== undefined && role.length > 0 && node.role.toLowerCase() !== role) return;
    if (name !== undefined && name.length > 0 && !node.name.toLowerCase().includes(name)) return;
    if (text === undefined && role === undefined && name === undefined) return;
    // interactiveOnly 约束直接命中面；text 检索放行静态节点（经 interactiveAncestorRef 上溯）
    if (interactiveOnly && !node.interactive && !textHit) return;

    const ancestor = node.interactive ? undefined : nearestInteractiveAncestor(node);
    const ref = node.ref ?? ancestor?.ref;
    if (!ref) return; // 无 ref 且上溯失败（如孤立静态文本），不可操作，略过
    matches.push({
      ref,
      stableKey: node.ref
        ? snapshot.refTable.resolveStableKey(node.ref) ?? `ax-${node.backendNodeId ?? node.nodeId}`
        : `ax-${node.backendNodeId ?? node.nodeId}`,
      role: node.role,
      name: node.name,
      interactiveAncestorRef: ancestor?.ref,
      path: ancestorPath(node),
      boundingBox: node.boundingBox ?? ancestor?.boundingBox,
    });
  });
  return matches;
}
