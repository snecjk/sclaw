import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getAppDescription, updateAppDescription } from '@/lib/app-dev-api';
import { formFieldFocusClass } from '@/lib/surfaces';
import { cn } from '@/lib/utils';

const DESCRIPTION_MAX_LENGTH = 200;

export interface AppDescriptionPopoverProps {
  workspaceId: string;
  appName: string;
}

export function AppDescriptionPopover({ workspaceId, appName }: AppDescriptionPopoverProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestVersionRef = useRef(0);
  const normalizedDraft = draft.trim();
  const dirty = normalizedDraft !== description;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (!dirty && !saving) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      setDraft(description);
      setError('');
      setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [description, dirty, open, saving]);

  const loadDescription = async () => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setLoading(true);
    setError('');
    try {
      const result = await getAppDescription(workspaceId);
      if (requestVersionRef.current !== requestVersion) return;
      setDescription(result.description);
      setDraft(result.description);
      setStale(result.stale === true);
    } catch (loadError) {
      if (requestVersionRef.current !== requestVersion) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (requestVersionRef.current === requestVersion) setLoading(false);
    }
  };

  const handleToggle = () => {
    if (open) {
      if (!dirty && !saving) setOpen(false);
      return;
    }
    setOpen(true);
    void loadDescription();
  };

  const handleCancel = () => {
    setDraft(description);
    setError('');
    setOpen(false);
  };

  const handleSave = async () => {
    if (!dirty || saving || loading || draft.length > DESCRIPTION_MAX_LENGTH) return;
    setSaving(true);
    setError('');
    try {
      const result = await updateAppDescription({ workspaceId, description: normalizedDraft });
      setDescription(result.description);
      setDraft(result.description);
      setStale(false);
      setOpen(false);
      toast.success('应用描述已保存');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const descriptionId = `app-description-${workspaceId}`;

  return (
    <div ref={rootRef} className="no-drag relative min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={descriptionId}
        onClick={handleToggle}
        className="flex h-8 max-w-[320px] items-center rounded-md px-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
      >
        <span className="truncate">{appName}</span>
      </button>

      {open ? (
        <div
          id={descriptionId}
          role="dialog"
          aria-label={`${appName}应用描述`}
          className="absolute left-0 top-[calc(100%+8px)] z-[280] w-[min(360px,calc(100vw-32px))] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
        >
          <label htmlFor={`${descriptionId}-input`} className="mb-2 block text-sm font-medium">
            应用描述
          </label>
          <div className="relative">
            <textarea
              id={`${descriptionId}-input`}
              value={draft}
              maxLength={DESCRIPTION_MAX_LENGTH}
              rows={4}
              disabled={loading || saving}
              onChange={(event) => {
                setDraft(event.target.value);
                setError('');
              }}
              placeholder={loading ? '正在加载…' : '添加应用描述'}
              className={cn(
                'min-h-24 w-full resize-none rounded-md border border-border bg-background px-3 py-2 pr-9 text-sm text-foreground',
                'placeholder:text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                formFieldFocusClass,
              )}
            />
            {loading ? (
              <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" aria-label="正在加载应用描述" />
            ) : null}
          </div>
          <div className="mt-1 flex items-start justify-between gap-3 text-xs">
            <div aria-live="polite">
              {error ? <p className="text-[var(--sto-functional-error)]">{error}</p> : null}
              {!error && stale ? (
                <p className="text-amber-600 dark:text-amber-400">当前展示本地缓存，连接恢复后可保存同步。</p>
              ) : null}
            </div>
            <span className="ml-auto shrink-0 text-muted-foreground">{draft.length}/{DESCRIPTION_MAX_LENGTH}</span>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={handleCancel}>
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty || loading || saving || draft.length > DESCRIPTION_MAX_LENGTH}
              onClick={() => void handleSave()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : '保存'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
