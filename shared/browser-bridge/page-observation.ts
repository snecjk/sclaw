/**
 * 统一页面观测契约（A2）：embed / Chrome 扩展 / BA 都把结果收成同一份扁平 elements。
 *
 * 给模型看的只有可交互节点：ref、role、name、clickable、editable、optional boundingBox。
 * 禁止嵌套 tree、原始 CDP AX 节点、pretty-print。超预算时裁剪尾部，永不因截断返回空列表。
 */
import type { BrowserAutomationBoundingBox } from '../browser-automation/types';
import {
  PERCEPTION_CHAR_BUDGET,
  PERCEPTION_TRUNCATED_HINT,
  type PerceptionDegradationRound,
} from './perception-budget';

export type PageObservationMode = 'ax' | 'dom';

export type AxEditableKind = 'richtext' | 'plaintext' | 'true';

/** STALE_REF / ELEMENT_NOT_FOUND 失败体的 actionHint：观测已附在本次返回里。 */
export const STALE_REF_RETRY_HINT = '用本次返回 observation.elements 里的新 @e 直接重试';

export interface PageObservationElement {
  ref: string;
  role: string;
  name?: string;
  clickable?: boolean;
  editable?: boolean;
  editableKind?: AxEditableKind;
  boundingBox?: BrowserAutomationBoundingBox;
}

export interface PageObservation {
  url: string;
  title: string;
  timestamp: number;
  elements: PageObservationElement[];
  documentGeneration: number;
  observationMode: PageObservationMode;
  truncated?: boolean;
  degradationRound?: PerceptionDegradationRound;
  actionHint?: string;
  fallbackFrom?: 'ax';
  unsupported?: string;
}

export interface DomSnapshotNode {
  ref?: string;
  role: string;
  name?: string;
  clickable?: boolean;
  editable?: boolean;
  boundingBox?: BrowserAutomationBoundingBox;
  children?: DomSnapshotNode[];
}

export interface RawAxObservationNode {
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  backendDOMNodeId?: number;
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
}

/** 与 BA AX 白名单对齐；扩展 background.js 必须手抄同一组 role。 */
export const OBSERVATION_INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
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

export const OBSERVATION_CLICKABLE_ROLES: ReadonlySet<string> = new Set([
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

export const OBSERVATION_EDITABLE_ROLES: ReadonlySet<string> = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'slider',
  'spinbutton',
]);

function axSlotString(slot: { value?: unknown } | undefined): string {
  return typeof slot?.value === 'string' ? slot.value : '';
}

export function axEditableKindFromValue(value: unknown): AxEditableKind | undefined {
  if (value === true || value === 'true') return 'true';
  if (value === 'richtext' || value === 'plaintext') return value;
  return undefined;
}

export function axEditableKindFromProperties(
  properties?: Array<{ name: string; value?: { value?: unknown } }>,
): AxEditableKind | undefined {
  for (const prop of properties ?? []) {
    if (prop.name !== 'editable') continue;
    const kind = axEditableKindFromValue(prop.value?.value);
    if (kind) return kind;
  }
  return undefined;
}

export function compactObservationElement(el: {
  ref: string;
  role: string;
  name?: string;
  clickable?: boolean;
  editable?: boolean;
  editableKind?: AxEditableKind;
  boundingBox?: BrowserAutomationBoundingBox;
}): PageObservationElement {
  const out: PageObservationElement = { ref: el.ref, role: el.role };
  if (el.name) out.name = el.name;
  if (el.clickable) out.clickable = true;
  if (el.editable) out.editable = true;
  if (el.editableKind) out.editableKind = el.editableKind;
  if (el.boundingBox) out.boundingBox = el.boundingBox;
  return out;
}

export function toPageObservation(input: {
  url: string;
  title: string;
  documentGeneration: number;
  observationMode: PageObservationMode;
  elements: Array<{
    ref: string;
    role: string;
    name?: string;
    clickable?: boolean;
    editable?: boolean;
    editableKind?: AxEditableKind;
    boundingBox?: BrowserAutomationBoundingBox;
  }>;
  timestamp?: number;
  truncated?: boolean;
  degradationRound?: PerceptionDegradationRound;
  actionHint?: string;
  fallbackFrom?: 'ax';
  unsupported?: string;
}): PageObservation {
  const observation: PageObservation = {
    url: input.url,
    title: input.title,
    timestamp: input.timestamp ?? Date.now(),
    elements: input.elements.map(compactObservationElement),
    documentGeneration: input.documentGeneration,
    observationMode: input.observationMode,
  };
  if (input.truncated) {
    observation.truncated = true;
    observation.actionHint = input.actionHint ?? PERCEPTION_TRUNCATED_HINT;
  } else if (input.actionHint) {
    observation.actionHint = input.actionHint;
  }
  if (input.degradationRound && input.degradationRound > 0) {
    observation.degradationRound = input.degradationRound;
  }
  if (input.fallbackFrom) observation.fallbackFrom = input.fallbackFrom;
  if (input.unsupported) observation.unsupported = input.unsupported;
  return observation;
}

/**
 * 把 embed 注入脚本的嵌套 tree 收成可交互扁平列表。
 * 若页面上没有任何 clickable/editable 节点，保留带 ref 的自命名节点，避免截断后变空。
 */
export function flattenDomSnapshotToElements(nodes: DomSnapshotNode[]): PageObservationElement[] {
  const interactive: PageObservationElement[] = [];
  const named: PageObservationElement[] = [];

  const walk = (list: DomSnapshotNode[]): void => {
    for (const node of list) {
      if (node.ref) {
        const compact = compactObservationElement({
          ref: node.ref,
          role: node.role,
          name: node.name,
          clickable: node.clickable,
          editable: node.editable,
          boundingBox: node.boundingBox,
        });
        if (node.clickable || node.editable) interactive.push(compact);
        else named.push(compact);
      }
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return interactive.length > 0 ? interactive : named;
}

/**
 * 把 CDP Accessibility.getFullAXTree 的原始节点收成可交互扁平列表。
 * 扩展 background.js 必须按同一规则分配 @eN，且不得在 Electron 侧重编号。
 */
export function flattenRawAxNodes(
  rawNodes: RawAxObservationNode[],
  limit: number,
): {
  elements: PageObservationElement[];
  truncated: boolean;
  refToBackendNodeId: Map<string, number>;
} {
  const elements: PageObservationElement[] = [];
  const refToBackendNodeId = new Map<string, number>();
  let truncated = false;

  for (const node of rawNodes) {
    if (node.ignored) continue;
    const role = axSlotString(node.role).toLowerCase();
    const editableKind = axEditableKindFromProperties(node.properties);
    if (!OBSERVATION_INTERACTIVE_ROLES.has(role) && !editableKind) continue;
    if (elements.length >= limit) {
      truncated = true;
      break;
    }
    const ref = `@e${elements.length + 1}`;
    const name = axSlotString(node.name);
    const clickable = OBSERVATION_CLICKABLE_ROLES.has(role);
    const editable = OBSERVATION_EDITABLE_ROLES.has(role) || Boolean(editableKind);
    if (typeof node.backendDOMNodeId === 'number') {
      refToBackendNodeId.set(ref, node.backendDOMNodeId);
    }
    elements.push(compactObservationElement({
      ref,
      role,
      name: name || undefined,
      clickable,
      editable,
      editableKind,
    }));
  }

  return { elements, truncated, refToBackendNodeId };
}

function encodedSize(observation: PageObservation, elements: PageObservationElement[], truncated: boolean): number {
  return JSON.stringify({
    ...observation,
    elements,
    truncated: truncated || undefined,
    actionHint: truncated ? (observation.actionHint ?? PERCEPTION_TRUNCATED_HINT) : observation.actionHint,
  }).length;
}

/**
 * 字符预算裁剪：先丢掉 boundingBox，再从尾部丢元素，必要时缩短 name。
 * 有元素时至少保留 1 条；truncated 必须自述。
 */
export function applyObservationCharBudget(
  observation: PageObservation,
  budget = PERCEPTION_CHAR_BUDGET,
): PageObservation {
  if (encodedSize(observation, observation.elements, observation.truncated === true) <= budget) {
    return observation;
  }

  let elements = observation.elements.map((el) => (
    el.boundingBox
      ? compactObservationElement({ ...el, boundingBox: undefined })
      : el
  ));

  while (elements.length > 1 && encodedSize(observation, elements, true) > budget) {
    elements = elements.slice(0, -1);
  }

  if (elements.length === 1) {
    let name = elements[0].name ?? '';
    while (encodedSize(observation, elements, true) > budget && name.length > 8) {
      name = name.slice(0, Math.floor(name.length / 2));
      elements = [{ ...elements[0], name }];
    }
  }

  return {
    ...observation,
    elements,
    truncated: true,
    actionHint: observation.actionHint ?? PERCEPTION_TRUNCATED_HINT,
  };
}
