/**
 * DevAppCard — 应用广场「开发应用」卡片。
 * 本地就绪：继续编辑；云端仅有 / 路径失效：拉取到本地（每次选目录）。
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Download,
  Trash2,
  Loader2,
  ExternalLink,
  ShieldCheck,
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
import { cloneDevApp, deleteDevApp, type DevAppSummary } from '@/lib/app-dev-api';
import { invokeIpc } from '@/lib/api-client';
import { pickProjectFolder } from '@/lib/session-catalog-api';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';
import { useAppDevCatalogStore } from '@/stores/app-dev-catalog';
import { useSessionCatalogStore } from '@/stores/session-catalog';
import { isHttpUrl, openExternalUrl } from '@/lib/preview-url';
import { openInSclawBrowser } from '@/lib/open-sclaw-browser';
import {
  buildAppPermissionsCallbackUrl,
  buildDirectAppPermissionsLoginUrl,
  buildAppPermissionsUrl,
} from '@/lib/app-permissions-url';
import { getWorkflowStoToken } from '@/lib/workflow-api';
import { getAppEnv } from '../../../shared/env-config';
import { getAppNameInitial } from './AppIcon';

export function formatDevAppCardDesc(app: Pick<DevAppSummary, 'pageType' | 'availability' | 'localReady' | 'source'>): string {
  const kind = app.pageType === 'assets' ? 'Assets' : 'Site';
  const availability = app.availability ?? (app.localReady ? 'local' : 'remote-only');
  const state =
    availability === 'local'
      ? (app.source === 'imported' ? '本地导入' : '本机可编辑')
      : availability === 'path-missing'
        ? '目录失效，需重新拉取'
        : '仅云端，需拉取到本地';
  return `${kind} · ${state}`;
}

interface DevAppCardProps {
  app: DevAppSummary;
}

export function DevAppCard({ app }: DevAppCardProps) {
  const pageTypeLabel = app.pageType === 'assets' ? 'Assets' : 'Site';
  const openOrFocusDevAppTab = useAppPlazaShellStore((s) => s.openOrFocusDevAppTab);
  const closeDevAppTabsByWorkspaceId = useAppPlazaShellStore((s) => s.closeDevAppTabsByWorkspaceId);
  const unregisterWorkspaceId = useAppDevCatalogStore((s) => s.unregisterWorkspaceId);
  const refreshCatalog = useAppDevCatalogStore((s) => s.refresh);

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLocal, setDeleteLocal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cloning, setCloning] = useState(false);

  const localReady = app.localReady && Boolean(app.workspaceId);
  const availability = app.availability ?? (localReady ? 'local' : 'remote-only');
  const isCloudApp = Boolean(app.appCode);
  const canDelete = isCloudApp || Boolean(app.workspaceId);

  const handleEdit = () => {
    if (!localReady) {
      void handleClone();
      return;
    }
    openOrFocusDevAppTab(app.workspaceId, app.name);
  };

  const handleClone = async () => {
    if (cloning) return;
    if (!app.appCode) {
      toast.error('缺少 appCode，无法拉取');
      return;
    }
    setCloning(true);
    try {
      toast.message('请选择拉取到的父目录');
      const parentDir = await pickProjectFolder();
      if (!parentDir) {
        toast.message('已取消拉取');
        return;
      }
      const result = await cloneDevApp({
        appCode: app.appCode,
        applicationName: app.name,
        parentDir,
      });
      useAppDevCatalogStore.getState().registerWorkspaceId(result.workspaceId);
      await useSessionCatalogStore.getState().refreshWorkspaces().catch(() => undefined);
      await refreshCatalog();
      openOrFocusDevAppTab(result.workspaceId, result.workspaceName);
      toast.success(`已拉取「${result.workspaceName}」到本地`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '拉取失败');
    } finally {
      setCloning(false);
    }
  };

  const previewUrl = app.previewUrl?.trim() ?? '';
  const canOpenPreview = isHttpUrl(previewUrl);

  const handleOpenPreview = () => {
    if (!canOpenPreview) {
      toast.message('暂无预览地址');
      return;
    }
    openExternalUrl(previewUrl);
  };

  const handleOpenPermissions = async () => {
    if (!app.appCode) {
      toast.message('缺少 appCode，无法打开权限配置');
      return;
    }
    const env = getAppEnv();
    const permissionsUrl = buildAppPermissionsUrl(app.appCode, env, app.permissionsUrl);
    const callbackUrl = buildAppPermissionsCallbackUrl(permissionsUrl);
    const stoToken = getWorkflowStoToken();
    if (!stoToken) {
      toast.error('当前登录缺少 StoToken，请重新登录后再试');
      return;
    }
    openInSclawBrowser({
      url: buildDirectAppPermissionsLoginUrl(callbackUrl, stoToken),
      title: `${app.name} · 权限配置`,
      appId: `dev-app-permissions:${app.appCode}`,
      sourceUrl: callbackUrl,
      systemCode: 'SCLAW_PORTAL',
      skipLoginEligible: false,
    });
  };

  const handleReveal = async () => {
    if (!app.appPath) {
      toast.message('本地尚无目录，请先拉取');
      return;
    }
    try {
      await invokeIpc('shell:showItemInFolder', app.appPath);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    if (!app.appCode && !app.workspaceId) {
      toast.error('无法删除该应用');
      return;
    }
    setDeleting(true);
    try {
      const shouldDeleteLocal = deleteLocal && Boolean(app.appPath || app.workspaceId);
      const result = await deleteDevApp({
        appCode: app.appCode,
        workspaceId: app.workspaceId,
        deleteLocal: shouldDeleteLocal,
      });
      if ((result.deletedLocal || !isCloudApp) && app.workspaceId) {
        closeDevAppTabsByWorkspaceId(app.workspaceId);
        unregisterWorkspaceId(app.workspaceId);
      }
      await refreshCatalog();
      if (!isCloudApp) {
        toast.success(
          result.deletedFiles ? '已从列表移除，本地应用已删除' : '已从开发应用列表移除（本地文件已保留）',
        );
      } else {
        toast.success(
          result.deletedLocal ? '应用已下线，本地应用已删除' : '应用已下线（本地文件已保留）',
        );
      }
      setDeleteOpen(false);
      setDeleteLocal(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const statusLabel =
    availability === 'local'
      ? '本机可编辑'
      : availability === 'path-missing'
        ? '本地目录失效，需重新拉取'
        : '仅云端，需拉取到本地';

  return (
    <article
      className={cn('more-apps-card more-apps-card--dev', menuOpen && 'more-apps-card--menu-open')}
      onClick={() => void handleEdit()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void handleEdit();
        }
      }}
    >
      <div className="more-apps-card__top">
        <div
          className="more-apps-card__icon--dev"
          aria-label={`应用类型：${pageTypeLabel}`}
          title={`${pageTypeLabel} · ${statusLabel}`}
        >
          <span className="more-apps-card__icon-letter" aria-hidden>
            {getAppNameInitial(app.name)}
          </span>
        </div>
        <div className="more-apps-card__head more-apps-card__head--dev">
          <h3 className="more-apps-card__title">{app.name}</h3>
          <p className="more-apps-card__desc more-apps-card__desc--dev">
            {formatDevAppCardDesc(app)}
          </p>
        </div>
      </div>

      <div className="more-apps-card__foot more-apps-card__foot--dev">
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
          <DropdownMenuContent align="start" className="min-w-[160px]" onClick={(e) => e.stopPropagation()}>
            {localReady ? (
              <DropdownMenuItem onClick={() => void handleEdit()}>
                <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden />
                编辑应用
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled={cloning} onClick={() => void handleClone()}>
                <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
                拉取到本地
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={!app.appPath} onClick={() => void handleReveal()}>
              <FolderOpen className="mr-2 h-3.5 w-3.5" aria-hidden />
              在访达中打开
            </DropdownMenuItem>
            {app.pageType === 'site' ? (
              <DropdownMenuItem disabled={!canOpenPreview} onClick={() => handleOpenPreview()}>
                <ExternalLink className="mr-2 h-3.5 w-3.5" aria-hidden />
                系统浏览器打开
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem disabled={!app.appCode} onClick={() => void handleOpenPermissions()}>
              <ShieldCheck className="mr-2 h-3.5 w-3.5" aria-hidden />
              权限配置
            </DropdownMenuItem>
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => {
                    setDeleteLocal(false);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden />
                  删除应用
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="more-apps-card__primary-action"
          disabled={cloning}
          onClick={(e) => {
            e.stopPropagation();
            void handleEdit();
          }}
        >
          {cloning ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {cloning ? '拉取中…' : localReady ? '继续编辑' : '拉取到本地'}
        </button>
      </div>

      {deleteOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.42)] p-4 dark:bg-black/60"
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
                  'w-full max-w-[420px] overflow-hidden rounded-[12px] border border-border bg-background p-5',
                  'shadow-[0_12px_40px_rgba(15,23,42,0.12)]',
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <h2
                  id="dev-app-delete-title"
                  className="text-[16px] font-semibold leading-tight text-foreground"
                >
                  删除应用
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  {isCloudApp
                    ? `确定软删除「${app.name}」吗？云端应用将下线，不再出现在列表中。`
                    : `确定从开发应用列表移除「${app.name}」吗？不会提交或发布到云端。`}
                </p>
                {app.appPath || app.workspaceId ? (
                  <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                      checked={deleteLocal}
                      disabled={deleting}
                      onChange={(e) => setDeleteLocal(e.target.checked)}
                    />
                    <span className="min-w-0 text-[13px] leading-relaxed text-foreground">
                      同时删除本地应用
                      {app.appPath ? (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={app.appPath}>
                          {app.appPath}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ) : null}
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
