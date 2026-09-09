/**
 * A2UI 选中节点：样式白名单 + 数据（字面量 / path / format 拼接），接口只选 actionId。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { readAppSourceFile, writeAppSourceFile } from '@/lib/app-dev-api';
import type { AppDevPickedElement } from '@/lib/app-dev-element-intent';
import {
  a2uiPageJsonPath,
  composeA2uiFormattedValue,
  findA2uiComponent,
  isA2uiPathBinding,
  patchA2uiComponentProps,
  patchA2uiDataModelPath,
  readA2uiDataModelValue,
  type A2uiMessage,
} from '@/lib/app-dev-a2ui-page';
import {
  findBuilderComponentMeta,
  parseComponentBuilderContract,
  type BuilderComponentMeta,
  type BuilderDataField,
  type BuilderStyleField,
} from '@/lib/app-dev-component-builder';

interface AppDevA2uiBindPanelProps {
  workspaceId: string;
  element: AppDevPickedElement;
  onPersisted?: () => void;
}

interface FieldDraft {
  mode: 'literal' | 'path';
  value: string;
  modelValue: string;
  prefix: string;
  suffix: string;
  precision: string;
}

function emptyDraft(): FieldDraft {
  return { mode: 'literal', value: '', modelValue: '', prefix: '', suffix: '', precision: '' };
}

function coerceFieldValue(field: BuilderDataField, raw: string): unknown {
  if (field.type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (field.type === 'boolean') return raw === 'true';
  if (field.type === 'list') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : raw;
    } catch {
      return raw;
    }
  }
  return raw;
}

export function AppDevA2uiBindPanel({
  workspaceId,
  element,
  onPersisted,
}: AppDevA2uiBindPanelProps) {
  const [meta, setMeta] = useState<BuilderComponentMeta | null>(null);
  const [messages, setMessages] = useState<A2uiMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({});
  const [styles, setStyles] = useState<Record<string, string>>({});
  const [actionId, setActionId] = useState('');
  const [actions, setActions] = useState<Array<{ actionId: string; title?: string }>>([]);

  const pageId = element.a2uiPageId ?? '';
  const componentId = element.a2uiComponentId ?? '';

  const load = useCallback(async () => {
    setError(null);
    try {
      const [pageFile, builderFile, registryFile] = await Promise.all([
        readAppSourceFile(workspaceId, a2uiPageJsonPath(pageId)),
        readAppSourceFile(workspaceId, 'contracts/component-builder.v1.json').catch(() => null),
        readAppSourceFile(workspaceId, 'contracts/action-registry.v1.json').catch(() => null),
      ]);
      const parsed = JSON.parse(pageFile.content) as A2uiMessage[];
      setMessages(parsed);
      const contract = builderFile ? parseComponentBuilderContract(JSON.parse(builderFile.content)) : null;
      const node = findA2uiComponent(parsed, componentId);
      const found = findBuilderComponentMeta(contract, element.a2uiComponent || node?.component);
      setMeta(found);
      const nextDrafts: Record<string, FieldDraft> = {};
      const nextStyles: Record<string, string> = {};
      if (node && found) {
        for (const field of found.styleFields) {
          const raw = node[field.key];
          nextStyles[field.key] = raw == null ? '' : String(raw);
        }
        for (const field of found.dataFields) {
          const raw = node[field.key];
          if (isA2uiPathBinding(raw)) {
            const model = readA2uiDataModelValue(parsed, raw.path);
            nextDrafts[field.key] = {
              ...emptyDraft(),
              mode: 'path',
              value: raw.path,
              modelValue: model == null ? '' : typeof model === 'string' ? model : JSON.stringify(model),
            };
          } else {
            nextDrafts[field.key] = {
              ...emptyDraft(),
              mode: 'literal',
              value: raw == null ? '' : typeof raw === 'string' ? raw : JSON.stringify(raw),
            };
          }
        }
      }
      setDrafts(nextDrafts);
      setStyles(nextStyles);
      if (registryFile) {
        const registry = JSON.parse(registryFile.content) as { actions?: Array<{ actionId: string; title?: string }> };
        setActions((registry.actions ?? []).filter((item) => item.actionId !== 'app.navigate'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [componentId, element.a2uiComponent, pageId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const node = useMemo(
    () => (messages ? findA2uiComponent(messages, componentId) : null),
    [componentId, messages],
  );

  const dedicatedFormatKeys = useMemo(() => {
    const keys = new Set((meta?.dataFields ?? []).map((field) => field.key));
    return {
      prefix: keys.has('prefix'),
      suffix: keys.has('suffix'),
    };
  }, [meta]);

  const handleSave = async () => {
    if (!messages || !node || !meta) return;
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      let next = messages;
      const stylePatch: Record<string, unknown> = {};
      for (const field of meta.styleFields) {
        const raw = styles[field.key];
        if (field.type === 'boolean') stylePatch[field.key] = raw === 'true';
        else if (raw !== undefined) stylePatch[field.key] = raw;
      }
      if (Object.keys(stylePatch).length > 0) {
        next = patchA2uiComponentProps(next, componentId, stylePatch);
      }
      for (const field of meta.dataFields) {
        const draft = drafts[field.key];
        if (!draft) continue;
        if (draft.mode === 'path') {
          const path = draft.value.startsWith('/') ? draft.value : `/${draft.value}`;
          next = patchA2uiComponentProps(next, componentId, { [field.key]: { path } });
          if (draft.modelValue !== '') {
            const precision = draft.precision === '' ? undefined : Number(draft.precision);
            const composed = dedicatedFormatKeys.prefix || dedicatedFormatKeys.suffix
              ? composeA2uiFormattedValue(draft.modelValue, {
                precision: Number.isFinite(precision) ? precision : undefined,
              })
              : composeA2uiFormattedValue(draft.modelValue, {
                prefix: draft.prefix,
                suffix: draft.suffix,
                precision: Number.isFinite(precision) ? precision : undefined,
              });
            next = patchA2uiDataModelPath(next, path, coerceFieldValue(field, composed));
          }
        } else {
          const precision = draft.precision === '' ? undefined : Number(draft.precision);
          const composed = dedicatedFormatKeys.prefix || dedicatedFormatKeys.suffix
            ? composeA2uiFormattedValue(draft.value, {
              precision: Number.isFinite(precision) ? precision : undefined,
            })
            : composeA2uiFormattedValue(draft.value, {
              prefix: draft.prefix,
              suffix: draft.suffix,
              precision: Number.isFinite(precision) ? precision : undefined,
            });
          next = patchA2uiComponentProps(next, componentId, {
            [field.key]: coerceFieldValue(field, composed),
          });
        }
      }
      if (actionId && meta.actions[0]) {
        const key = meta.actions[0].key;
        next = patchA2uiComponentProps(next, componentId, {
          [key]: { event: { name: actionId, context: {} } },
        });
      }
      await writeAppSourceFile(
        workspaceId,
        a2uiPageJsonPath(pageId),
        `${JSON.stringify(next, null, 2)}\n`,
      );
      setMessages(next);
      setHint(`已写入 ${a2uiPageJsonPath(pageId)}`);
      onPersisted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return <p className="text-xs text-[var(--sto-danger-primary,#FA3C3C)]">{error}</p>;
  }
  if (!meta) {
    return (
      <p className="text-[11px] text-muted-foreground" data-testid="app-dev-a2ui-bind-missing">
        该组件没有搭建规范，只能改外观，或改用对话修改。
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="app-dev-a2ui-bind-panel">
      <section className="space-y-3">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">样式</h3>
        {meta.styleFields.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">此组件没有样式白名单，请用上方外观或对话修改。</p>
        ) : (
          meta.styleFields.map((field) => (
            <StyleFieldEditor
              key={field.key}
              field={field}
              value={styles[field.key] ?? ''}
              onChange={(value) => setStyles((prev) => ({ ...prev, [field.key]: value }))}
            />
          ))
        )}
      </section>
      <section className="space-y-3">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">数据</h3>
        {meta.dataFields.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">此组件没有可绑定数据字段。</p>
        ) : (
          meta.dataFields.map((field) => (
            <DataFieldEditor
              key={field.key}
              field={field}
              draft={drafts[field.key] ?? emptyDraft()}
              hideCompose={dedicatedFormatKeys.prefix || dedicatedFormatKeys.suffix}
              onChange={(next) => setDrafts((prev) => ({ ...prev, [field.key]: next }))}
            />
          ))
        )}
        {meta.actions.length > 0 ? (
          <label className="block space-y-1.5">
            <span className="text-xs text-[var(--sto-text-secondary)]">接口（actionId）</span>
            <select
              className="sto-control-field h-8 w-full rounded-md px-2 text-xs"
              value={actionId}
              onChange={(e) => setActionId(e.target.value)}
            >
              <option value="">保持现状</option>
              {actions.map((item) => (
                <option key={item.actionId} value={item.actionId}>
                  {item.title || item.actionId}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>
      <div className="flex items-center gap-2">
        <p className="flex-1 truncate text-[11px] text-muted-foreground">{hint}</p>
        <Button type="button" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void handleSave()}>
          写入页面 JSON
        </Button>
      </div>
    </div>
  );
}

function StyleFieldEditor({
  field,
  value,
  onChange,
}: {
  field: BuilderStyleField;
  value: string;
  onChange: (next: string) => void;
}) {
  if (field.type === 'boolean') {
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--sto-text-secondary)]">{field.label}</span>
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
      </label>
    );
  }
  if (field.type === 'enum') {
    return (
      <label className="block space-y-1.5">
        <span className="text-xs text-[var(--sto-text-secondary)]">{field.label}</span>
        <select
          className="sto-control-field h-8 w-full rounded-md px-2 text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-[var(--sto-text-secondary)]">{field.label}</span>
      <input
        className="sto-control-field h-8 w-full rounded-md px-2 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function DataFieldEditor({
  field,
  draft,
  hideCompose,
  onChange,
}: {
  field: BuilderDataField;
  draft: FieldDraft;
  hideCompose: boolean;
  onChange: (next: FieldDraft) => void;
}) {
  const showCompose = !hideCompose && (field.format.includes('prefix') || field.format.includes('suffix'));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--sto-text-secondary)]">{field.label}</span>
        {field.bindable ? (
          <select
            className="h-6 rounded-md border border-border bg-background px-1 text-[10px]"
            value={draft.mode}
            onChange={(e) => onChange({ ...draft, mode: e.target.value as FieldDraft['mode'] })}
            aria-label={`${field.label}绑定方式`}
          >
            <option value="literal">字面量</option>
            <option value="path">绑定 path</option>
          </select>
        ) : (
          <span className="text-[10px] text-muted-foreground">字面量</span>
        )}
      </div>
      <input
        className="sto-control-field h-8 w-full rounded-md px-2 text-xs"
        value={draft.value}
        onChange={(e) => onChange({ ...draft, value: e.target.value })}
        placeholder={draft.mode === 'path' ? '/path' : field.label}
      />
      {draft.mode === 'path' ? (
        <input
          className="sto-control-field h-8 w-full rounded-md px-2 text-xs"
          value={draft.modelValue}
          onChange={(e) => onChange({ ...draft, modelValue: e.target.value })}
          placeholder="当前数据值（可选）"
        />
      ) : null}
      {showCompose ? (
        <div className="grid grid-cols-2 gap-2">
          {field.format.includes('prefix') ? (
            <input
              className="sto-control-field h-8 rounded-md px-2 text-xs"
              placeholder="前缀"
              value={draft.prefix}
              onChange={(e) => onChange({ ...draft, prefix: e.target.value })}
            />
          ) : null}
          {field.format.includes('suffix') ? (
            <input
              className="sto-control-field h-8 rounded-md px-2 text-xs"
              placeholder="后缀，如单位"
              value={draft.suffix}
              onChange={(e) => onChange({ ...draft, suffix: e.target.value })}
            />
          ) : null}
        </div>
      ) : null}
      {field.format.includes('precision') ? (
        <input
          className="sto-control-field h-8 w-full rounded-md px-2 text-xs"
          placeholder="小数位"
          value={draft.precision}
          onChange={(e) => onChange({ ...draft, precision: e.target.value })}
        />
      ) : null}
    </div>
  );
}
