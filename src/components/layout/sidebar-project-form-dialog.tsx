/**
 * ProjectFormDialog — 新建项目（名称 + 项目位置）。
 * 项目创建后仅支持侧栏行内重命名，不支持改路径。
 */
import { useEffect, useState } from 'react';
import { Folder, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formFieldFocusClass, modalPrimarySubmitButtonClass } from '@/lib/surfaces';
import { pickProjectFolder, type WorkspaceDto } from '@/lib/session-catalog-api';
import { useSessionCatalogStore } from '@/stores/session-catalog';
import { toast } from 'sonner';

export interface ProjectFormDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (workspace: WorkspaceDto) => void;
}

export function ProjectFormDialog({
  open,
  onClose,
  onCreated,
}: ProjectFormDialogProps) {
  const { t } = useTranslation('common');
  const createProject = useSessionCatalogStore((s) => s.createProject);
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setRootPath('');
  }, [open]);

  if (!open) return null;

  const handlePick = async () => {
    setPicking(true);
    try {
      const picked = await pickProjectFolder();
      if (picked) setRootPath(picked);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setPicking(false);
    }
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const trimmedPath = rootPath.trim();
    if (!trimmedName || !trimmedPath) return;
    setSubmitting(true);
    try {
      const created = await createProject(trimmedName, trimmedPath);
      if (created) {
        toast.success(t('sidebar.projectCreated'));
        onCreated?.(created);
      }
      onClose();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-[22px] bg-background p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('sidebar.newProject')}</h2>
          <button type="button" onClick={onClose} aria-label={t('actions.cancel')}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mb-2 block text-sm font-medium text-foreground">
          {t('sidebar.projectNameLabel')}
          <span className="ml-0.5 text-[var(--sto-functional-error)]">*</span>
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={cn('mb-5 w-full rounded-lg border px-3 py-2.5 text-sm', formFieldFocusClass)}
        />

        <label className="mb-2 block text-sm font-medium text-foreground">
          {t('sidebar.projectLocationLabel')}
          <span className="ml-0.5 text-[var(--sto-functional-error)]">*</span>
        </label>
        <button
          type="button"
          disabled={picking}
          onClick={() => void handlePick()}
          className={cn(
            'mb-2 flex w-full items-center gap-2 rounded-xl border border-[var(--sto-sidebar-border)]',
            'bg-[var(--sto-neutral-2)] px-3 py-3 text-left transition-colors',
            'hover:bg-[var(--sto-sidebar-row-hover-bg)] disabled:opacity-60',
          )}
        >
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className={cn(
            'min-w-0 flex-1 truncate text-sm',
            rootPath ? 'text-foreground' : 'text-muted-foreground',
          )}
          >
            {picking
              ? t('status.loading')
              : (rootPath || t('sidebar.projectLocationPlaceholder'))}
          </span>
        </button>

        <p className="mb-6 text-xs leading-relaxed text-muted-foreground">
          {t('sidebar.projectArtifactHint')}
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            className={cn(modalPrimarySubmitButtonClass, 'min-w-[72px]')}
            disabled={submitting || picking || !name.trim() || !rootPath.trim()}
            onClick={() => void handleSubmit()}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('actions.save')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
