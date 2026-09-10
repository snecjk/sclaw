/**
 * A2UI page.json 结构化 patch：组件字面量、data model、插槽插入。
 * 宿主手动微调写入仓库文件，不引入第二套编辑器 JSON。
 */

export type A2uiMessage = Record<string, unknown>;

export interface A2uiComponentNode extends Record<string, unknown> {
  id: string;
  component: string;
  children?: string[];
}

export interface A2uiModuleFragment {
  id: string;
  name: string;
  catalogId: string;
  components: A2uiComponentNode[];
  dataDefaults?: Record<string, unknown>;
  parentHint?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function listA2uiComponents(messages: A2uiMessage[]): A2uiComponentNode[] {
  const out: A2uiComponentNode[] = [];
  for (const message of messages) {
    const update = message.updateComponents;
    if (!isRecord(update) || !Array.isArray(update.components)) continue;
    for (const item of update.components) {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.component !== 'string') continue;
      out.push(item as A2uiComponentNode);
    }
  }
  return out;
}

export function findA2uiComponent(
  messages: A2uiMessage[],
  componentId: string,
): A2uiComponentNode | null {
  return listA2uiComponents(messages).find((item) => item.id === componentId) ?? null;
}

export function isA2uiPathBinding(value: unknown): value is { path: string } {
  return isRecord(value) && typeof value.path === 'string' && value.path.startsWith('/');
}

export function patchA2uiComponentProps(
  messages: A2uiMessage[],
  componentId: string,
  props: Record<string, unknown>,
): A2uiMessage[] {
  return messages.map((message) => {
    const update = message.updateComponents;
    if (!isRecord(update) || !Array.isArray(update.components)) return message;
    const components = update.components.map((item) => {
      if (!isRecord(item) || item.id !== componentId) return item;
      return { ...item, ...props };
    });
    return { ...message, updateComponents: { ...update, components } };
  });
}

function setPathValue(root: unknown, path: string, value: unknown): unknown {
  const parts = path.replace(/^\//, '').split('/').filter(Boolean);
  if (parts.length === 0) return value;
  const clone = isRecord(root) ? { ...root } : {};
  let cursor: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!;
    const next = cursor[key];
    cursor[key] = isRecord(next) ? { ...next } : {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
  return clone;
}

export function patchA2uiDataModelPath(
  messages: A2uiMessage[],
  path: string,
  value: unknown,
): A2uiMessage[] {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return messages.map((message) => {
    const update = message.updateDataModel;
    if (!isRecord(update)) return message;
    const currentPath = typeof update.path === 'string' ? update.path : '/';
    if (currentPath === '/' || currentPath === '') {
      return {
        ...message,
        updateDataModel: {
          ...update,
          value: setPathValue(update.value, normalized, value),
        },
      };
    }
    if (currentPath === normalized) {
      return { ...message, updateDataModel: { ...update, value } };
    }
    return message;
  });
}

export function uniqueA2uiId(existing: Iterable<string>, base: string): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function remapModuleIds(
  fragment: A2uiModuleFragment,
  existingIds: Set<string>,
): { components: A2uiComponentNode[]; rootId: string } {
  const idMap = new Map<string, string>();
  for (const node of fragment.components) {
    idMap.set(node.id, uniqueA2uiId(existingIds, node.id === '{{id}}' ? fragment.id : node.id));
    existingIds.add(idMap.get(node.id)!);
  }
  const components = fragment.components.map((node) => {
    const nextId = idMap.get(node.id)!;
    const children = Array.isArray(node.children)
      ? node.children.map((child) => idMap.get(child) ?? child)
      : node.children;
    const child = typeof node.child === 'string' ? (idMap.get(node.child) ?? node.child) : node.child;
    return { ...node, id: nextId, ...(children ? { children } : {}), ...(child ? { child } : {}) };
  });
  return { components, rootId: idMap.get(fragment.components[0]!.id)! };
}

function mergeDataDefaults(root: unknown, defaults: Record<string, unknown> | undefined): unknown {
  if (!defaults) return root;
  if (!isRecord(root)) return { ...defaults };
  return { ...root, ...defaults };
}

export function insertA2uiModule(
  messages: A2uiMessage[],
  parentId: string,
  fragment: A2uiModuleFragment,
): A2uiMessage[] {
  if (fragment.components.length === 0) return messages;
  const existing = new Set(listA2uiComponents(messages).map((item) => item.id));
  const { components, rootId } = remapModuleIds(fragment, existing);
  return messages.map((message) => {
    const update = message.updateComponents;
    if (isRecord(update) && Array.isArray(update.components)) {
      const nextComponents = update.components.map((item) => {
        if (!isRecord(item) || item.id !== parentId) return item;
        const children = Array.isArray(item.children) ? [...item.children, rootId] : [rootId];
        return { ...item, children };
      });
      return {
        ...message,
        updateComponents: { ...update, components: [...nextComponents, ...components] },
      };
    }
    const data = message.updateDataModel;
    if (isRecord(data) && (data.path === '/' || data.path === '')) {
      return {
        ...message,
        updateDataModel: {
          ...data,
          value: mergeDataDefaults(data.value, fragment.dataDefaults),
        },
      };
    }
    return message;
  });
}

export function a2uiPageJsonPath(pageId: string): string {
  return `src/pages/${pageId}.page.json`;
}

function getPathValue(root: unknown, path: string): unknown {
  const parts = path.replace(/^\//, '').split('/').filter(Boolean);
  let cursor: unknown = root;
  for (const key of parts) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

export function readA2uiDataModelValue(messages: A2uiMessage[], path: string): unknown {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  for (const message of messages) {
    const update = message.updateDataModel;
    if (!isRecord(update)) continue;
    const currentPath = typeof update.path === 'string' ? update.path : '/';
    if (currentPath === '/' || currentPath === '') {
      return getPathValue(update.value, normalized);
    }
    if (currentPath === normalized) return update.value;
  }
  return undefined;
}

export function composeA2uiFormattedValue(
  value: string,
  opts: { prefix?: string; suffix?: string; precision?: number },
): string {
  let next = value;
  if (
    opts.precision != null
    && Number.isFinite(opts.precision)
    && opts.precision >= 0
    && next.trim() !== ''
    && !Number.isNaN(Number(next))
  ) {
    next = Number(next).toFixed(opts.precision);
  }
  return `${opts.prefix ?? ''}${next}${opts.suffix ?? ''}`;
}

export function setA2uiPropBinding(
  messages: A2uiMessage[],
  componentId: string,
  key: string,
  value: unknown,
): A2uiMessage[] {
  return patchA2uiComponentProps(messages, componentId, { [key]: value });
}

const TEXT_PROP_KEYS = ['text', 'title', 'value'] as const;

/** 把预览里改过的可见文案写回 page.json：字面量改 prop，绑定则改 data model。 */
export function applyA2uiVisibleText(
  messages: A2uiMessage[],
  componentId: string,
  text: string,
): A2uiMessage[] {
  const node = findA2uiComponent(messages, componentId);
  if (!node) return messages;
  for (const key of TEXT_PROP_KEYS) {
    if (!(key in node)) continue;
    const current = node[key];
    if (isA2uiPathBinding(current)) {
      return patchA2uiDataModelPath(messages, current.path, text);
    }
    if (typeof current === 'string') {
      return patchA2uiComponentProps(messages, componentId, { [key]: text });
    }
  }
  return messages;
}
