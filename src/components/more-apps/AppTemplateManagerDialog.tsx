import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileCode2, Loader2, Plus, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  listAppTemplates,
  deleteAppTemplate,
  openAppTemplateWorkspace,
  type AppTemplateSummary,
  type CodeApplicationPageType,
} from '@/lib/app-dev-api';
import { cn } from '@/lib/utils';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';

type Filter = 'all' | CodeApplicationPageType;

function itemKey(item: Pick<AppTemplateSummary, 'templateId' | 'source'>): string {
  return `${item.source ?? 'memory-center'}:${item.templateId}`;
}

export function AppTemplateManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<AppTemplateSummary[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AppTemplateSummary | null>(null);
  const [newName, setNewName] = useState('');
  const [newPageType, setNewPageType] = useState<CodeApplicationPageType>('site');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listAppTemplates();
      setItems(result.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '模板列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (open) void load();
      else setDeleteTarget(null);
    });
    return () => { cancelled = true; };
  }, [load, open]);

  const visibleItems = useMemo(
    () => items.filter((item) => filter === 'all' || item.pageType === filter),
    [filter, items],
  );

  if (!open) return null;

  const confirmDelete = async () => {
    if (!deleteTarget || deleteTarget.isBuiltin || deleteTarget.source === 'local-resource') return;
    try {
      await deleteAppTemplate(deleteTarget.templateId);
      setItems((current) => current.filter((item) => itemKey(item) !== itemKey(deleteTarget)));
      setDeleteTarget(null);
      toast.success('模板已删除');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '模板删除失败');
    }
  };

  const enterWorkspace = async (input: Parameters<typeof openAppTemplateWorkspace>[0]) => {
    setOpeningId(input.templateId
      ? `${input.source ?? 'memory-center'}:${input.templateId}`
      : 'new');
    try {
      const result = await openAppTemplateWorkspace(input);
      useAppPlazaShellStore.getState().openOrFocusDevAppTab(
        result.workspaceId,
        `模板：${input.name}`,
        'template',
      );
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '模板工作区打开失败');
    } finally {
      setOpeningId('');
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/45 p-6">
      <section className="flex h-[min(760px,90vh)] w-[min(960px,94vw)] flex-col overflow-hidden rounded-2xl bg-background shadow-2xl">
        <header className="flex items-center gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">应用模板管理</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              模板草稿只保存在本机工作区；名称和描述可通过 AI 或代码编辑 manifest.json，发布前需要再次确认。
            </p>
          </div>
          <div className="flex-1" />
          <button type="button" aria-label="关闭模板管理" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-border bg-muted/20 px-6 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[240px] flex-1 text-xs text-muted-foreground">
              新模板名称
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="例如：数据看板模板"
                className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              类型
              <select
                value={newPageType}
                onChange={(event) => setNewPageType(event.target.value as CodeApplicationPageType)}
                className="mt-1.5 block rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="site">Site</option>
                <option value="assets">Assets</option>
              </select>
            </label>
            <Button
              type="button"
              disabled={!newName.trim() || openingId === 'new'}
              onClick={() => void enterWorkspace({ pageType: newPageType, name: newName.trim() })}
            >
              {openingId === 'new' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              新建模板
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-1 px-6 py-3">
          {([['all', '全部'], ['site', 'Site'], ['assets', 'Assets']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs',
                filter === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载模板…
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">暂无模板</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {visibleItems.map((item) => (
                <article key={itemKey(item)} className="rounded-xl border border-border p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-violet-500/10 p-2 text-violet-600"><FileCode2 className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-medium text-foreground">{item.name}</h3>
                        {item.isBuiltin ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">内置</span> : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description || '暂无描述'}</p>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {item.pageType === 'site' ? 'Site' : 'Assets'} · v{item.latestVersion}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={openingId === itemKey(item)}
                      onClick={() => void enterWorkspace({
                        templateId: item.templateId,
                        pageType: item.pageType,
                        name: item.name,
                        description: item.description,
                        latestVersion: item.latestVersion,
                        source: item.source,
                      })}
                    >
                      {openingId === itemKey(item)
                        ? '打开中…'
                        : item.source === 'local-resource' ? '调试' : '编辑'}
                    </Button>
                    {!item.isBuiltin && item.source !== 'local-resource' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        aria-label={`删除${item.name}`}
                        disabled={openingId !== ''}
                        onClick={() => setDeleteTarget(item)}
                      >
                        删除
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
      <ConfirmDialog
        open={deleteTarget !== null}
        overlayClassName="z-[260]"
        title="删除模板"
        message={`确定删除「${deleteTarget?.name ?? ''}」吗？删除后不再出现在模板列表中；已创建的应用和本地工作区不受影响。`}
        confirmLabel="确认删除"
        confirmingLabel="删除中…"
        cancelLabel="取消"
        variant="destructive"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>,
    document.body,
  );
}
