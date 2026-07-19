/**
 * Startup parameter dialog for the native designer trial-run (canvas Task 4).
 *
 * The schema and selected default preset come from WorkflowDetailResponse,
 * so no separate startup-schema request is needed for a trial run.
 */
import { useEffect, useState } from 'react';
import { Loader2, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { WorkflowSchema, WorkflowSchemaField } from '@/types/workflow';
import { invokeIpc } from '@/lib/api-client';
import type { RuntimeUploadNode } from '@/pages/WorkflowDesigner/hooks/use-designer-try-run';

interface StartupRunDialogProps {
  open: boolean;
  schema: WorkflowSchema | null | undefined;
  defaultValues?: Record<string, unknown>;
  runtimeUploadNodes?: RuntimeUploadNode[];
  isStarting: boolean;
  onConfirm: (inputs: Record<string, unknown>) => void;
  onClose: () => void;
}

function isLongText(component: string | undefined): boolean {
  return (
    component === 'textarea' ||
    component === 'text_area' ||
    component === 'long_text' ||
    component === 'long'
  );
}

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: WorkflowSchemaField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const stringValue = typeof value === 'string' ? value : '';
  if (['file', 'upload', 'file_upload'].includes(field.component)) {
    const artifact = value && typeof value === 'object' ? value as { name?: string; filePath?: string } : undefined;
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{field.label}{field.required ? <span className="text-destructive"> *</span> : null}</Label>
        <Button type="button" variant="outline" size="sm" className="justify-start" onClick={async () => {
          const result = await invokeIpc<{ canceled: boolean; filePaths: string[] }>('dialog:open', { properties: ['openFile'] });
          const filePath = result.filePaths?.[0];
          if (filePath) onChange({ kind: 'artifact', filePath, uri: `file:///${filePath.replace(/\\/g, '/')}`, name: filePath.split(/[\\/]/).pop() });
        }}>{artifact?.name ?? artifact?.filePath ?? '选择文件'}</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`startup-${field.key}`} className="text-xs">
        {field.label}
        {field.required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {field.options?.length ? (
        <select id={`startup-${field.key}`} value={stringValue} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">请选择</option>
          {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : isLongText(field.component) ? (
        <Textarea
          id={`startup-${field.key}`}
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      ) : (
        <Input
          id={`startup-${field.key}`}
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.description ? (
        <p className="text-[11px] text-muted-foreground">{field.description}</p>
      ) : null}
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
  const fields = schema?.enabled ? (schema.fields ?? []) : [];
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [runtimeFiles, setRuntimeFiles] = useState<Record<string, any[]>>({});

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, unknown> = {};
    for (const f of fields) {
      initial[f.key] = defaultValues[f.key] ?? f.defaultValue ?? '';
    }
    // Reset the form only when a new dialog session opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues(initial);
    setRuntimeFiles({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultValues]);

  if (!open) return null;

  const handleSubmit = () => {
    const inputs: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.key];
      const v = typeof raw === 'string' ? raw.trim() : raw;
      if ((v === '' || v == null) && f.required) {
        setError(`请填写${f.label}`);
        return;
      }
      if (v === '' || v == null) continue;
      if (typeof v === 'object') { inputs[f.key] = v; continue; }
      if (['number', 'integer'].includes(f.component)) {
        const parsed = Number(v);
        if (!Number.isFinite(parsed)) { setError(`${f.label}必须是数字`); return; }
        inputs[f.key] = f.component === 'integer' ? Math.trunc(parsed) : parsed;
      } else if (['checkbox', 'boolean', 'switch'].includes(f.component)) {
        inputs[f.key] = ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase());
      } else {
        inputs[f.key] = v;
      }
    }
    for (const node of runtimeUploadNodes) {
      if (!(runtimeFiles[node.nodeId]?.length)) { setError(`请为“${node.name}”上传文件`); return; }
    }
    if (runtimeUploadNodes.length) inputs.__workflowRuntimeUploads = runtimeFiles;
    setError('');
    onConfirm(inputs);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg">
        <h2 className="text-base font-semibold">试运行参数</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          填写启动配置后开始客户端本地试运行
        </p>
        <div className="mt-4 flex max-h-[55vh] flex-col gap-3 overflow-auto pr-1">
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              该流程无需启动参数，可直接运行。
            </p>
          ) : (
            fields.map((field) => (
              <FieldEditor
                key={field.key}
                field={field}
                value={values[field.key] ?? ''}
                onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
              />
            ))
          )}
          {runtimeUploadNodes.map((node) => {
            const files = runtimeFiles[node.nodeId] ?? [];
            const maxFiles = node.maxFiles ?? 20;
            return (
            <div key={node.nodeId} className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-3">
              <Label className="text-xs">{node.name}，运行时上传文件<span className="text-destructive"> *</span></Label>
              <p className="text-[11px] text-muted-foreground">可选择多个文件（最多 {maxFiles} 个）。文件只会复制到本次试运行工作区，不会把原始本机路径交给 Agent。</p>
              <Button type="button" variant="outline" size="sm" className="justify-start" onClick={async () => {
                const result = await invokeIpc<{ filePaths: string[] }>('dialog:open', {
                  properties: ['openFile', 'multiSelections'],
                  filters: [{ name: '数据文件', extensions: node.acceptedExtensions ?? ['xlsx', 'xls', 'csv'] }],
                });
                const selected = (result.filePaths ?? []).slice(0, maxFiles).map((filePath, index) => ({
                  kind: 'artifact',
                  fileId: `runtime-${node.nodeId}-${index + 1}`,
                  filePath,
                  uri: `file:///${filePath.replace(/\\/g, '/')}`,
                  name: filePath.split(/[\\/]/).pop(),
                }));
                if (selected.length) setRuntimeFiles((prev) => ({ ...prev, [node.nodeId]: selected }));
              }}>{files.length ? `重新选择文件（已选 ${files.length} 个）` : '选择文件'}</Button>
              {files.length ? (
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {files.map((file, index) => (
                    <li key={file.filePath} className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1">
                      <span className="truncate">{file.name}</span>
                      <button type="button" className="shrink-0 text-muted-foreground hover:text-destructive" aria-label={`移除 ${file.name}`} onClick={() => setRuntimeFiles((prev) => ({ ...prev, [node.nodeId]: files.filter((_: unknown, fileIndex: number) => fileIndex !== index) }))}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            );
          })}
        </div>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isStarting}>
            取消
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={isStarting}>
            {isStarting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1 h-3.5 w-3.5" />
            )}
            {isStarting ? '启动中' : '开始试运行'}
          </Button>
        </div>
      </div>
    </div>
  );
}
