/**
 * CreateAppDialog — 创建用户应用（app-create-scaffold）。
 * 一步式表单：名称 + 类型 + 位置；提交后立即进入工作台，安装等长耗时
 * 步骤在工作台以连续进度呈现。打开弹窗即后台预热 Node 运行环境。
 */
import { useEffect, useState } from 'react';
import { Folder, Loader2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formFieldFocusClass, modalPrimarySubmitButtonClass } from '@/lib/surfaces';
import { pickProjectFolder } from '@/lib/session-catalog-api';
import {
  createUserApp,
  getAppDevEnvironment,
  listAppTemplates,
  prepareAppDevEnvironment,
  type AppTemplateSummary,
  type CodeApplicationPageType,
} from '@/lib/app-dev-api';
import { useSessionCatalogStore } from '@/stores/session-catalog';
import { useAppDevCatalogStore } from '@/stores/app-dev-catalog';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';

function templateSelectionKey(item: AppTemplateSummary): string {
  return `${item.source ?? 'memory-center'}:${item.templateId}:${item.latestVersion}`;
}

export interface CreateAppDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateAppDialog({ open, onClose }: CreateAppDialogProps) {
  const [name, setName] = useState('');
  const [pageType, setPageType] = useState<CodeApplicationPageType>('site');
  const [parentDir, setParentDir] = useState('');
  const [defaultParentDir, setDefaultParentDir] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [templates, setTemplates] = useState<AppTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateError, setTemplateError] = useState('');

  // 后台预热 Node 运行环境：用户填表单的时间通常足够完成下载。
  useEffect(() => {
    if (!open) {
      setName('');
      setParentDir('');
      setPageType('site');
      setTemplates([]);
      setTemplateId('');
      setTemplateError('');
      return;
    }
    void prepareAppDevEnvironment().catch(() => undefined);
    void getAppDevEnvironment()
      .then((env) => {
        const fallback = env.defaultParentDir?.trim() ?? '';
        setDefaultParentDir(fallback);
        setParentDir((current) => current.trim() || fallback);
      })
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingTemplates(true);
    setTemplateError('');
    setTemplates([]);
    setTemplateId('');
    void listAppTemplates(pageType)
      .then((result) => {
        if (cancelled) return;
        const items = result.items.filter((item) => item.pageType === pageType && item.latestVersion);
        setTemplates(items);
        const preferred = items.find(
          (item) => item.templateId === `${pageType}-minimal` && item.source === 'local-resource',
        ) ?? items.find((item) => item.templateId === `${pageType}-minimal`);
        setTemplateId(preferred ? templateSelectionKey(preferred) : '');
        if (!preferred) {
          setTemplateError(
            items.length > 0
              ? '内置最简模板尚未初始化，请主动选择其他模板'
              : '当前应用类型暂无可用模板',
          );
        }
      })
      .catch((error) => {
        if (!cancelled) setTemplateError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, pageType]);

  if (!open) return null;

  const handlePick = async () => {
    setPicking(true);
    try {
      const picked = await pickProjectFolder();
      if (picked) setParentDir(picked);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setPicking(false);
    }
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!selectedTemplate) {
      toast.error('请选择可用的应用模板');
      return;
    }
    setSubmitting(true);
    try {
      const resolvedParentDir = parentDir.trim() || defaultParentDir;
      if (!resolvedParentDir) {
        toast.error('无法确定存放位置，请点击「更改」选择目录');
        return;
      }
      const result = await createUserApp({
        name: trimmed,
        parentDir: resolvedParentDir,
        projectType: 'frontend',
        pageType,
        templateId: selectedTemplate.templateId,
        templateVersion: selectedTemplate.latestVersion,
        templateSource: selectedTemplate.source ?? 'memory-center',
      });
      useAppDevCatalogStore.getState().registerWorkspaceId(result.workspaceId);
      await useSessionCatalogStore.getState().refreshWorkspaces().catch(() => undefined);
      await useAppDevCatalogStore.getState().refresh().catch(() => undefined);
      onClose();
      useAppPlazaShellStore.getState().openOrFocusDevAppTab(result.workspaceId, trimmed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const typeOptions: Array<{
    value: CodeApplicationPageType;
    label: string;
    hint: string;
  }> = [
    { value: 'site', label: 'Site', hint: '固定域名，发版不需要修改版本号' },
    { value: 'assets', label: 'Assets', hint: '内嵌子应用，发布后需依赖主应用访问' },
  ];
  const selectedTemplate = templates.find((item) => templateSelectionKey(item) === templateId);

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-[22px] bg-background p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">创建应用</h2>
          <button type="button" onClick={onClose} aria-label="关闭" className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mb-2 block text-sm font-medium text-foreground">
          应用名称
          <span className="ml-0.5 text-[var(--sto-functional-error)]">*</span>
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="比如：快递查询助手"
          className={cn(
            'mb-5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground',
            'placeholder:text-muted-foreground transition-colors',
            formFieldFocusClass,
          )}
        />

        <label className="mb-2 block text-sm font-medium text-foreground">应用类型</label>
        <div className="mb-5 grid grid-cols-2 gap-2">
          {typeOptions.map((option) => {
            const selected = pageType === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setPageType(option.value)}
                className={cn(
                  'rounded-xl border px-3 py-3 text-left transition-colors',
                  selected && 'border-[var(--sto-brand-6)] bg-[var(--sto-brand-6)]/5',
                  !selected && 'border-border bg-muted/40 hover:bg-muted',
                )}
              >
                <span
                  className="block text-sm font-medium text-foreground"
                >
                  {option.label}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {option.hint}
                </span>
              </button>
            );
          })}
        </div>

        <label className="mb-2 block text-sm font-medium text-foreground">应用模板</label>
        <select
          aria-label="应用模板"
          value={templateId}
          disabled={loadingTemplates || templates.length === 0}
          onChange={(event) => setTemplateId(event.target.value)}
          className={cn(
            'mb-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground',
            formFieldFocusClass,
          )}
        >
          {loadingTemplates && <option value="">正在加载模板…</option>}
          {!loadingTemplates && templates.length === 0 && <option value="">暂无可用模板</option>}
          {!loadingTemplates && templates.length > 0 && !templateId && <option value="">请选择模板</option>}
          {templates.map((item) => (
            <option key={templateSelectionKey(item)} value={templateSelectionKey(item)}>
              {item.source === 'local-resource'
                ? `${item.name} · 本地资源`
                : `${item.name} · Memory Center · v${item.latestVersion}`}
            </option>
          ))}
        </select>
        <p className={cn(
          'mb-5 text-xs leading-relaxed',
          templateError ? 'text-[var(--sto-functional-error)]' : 'text-muted-foreground',
        )}>
          {templateError || selectedTemplate?.description || '模板决定新应用的初始工程内容。'}
        </p>

        <label className="mb-2 block text-sm font-medium text-foreground">存放位置</label>
        <button
          type="button"
          disabled={picking}
          onClick={() => void handlePick()}
          className={cn(
            'mb-2 flex w-full items-center gap-2 rounded-xl border border-border',
            'bg-muted/50 px-3 py-3 text-left transition-colors',
            'hover:bg-muted disabled:opacity-60',
          )}
        >
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              parentDir ? 'text-foreground' : 'text-muted-foreground',
            )}
            title={parentDir || undefined}
          >
            {picking
              ? '选择中…'
              : parentDir
                ? (parentDir === defaultParentDir ? `默认位置（${parentDir}）` : parentDir)
                : '正在读取默认位置…'}
          </span>
          <span className="shrink-0 text-xs text-[var(--sto-brand-6)]">更改</span>
        </button>
        <p className="mb-6 text-xs leading-relaxed text-muted-foreground">
          创建后即可在对话里描述需求，页面会实时更新。
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
          <Button
            type="button"
            className={cn(modalPrimarySubmitButtonClass, 'min-w-[88px]')}
            disabled={submitting || loadingTemplates || !selectedTemplate || !name.trim() || !parentDir.trim()}
            onClick={() => void handleSubmit()}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '创建应用'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
