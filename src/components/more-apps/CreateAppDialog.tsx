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
import { createUserApp, prepareAppDevEnvironment } from '@/lib/app-dev-api';
import { useSessionCatalogStore } from '@/stores/session-catalog';
import { useAppDevCatalogStore } from '@/stores/app-dev-catalog';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';

export interface CreateAppDialogProps {
  open: boolean;
  onClose: () => void;
}

type ProjectType = 'frontend' | 'fullstack';

export function CreateAppDialog({ open, onClose }: CreateAppDialogProps) {
  const [name, setName] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('frontend');
  const [parentDir, setParentDir] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [picking, setPicking] = useState(false);

  // 后台预热 Node 运行环境：用户填表单的时间通常足够完成下载。
  useEffect(() => {
    if (open) void prepareAppDevEnvironment().catch(() => undefined);
  }, [open]);

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
    setSubmitting(true);
    try {
      const result = await createUserApp({
        name: trimmed,
        parentDir: parentDir || undefined,
        projectType: projectType === 'fullstack' ? 'frontend' : projectType,
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
    value: ProjectType;
    label: string;
    hint: string;
    disabled?: boolean;
  }> = [
    { value: 'frontend', label: '前端应用', hint: '页面应用，创建后立即可预览' },
    {
      value: 'fullstack',
      label: '前端 + 后端',
      hint: '后端能力即将开放，会先为你预留目录',
      disabled: true,
    },
  ];

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
            const selected = !option.disabled && projectType === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                aria-disabled={option.disabled || undefined}
                title={option.disabled ? '即将开放' : undefined}
                onClick={() => {
                  if (option.disabled) return;
                  setProjectType(option.value);
                }}
                className={cn(
                  'rounded-xl border px-3 py-3 text-left transition-colors',
                  option.disabled && 'cursor-not-allowed border-border/70 bg-muted/30 opacity-50',
                  !option.disabled && selected && 'border-[var(--sto-brand-6)] bg-[var(--sto-brand-6)]/5',
                  !option.disabled && !selected && 'border-border bg-muted/40 hover:bg-muted',
                )}
              >
                <span
                  className={cn(
                    'block text-sm font-medium',
                    option.disabled ? 'text-muted-foreground' : 'text-foreground',
                  )}
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
          <span className={cn('min-w-0 flex-1 truncate text-sm', parentDir ? 'text-foreground' : 'text-muted-foreground')}>
            {picking ? '选择中…' : (parentDir || '默认位置（文稿 › SClawApps）')}
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
            disabled={submitting || !name.trim()}
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
