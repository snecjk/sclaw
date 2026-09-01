/**
 * Startup confirmation for a native designer trial run.
 *
 * The schema and selected default preset come from WorkflowDetailResponse,
 * so no separate startup-schema request is needed for a trial run.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { WorkflowSchema, WorkflowSchemaField } from '@/types/workflow';
import { invokeIpc } from '@/lib/api-client';
import { getAgentEngineDisplayName } from '@/lib/agent-engine-display-name';
import type { RuntimeUploadNode } from '@/pages/WorkflowDesigner/hooks/use-designer-try-run';

interface StartupRunDialogProps {
  open: boolean;
  schema: WorkflowSchema | null | undefined;
  defaultValues?: Record<string, unknown>;
  runtimeUploadNodes?: RuntimeUploadNode[];
  isStarting: boolean;
  onConfirm: (inputs: Record<string, unknown>, engineType: 'claude' | 'openclaw') => void;
  onClose: () => void;
}

type FieldGroup = { id: string; title: string; fields: WorkflowSchemaField[] };

function isLongText(component: string | undefined): boolean {
  return ['textarea', 'text_area', 'long_text', 'long'].includes(component ?? '');
}

function isBoolean(component: string | undefined): boolean {
  return ['checkbox', 'boolean', 'switch'].includes(component ?? '');
}

function groupFields(schema: WorkflowSchema | null | undefined, fields: WorkflowSchemaField[]): FieldGroup[] {
  const sortedFields = [...fields].sort((left, right) => left.order - right.order);
  const claimed = new Set<string>();
  const stepGroups = (schema?.steps ?? []).map((step) => {
    const stepFields = sortedFields.filter((field) => (field.group || 'default') === step.id);
    stepFields.forEach((field) => claimed.add(field.key));
    return { id: step.id, title: step.title, fields: stepFields };
  });
  const fallbackGroups = new Map<string, FieldGroup>();
  for (const field of sortedFields.filter((item) => !claimed.has(item.key))) {
    const id = field.group?.trim() || 'default';
    const title = field.groupTitle?.trim() || (id === 'default' ? '启动参数' : id);
    const group = fallbackGroups.get(id) ?? { id, title, fields: [] };
    group.fields.push(field);
    fallbackGroups.set(id, group);
  }
  return [...stepGroups, ...fallbackGroups.values()].filter((group) => group.fields.length > 0);
}

function isMultiSelect(component: string | undefined): boolean {
  return component === 'multi_select';
}

function isEditableList(component: string | undefined): boolean {
  return component === 'editable_list';
}

function isTitledGroup(component: string | undefined): boolean {
  return component === 'titled_group';
}

function isEmptyValue(value: unknown): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function FieldEditor({ field, value, onChange }: {
  field: WorkflowSchemaField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const stringValue = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const description = field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null;
  if (['file', 'upload', 'file_upload'].includes(field.component)) {
    const artifact = value && typeof value === 'object' ? value as { name?: string; filePath?: string } : undefined;
    return (
      <div className="space-y-1.5">
        <Label className="text-sm font-semibold text-foreground">{field.label}{field.required ? <span className="text-destructive"> *</span> : null}</Label>
        <Button type="button" variant="outline" className="h-9 w-full justify-start bg-background text-sm" onClick={async () => {
          const result = await invokeIpc<{ canceled: boolean; filePaths: string[] }>('dialog:open', { properties: ['openFile'] });
          const filePath = result.filePaths?.[0];
          if (filePath) onChange({ kind: 'artifact', filePath, uri: `file:///${filePath.replace(/\\/g, '/')}`, name: filePath.split(/[\\/]/).pop() });
        }}>
          <Upload className="mr-2 h-4 w-4" />{artifact?.name ?? artifact?.filePath ?? '选择文件'}
        </Button>
        {description}
      </div>
    );
  }
  if (isBoolean(field.component)) {
    return (
      <div className="space-y-1.5">
        <Label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
          <span>{field.label}{field.required ? <span className="text-destructive"> *</span> : null}</span>
        </Label>
        {description}
      </div>
    );
  }
  if (isMultiSelect(field.component)) {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return <div className="space-y-2"><Label className="text-sm font-semibold text-foreground">{field.label}{field.required ? <span className="text-destructive"> *</span> : null}</Label><div className="grid gap-2">{(field.options ?? []).map((option) => <Label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm font-normal text-foreground"><input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.includes(option.value)} onChange={() => onChange(selected.includes(option.value) ? selected.filter((item) => item !== option.value) : [...selected, option.value])} />{option.label}</Label>)}</div>{description}</div>;
  }
  if (isEditableList(field.component)) {
    const items = Array.isArray(value) && value.length ? value.map((item) => String(item)) : [''];
    return <div className="space-y-2"><Label className="text-sm font-semibold text-foreground">{field.label}{field.required ? <span className="text-destructive"> *</span> : null}</Label><div className="space-y-2">{items.map((item, index) => <div key={`${field.key}-${index}`} className="flex gap-2"><Input value={item} onChange={(event) => onChange(items.map((current, currentIndex) => currentIndex === index ? event.target.value : current))} placeholder={field.description ?? `请输入第 ${index + 1} 项`} className="h-9" /><Button type="button" variant="outline" size="sm" disabled={items.length <= 1} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>删除</Button></div>)}<Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, ''])}>新增一项</Button></div>{description}</div>;
  }
  if (isTitledGroup(field.component)) {
    const current = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return <div className="space-y-2"><Label className="text-sm font-semibold text-foreground">{field.label}{field.required ? <span className="text-destructive"> *</span> : null}</Label><div className="grid gap-2 sm:grid-cols-2">{(field.items ?? []).map((item, index) => <div key={item.fieldKey} className="rounded-lg border border-border bg-muted/20 p-3"><p className="text-sm font-medium"><span className="mr-2 text-muted-foreground">{index + 1}.</span>{item.label}</p>{item.description ? <p className="mt-1 text-xs text-muted-foreground">{item.description}</p> : null}<Input className="mt-2 h-9" value={String(current[item.fieldKey] ?? item.defaultValue ?? '')} onChange={(event) => onChange({ ...current, [item.fieldKey]: event.target.value })} /></div>)}</div>{description}</div>;
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`startup-${field.key}`} className="text-sm font-semibold text-foreground">
        {field.label}{field.required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {field.options?.length ? (
        <select id={`startup-${field.key}`} value={stringValue} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30">
          <option value="">{field.required ? '请选择' : '不设置'}</option>
          {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : isLongText(field.component) ? (
        <Textarea id={`startup-${field.key}`} value={stringValue} onChange={(event) => onChange(event.target.value)} rows={4} className="resize-y bg-background text-sm" placeholder={field.description} />
      ) : (
        <Input id={`startup-${field.key}`} value={stringValue} onChange={(event) => onChange(event.target.value)} className="h-9 bg-background text-sm" placeholder={field.description} />
      )}
      {description}
    </div>
  );
}

export function StartupRunDialog({
  open,
  schema,
  defaultValues = {},
  runtimeUploadNodes = [],
  isStarting,
  onConfirm,
  onClose,
}: StartupRunDialogProps) {
  const fields = useMemo(() => (schema?.enabled ? (schema.fields ?? []) : []), [schema]);
  const groups = useMemo(() => groupFields(schema, fields), [fields, schema]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [engineType, setEngineType] = useState<'claude' | 'openclaw'>('claude');
  const [isOpenClawReady, setIsOpenClawReady] = useState<boolean | null>(null);
  const [runtimeFiles, setRuntimeFiles] = useState<Record<string, Array<{ name?: string; filePath: string; uri: string; kind: string; fileId: string }>>>({});
  const activeSchemaIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      const fallback = isBoolean(field.component) ? false : isMultiSelect(field.component) || isEditableList(field.component) ? [] : isTitledGroup(field.component) ? {} : '';
      initial[field.key] = defaultValues[field.key] ?? field.defaultValue ?? fallback;
    }
    const isSameSchema = activeSchemaIdRef.current === schema?.nodeId;
    // A user may temporarily close the confirmation dialog while checking the
    // canvas. Keep their choices when reopening the same startup schema, while
    // still applying any newly available preset/default values.
    setValues((current) => isSameSchema ? { ...initial, ...current } : initial);
    activeSchemaIdRef.current = schema?.nodeId ?? null;
    setRuntimeFiles({});
    setError('');
  }, [open, defaultValues, fields, schema?.nodeId]);

  useEffect(() => {
    if (!open) return;
    void invokeIpc<boolean>('openclaw:isReady').then(setIsOpenClawReady).catch(() => setIsOpenClawReady(false));
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isStarting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isStarting, onClose, open]);

  if (!open) return null;

  const handleSubmit = () => {
    const inputs: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = values[field.key];
      const value = typeof raw === 'string' ? raw.trim() : raw;
      if (isEmptyValue(value) && field.required) {
        setError(`请填写${field.label}`);
        return;
      }
      if (isEmptyValue(value)) continue;
      if (typeof value === 'object' || typeof value === 'boolean') {
        inputs[field.key] = value;
        continue;
      }
      if (['number', 'integer'].includes(field.component)) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          setError(`${field.label}必须是数字`);
          return;
        }
        inputs[field.key] = field.component === 'integer' ? Math.trunc(parsed) : parsed;
      } else {
        inputs[field.key] = value;
      }
    }
    for (const node of runtimeUploadNodes) {
      if (!runtimeFiles[node.nodeId]?.length) {
        setError(`请为“${node.name}”上传文件`);
        return;
      }
    }
    if (runtimeUploadNodes.length) inputs.__workflowRuntimeUploads = runtimeFiles;
    setError('');
    onConfirm(inputs, engineType);
  };

  const stepCount = groups.length + (runtimeUploadNodes.length ? 1 : 0);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--sto-overlay-warm-scrim)] p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isStarting) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="startup-run-title" className="sto-overlay sto-overlay--warm-dialog grid max-h-[calc(100dvh-48px)] w-full max-w-[820px] grid-rows-[auto_minmax(0,1fr)_auto] gap-[18px] overflow-hidden rounded-[20px] border p-6">
        <header className="shrink-0">
          <h2 id="startup-run-title" className="text-xl font-semibold text-foreground">启动配置确认</h2>
          <label className="mt-4 flex items-center gap-2 text-sm font-medium">运行引擎
            <select value={engineType} onChange={(event) => setEngineType(event.target.value as 'claude' | 'openclaw')} disabled={isStarting} className="h-9 rounded-md border border-input bg-background px-2">
              <option value="claude">{getAgentEngineDisplayName('claude')}</option>
              <option value="openclaw" disabled={isOpenClawReady === false}>{isOpenClawReady === false ? `${getAgentEngineDisplayName('openclaw')}（网关未就绪）` : getAgentEngineDisplayName('openclaw')}</option>
            </select>
          </label>
        </header>

        <div className="min-h-0 overflow-y-auto pr-2">
          <div className="space-y-[18px]">
            {groups.length === 0 && runtimeUploadNodes.length === 0 ? <p className="text-sm text-muted-foreground">当前流程没有声明启动前参数，将直接开始运行。</p> : null}
            {groups.map((group, index) => (
              <section key={group.id} aria-labelledby={`startup-group-${index}`} className="space-y-2">
                <h3 id={`startup-group-${index}`} className="text-xs font-bold text-muted-foreground">{index + 1}. {group.title}</h3>
                <div className="grid gap-2">
                  {group.fields.map((field) => <FieldEditor key={field.key} field={field} value={values[field.key]} onChange={(value) => setValues((previous) => ({ ...previous, [field.key]: value }))} />)}
                </div>
              </section>
            ))}
            {runtimeUploadNodes.length ? (
              <section aria-labelledby="runtime-upload-title">
                <h3 id="runtime-upload-title" className="text-xs font-bold text-muted-foreground">{stepCount}. 运行时文件</h3>
                <div className="mt-2 space-y-3">
                  {runtimeUploadNodes.map((node) => {
                    const files = runtimeFiles[node.nodeId] ?? [];
                    const maxFiles = node.maxFiles ?? 20;
                    return <div key={node.nodeId} className="sto-card sto-card--workflow-upload rounded-2xl border p-4">
                      <Label className="text-sm font-semibold text-foreground">{node.name}，运行时上传文件<span className="text-destructive"> *</span></Label>
                      <p className="mt-1 text-xs text-muted-foreground">可选择多个文件，最多 {maxFiles} 个。文件只会复制到本次试运行工作区。</p>
                      <Button type="button" variant="outline" className="mt-3 h-9 bg-background text-sm" onClick={async () => {
                        const result = await invokeIpc<{ filePaths: string[] }>('dialog:open', { properties: ['openFile', 'multiSelections'], filters: [{ name: '数据文件', extensions: node.acceptedExtensions ?? ['xlsx', 'xls', 'csv'] }] });
                        const selected = (result.filePaths ?? []).slice(0, maxFiles).map((filePath, fileIndex) => ({ kind: 'artifact', fileId: `runtime-${node.nodeId}-${fileIndex + 1}`, filePath, uri: `file:///${filePath.replace(/\\/g, '/')}`, name: filePath.split(/[\\/]/).pop() }));
                        if (selected.length) setRuntimeFiles((previous) => ({ ...previous, [node.nodeId]: selected }));
                      }}><Upload className="mr-2 h-4 w-4" />{files.length ? `重新选择文件，已选 ${files.length} 个` : '选择文件'}</Button>
                      {files.length ? <ul className="mt-3 space-y-2">{files.map((file, fileIndex) => <li key={file.filePath} className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2 text-sm"><span className="truncate">{file.name}</span><button type="button" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`移除 ${file.name}`} onClick={() => setRuntimeFiles((previous) => ({ ...previous, [node.nodeId]: files.filter((_, index) => index !== fileIndex) }))}><X className="h-4 w-4" /></button></li>)}</ul> : null}
                    </div>;
                  })}
                </div>
              </section>
            ) : null}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-3">
          {error ? <p role="alert" className="mr-auto min-w-0 text-sm text-destructive">{error}</p> : null}
          <Button variant="outline" className="h-9 px-4 text-sm" onClick={onClose} disabled={isStarting}>取消</Button>
          <Button className="h-9 px-4 text-sm" onClick={handleSubmit} disabled={isStarting}>{isStarting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}{isStarting ? '启动中' : '确认并运行'}</Button>
        </footer>
      </section>
    </div>
  );
}
