/**
 * DevAppCard — 应用广场「开发应用」卡片。
 * 主操作：继续编辑；⋯ 菜单含发布/拉取（MVP 禁用）与删除。
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Code2,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Upload,
  Download,
  Trash2,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { deleteDevApp, type DevAppSummary } from '@/lib/app-dev-api';
import { invokeIpc } from '@/lib/api-client';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';
import { useAppDevCatalogStore } from '@/stores/app-dev-catalog';

interface DevAppCardProps {
  app: DevAppSummary;
}

export function DevAppCard({ app }: DevAppCardProps) {
  const openOrFocusDevAppTab = useAppPlazaShellStore((s) => s.openOrFocusDevAppTab);
  const closeDevAppTabsByWorkspaceId = useAppPlazaShellStore((s) => s.closeDevAppTabsByWorkspaceId);
  const unregisterWorkspaceId = useAppDevCatalogStore((s) => s.unregisterWorkspaceId);
  const refreshCatalog = useAppDevCatalogStore((s) => s.refresh);

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleEdit = () => {
    openOrFocusDevAppTab(app.workspaceId, app.name);
  };

  const handleReveal = async () => {
    try {
      await invokeIpc('shell:showItemInFolder', app.appPath);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const result = await deleteDevApp(app.workspaceId, { deleteFiles });
      closeDevAppTabsByWorkspaceId(app.workspaceId);
      unregisterWorkspaceId(app.workspaceId);
      await refreshCatalog();
      toast.success(
        result.deletedFiles ? '应用已删除，本地文件已一并移除' : '应用已删除（本地文件已保留）',
      );
      setDeleteOpen(false);
      setDeleteFiles(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article
      className={cn('more-apps-card more-apps-card--dev', menuOpen && 'more-apps-card--menu-open')}
      onClick={handleEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleEdit();
        }
      }}
    >
      <div className="more-apps-card__top">
        <div className="more-apps-card__icon--dev" aria-hidden>
          <Code2 className="h-6 w-6" />
        </div>
        <div className="more-apps-card__head">
          <h3 className="more-apps-card__title">{app.name}</h3>
        </div>
      </div>

      <p className="more-apps-card__desc">
        {app.projectType === 'fullstack' ? '前端 + 后端应用' : '前端应用'}，通过对话持续完善
      </p>

      <div className="more-apps-card__foot more-apps-card__foot--dev">
        <button
          type="button"
          className="more-apps-card__primary-action"
          onClick={(e) => {
            e.stopPropagation();
            handleEdit();
          }}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          继续编辑
        </button>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="more-apps-card__more-btn"
              aria-label="更多操作"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={handleEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden />
              编辑应用
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleReveal()}>
              <FolderOpen className="mr-2 h-3.5 w-3.5" aria-hidden />
              在访达中打开
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled title="即将支持：同步到公司 GitLab 后可用">
              <Upload className="mr-2 h-3.5 w-3.5" aria-hidden />
              发布应用
            </DropdownMenuItem>
            <DropdownMenuItem disabled title="即将支持：从云端拉取到本地">
              <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
              拉取应用
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                setDeleteFiles(false);
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden />
              删除应用
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {deleteOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.42)] p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dev-app-delete-title"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !deleting) {
                  setDeleteOpen(false);
                }
              }}
            >
              <div
                className={cn(
                  'w-full max-w-[420px] overflow-hidden rounded-[12px] border border-[#E5E6EB] bg-white p-5',
                  'shadow-[0_12px_40px_rgba(15,23,42,0.12)]',
                  'dark:border-border dark:bg-card',
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <h2
                  id="dev-app-delete-title"
                  className="text-[16px] font-semibold leading-tight text-[#1D2129] dark:text-foreground"
                >
                  删除应用
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
                  确定删除「{app.name}」吗？将从应用广场移除，此操作不可撤销。
                </p>
                <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={deleteFiles}
                    disabled={deleting}
                    onChange={(e) => setDeleteFiles(e.target.checked)}
                  />
                  <span className="min-w-0 text-[13px] leading-relaxed text-foreground">
                    同时删除本地项目文件
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={app.appPath}>
                      {app.appPath}
                    </span>
                  </span>
                </label>
                <div className="mt-5 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={deleting}
                    className="h-8 rounded-md px-3 text-[13px]"
                    onClick={() => setDeleteOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={deleting}
                    className="h-8 rounded-md px-3 text-[13px]"
                    onClick={() => void handleDelete()}
                  >
                    {deleting ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        删除中…
                      </span>
                    ) : (
                      '删除'
                    )}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </article>
  );
}
