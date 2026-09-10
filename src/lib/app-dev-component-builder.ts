/**
 * Catalog 搭建规范：宿主检查器读取 contracts/component-builder.v1.json。
 */
import type { A2uiModuleFragment } from '@/lib/app-dev-a2ui-page';

export interface BuilderStyleField {
  key: string;
  label: string;
  type: 'boolean' | 'enum' | 'string';
  options?: string[];
}

export interface BuilderDataField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'list';
  bindable: boolean;
  format: Array<'prefix' | 'suffix' | 'precision'>;
}

export interface BuilderActionField {
  key: string;
  label: string;
}

export interface BuilderComponentMeta {
  id: string;
  nameZh: string;
  category: string;
  styleFields: BuilderStyleField[];
  dataFields: BuilderDataField[];
  slots: string[];
  actions: BuilderActionField[];
  parentHint?: string;
}

export interface ComponentBuilderContract {
  version: string;
  components: BuilderComponentMeta[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseComponentBuilderContract(raw: unknown): ComponentBuilderContract | null {
  if (!isRecord(raw) || !Array.isArray(raw.components)) return null;
  const components: BuilderComponentMeta[] = [];
  for (const item of raw.components) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.nameZh !== 'string') continue;
    components.push({
      id: item.id,
      nameZh: item.nameZh,
      category: typeof item.category === 'string' ? item.category : 'other',
      styleFields: Array.isArray(item.styleFields) ? item.styleFields.filter(isStyleField) : [],
      dataFields: Array.isArray(item.dataFields) ? item.dataFields.flatMap(normalizeDataField) : [],
      slots: Array.isArray(item.slots) ? item.slots.filter((x): x is string => typeof x === 'string') : [],
      actions: Array.isArray(item.actions)
        ? item.actions.flatMap((action) => {
          if (!isRecord(action) || typeof action.key !== 'string' || typeof action.label !== 'string') return [];
          return [{ key: action.key, label: action.label }];
        })
        : [],
      parentHint: typeof item.parentHint === 'string' ? item.parentHint : undefined,
    });
  }
  if (components.length === 0) return null;
  return {
    version: typeof raw.version === 'string' ? raw.version : 'v1',
    components,
  };
}

function isStyleField(value: unknown): value is BuilderStyleField {
  if (!isRecord(value) || typeof value.key !== 'string' || typeof value.label !== 'string') return false;
  return value.type === 'boolean' || value.type === 'enum' || value.type === 'string';
}

function normalizeDataField(value: unknown): BuilderDataField[] {
  if (!isRecord(value) || typeof value.key !== 'string' || typeof value.label !== 'string') return [];
  if (value.type !== 'string' && value.type !== 'number' && value.type !== 'boolean' && value.type !== 'list') return [];
  const format = Array.isArray(value.format)
    ? value.format.filter((item): item is BuilderDataField['format'][number] => (
      item === 'prefix' || item === 'suffix' || item === 'precision'
    ))
    : [];
  return [{
    key: value.key,
    label: value.label,
    type: value.type,
    bindable: value.bindable !== false,
    format,
  }];
}

export function findBuilderComponentMeta(
  contract: ComponentBuilderContract | null,
  componentName: string | undefined,
): BuilderComponentMeta | null {
  if (!contract || !componentName) return null;
  return contract.components.find((item) => item.id === componentName) ?? null;
}

export function defaultInsertProps(meta: BuilderComponentMeta): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const field of meta.styleFields) {
    if (field.type === 'boolean') props[field.key] = false;
    else if (field.type === 'enum' && field.options?.[0]) props[field.key] = field.options[0];
  }
  for (const field of meta.dataFields) {
    if (field.type === 'list') props[field.key] = [];
    else if (field.type === 'number') props[field.key] = 0;
    else if (field.type === 'boolean') props[field.key] = false;
    else props[field.key] = field.label;
  }
  if (meta.slots.includes('children')) props.children = [];
  return props;
}

/** 画廊里的 Catalog 单项：插入仍是 A2UI JSON 片段，不另造编辑器格式。 */
export function builderMetaToModuleFragment(meta: BuilderComponentMeta): A2uiModuleFragment {
  return {
    id: `catalog-${meta.id}`,
    name: meta.nameZh,
    catalogId: 'antd',
    parentHint: meta.parentHint || 'AntdStack',
    components: [{
      id: '{{id}}',
      component: meta.id,
      ...defaultInsertProps(meta),
    }],
  };
}
