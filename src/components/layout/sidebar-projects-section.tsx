/**
 * SidebarProjectsSection — 项目树：标题行 + 项目文件夹 + 嵌套会话。
 * 项目仅支持行内重命名（不支持改路径）。项目内「新建」跳转首页并带上项目，不插侧栏草稿行。
 * 当前会话或首页草稿绑定项目时，自动展开对应项目并滚到会话行。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Folder, FolderPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  sidebarListItemTextClass,
  sidebarSectionLabelClass,
  sidebarSubitemTextIdleClass,
} from '@/lib/surfaces';
import { DEFAULT_WORKSPACE_ID, useSessionCatalogStore } from '@/stores/session-catalog';
import { useChatStore } from '@/stores/chat';
import { resolveSessionLabel } from '@/lib/session-label';
import { navigateToMainChatHome } from '@/lib/main-chat-navigation';
import {
  DEFAULT_SESSION_KEY,
  type ChatSession,
} from '@/stores/chat/types';
import { isSidebarHiddenChatSessionKey } from '@/lib/sto-task-session';
import { sortSessionsWithCatalogPin } from '@/lib/sidebar-recent-order';
import {
  resolveSidebarProjectFocus,
  sortProjectsByCreatedAt,
} from '@/lib/sidebar-project-session-navigation';
import { ProjectFormDialog } from '@/components/layout/sidebar-project-form-dialog';
import { SidebarProjectRowTrailing } from '@/components/layout/sidebar-project-row-trailing';
import { SidebarProjectSessionRow } from '@/components/layout/sidebar-project-session-row';
import { useSidebarDeleteConfirmStore } from '@/stores/sidebar-delete-confirm';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { invokeIpc } from '@/lib/api-client';
import type { WorkspaceDto } from '@/lib/session-catalog-api';

interface SidebarProjectsSectionProps {
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  onEnsureOpen?: () => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export function SidebarProjectsSection({
  collapsed,
  open,
  onToggle,
  onEnsureOpen,
  scrollContainerRef,
}: SidebarProjectsSectionProps) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const isOnHome = location.pathname === '/';

  const workspaces = useSessionCatalogStore((s) => s.workspaces);
  const allCatalogByKey = useSessionCatalogStore((s) => s.allCatalogByKey);
  const selectProject = useSessionCatalogStore((s) => s.selectProject);
  const sessionWorkspaceByKey = useSessionCatalogStore((s) => s.sessionWorkspaceByKey);
  const patchSessionCatalog = useSessionCatalogStore((s) => s.patchSessionCatalog);
  const updateProject = useSessionCatalogStore((s) => s.updateProject);
  const deleteProject = useSessionCatalogStore((s) => s.deleteProject);

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const pendingProjectId = useChatStore((s) => s.pendingProjectId);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const switchSession = useChatStore((s) => s.switchSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const newSession = useChatStore((s) => s.newSession);

  const requestSessionDelete = useSidebarDeleteConfirmStore((s) => s.requestSessionDelete);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceDto | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<string, boolean>>({});
  const [editingSessionKey, setEditingSessionKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectValue, setEditingProjectValue] = useState('');
  const sidebarProjectFocusTokenRef = useRef<string | null>(null);
  const focusSessionKeyRef = useRef<string | null>(null);
  const sortedWorkspaces = useMemo(
    () => sortProjectsByCreatedAt(workspaces),
    [workspaces],
  );

  const sessionsByProjectId = useMemo(() => {
    const map = new Map<string, ChatSession[]>();
    for (const workspace of workspaces) {
      const scoped = sessions.filter((session) => {
        if (isSidebarHiddenChatSessionKey(session.key)) return false;
        const workspaceId = sessionWorkspaceByKey[session.key] ?? DEFAULT_WORKSPACE_ID;
        return workspaceId === workspace.id;
      });
      map.set(
        workspace.id,
        sortSessionsWithCatalogPin(scoped, sessionLastActivity, allCatalogByKey),
      );
    }
    return map;
  }, [workspaces, sessions, sessionWorkspaceByKey, sessionLastActivity, allCatalogByKey]);

  const getSessionLabel = useCallback(
    (key: string, displayName?: string, label?: string) =>
      resolveSessionLabel({ key, displayName, label, sessionLabels, t }),
    [sessionLabels, t],
  );

  const toggleProjectExpand = useCallback((projectId: string) => {
    setExpandedProjectIds((prev) => ({ ...prev, [projectId]: !(prev[projectId] ?? false) }));
  }, []);

  const startProjectRename = useCallback((workspace: WorkspaceDto) => {
    setEditingSessionKey(null);
    setEditingProjectId(workspace.id);
    setEditingProjectValue(workspace.name);
  }, []);

  const commitProjectRename = useCallback(async () => {
    if (!editingProjectId) return;
    const workspace = workspaces.find((item) => item.id === editingProjectId);
    const trimmed = editingProjectValue.trim();
    setEditingProjectId(null);
    if (!workspace || !trimmed || trimmed === workspace.name) return;
    try {
      await updateProject(workspace.id, trimmed, workspace.rootPath);
    } catch (error) {
      toast.error(String(error));
    }
  }, [editingProjectId, editingProjectValue, updateProject, workspaces]);

  const handlePinInProject = useCallback(async (sessionKey: string) => {
    const currentPin = allCatalogByKey[sessionKey]?.pinRank ?? null;
    if (currentPin != null) {
      await patchSessionCatalog({ sessionKey, pinRank: null });
      toast.success(t('sidebar.unpinnedInProject'));
      return;
    }
    await patchSessionCatalog({ sessionKey, pinRank: 1 });
    toast.success(t('sidebar.pinnedInProject'));
  }, [allCatalogByKey, patchSessionCatalog, t]);

  const handleOpenProjectFolder = useCallback(async (rootPath: string) => {
    try {
      await invokeIpc('shell:showItemInFolder', rootPath);
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  /** 在指定项目下新建对话：跳转首页并带上项目（pendingProjectId + project agent），不在侧栏插「新对话」草稿行。 */
  const handleNewChatInProject = useCallback(async (projectId: string) => {
    try {
      await selectProject(projectId);
      setExpandedProjectIds((prev) => ({ ...prev, [projectId]: true }));
      await newSession({ projectId });
      navigateToMainChatHome(navigate, location.pathname);
    } catch (error) {
      toast.error(String(error));
    }
  }, [location.pathname, navigate, newSession, selectProject]);

  const linkedSessionCount = useCallback((projectId: string) => {
    let count = 0;
    for (const workspaceId of Object.values(sessionWorkspaceByKey)) {
      if (workspaceId === projectId) count += 1;
    }
    const visible = (sessionsByProjectId.get(projectId) ?? []).length;
    return Math.max(count, visible);
  }, [sessionWorkspaceByKey, sessionsByProjectId]);

  const handleConfirmDeleteProject = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const deleted = await deleteProject(deleteTarget.id);
      toast.success(
        deleted > 0
          ? t('sidebar.projectDeletedWithSessions', { count: deleted })
          : t('sidebar.projectDeleted'),
      );
      setDeleteTarget(null);
    } catch (error) {
      toast.error(String(error));
      throw error;
    }
  }, [deleteProject, deleteTarget, t]);

  useEffect(() => {
    if (collapsed) return;

    const focus = resolveSidebarProjectFocus({
      currentSessionKey,
      pendingProjectId,
      sessionWorkspaceByKey,
      defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
      defaultSessionKey: DEFAULT_SESSION_KEY,
    });
    if (!focus) {
      sidebarProjectFocusTokenRef.current = null;
      focusSessionKeyRef.current = null;
      return;
    }

    const activity = focus.sessionKey ? (sessionLastActivity[focus.sessionKey] ?? 0) : 0;
    const focusToken = `${focus.projectId}:${focus.sessionKey ?? 'draft'}:${activity}:${pendingProjectId ?? ''}`;
    focusSessionKeyRef.current = focus.sessionKey;
    if (sidebarProjectFocusTokenRef.current === focusToken) return;
    sidebarProjectFocusTokenRef.current = focusToken;

    onEnsureOpen?.();
    setExpandedProjectIds((prev) => ({ ...prev, [focus.projectId]: true }));
  }, [
    collapsed,
    currentSessionKey,
    pendingProjectId,
    sessionWorkspaceByKey,
    sessionLastActivity,
    onEnsureOpen,
  ]);

  useLayoutEffect(() => {
    if (collapsed || !open) return;
    const focusSessionKey = focusSessionKeyRef.current;
    if (!focusSessionKey || focusSessionKey === DEFAULT_SESSION_KEY) return;
    const projectId = sessionWorkspaceByKey[focusSessionKey] ?? pendingProjectId;
    if (!projectId || !(expandedProjectIds[projectId] ?? false)) return;

    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      const container = scrollContainerRef?.current;
      const el = container?.querySelector(
        `[data-sidebar-project-session="${CSS.escape(focusSessionKey)}"]`,
      );
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [
    collapsed,
    open,
    expandedProjectIds,
    sessionWorkspaceByKey,
    pendingProjectId,
    currentSessionKey,
    sessionLastActivity,
    scrollContainerRef,
  ]);

  if (collapsed) {
    return <div className="mx-auto mt-2 h-px w-8 bg-[var(--sto-sidebar-border)]" aria-hidden />;
  }

  return (
    <>
      <div className="mt-4 flex h-[30px] w-full items-center justify-between px-[10px]">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={cn(
            'inline-flex min-w-0 items-center gap-1 text-left transition-colors',
            sidebarSectionLabelClass,
          )}
        >
          <span className="truncate">{t('sidebar.projects')}</span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !open && '-rotate-90')}
            aria-hidden
          />
        </button>
        <button
          type="button"
          aria-label={t('sidebar.newProject')}
          onClick={() => setCreateOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--sto-sidebar-row-hover-bg)]"
        >
          <FolderPlus className="h-4 w-4" />
        </button>
      </div>

      {open ? (
        <div className="mt-0.5 flex flex-col gap-0.5 pb-1">
          {sortedWorkspaces.map((workspace) => {
            const isExpanded = expandedProjectIds[workspace.id] ?? false;
            const projectSessions = sessionsByProjectId.get(workspace.id) ?? [];
            const isEditingProject = editingProjectId === workspace.id;

            return (
              <div key={workspace.id} className="flex flex-col">
                <div className="group relative flex w-full min-w-0 items-center">
                  {isEditingProject ? (
                    <input
                      type="text"
                      autoFocus
                      value={editingProjectValue}
                      aria-label={t('actions.rename')}
                      onChange={(e) => setEditingProjectValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitProjectRename();
                        else if (e.key === 'Escape') setEditingProjectId(null);
                      }}
                      onBlur={() => {
                        void commitProjectRename();
                      }}
                      className="w-full rounded-[8px] border border-[var(--sto-brand-6)] bg-card px-[10px] py-[6px] pr-16 text-left text-sm leading-5 text-foreground outline-none"
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        title={`${workspace.name}\n${workspace.rootPath}`}
                        onClick={() => toggleProjectExpand(workspace.id)}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          startProjectRename(workspace);
                        }}
                        className={cn(
                          'flex h-9 min-w-0 w-full flex-1 items-center gap-2 rounded-lg px-[10px] py-2 pr-16 text-left transition-colors',
                          sidebarSubitemTextIdleClass,
                        )}
                      >
                        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className={cn('min-w-0 flex-1 truncate', sidebarListItemTextClass)}>
                          {workspace.name}
                        </span>
                      </button>
                      <SidebarProjectRowTrailing
                        onNewChat={() => {
                          void handleNewChatInProject(workspace.id);
                        }}
                        onRename={() => startProjectRename(workspace)}
                        onOpenFolder={() => {
                          void handleOpenProjectFolder(workspace.rootPath);
                        }}
                        onDelete={() => setDeleteTarget(workspace)}
                      />
                    </>
                  )}
                </div>

                {isExpanded && projectSessions.length > 0 ? (
                  <div className="mb-0.5 flex flex-col gap-0.5">
                    {projectSessions.map((session) => {
                      const label = getSessionLabel(session.key, session.displayName, session.label);
                      const isActive = isOnHome
                        && currentSessionKey === session.key
                        && currentSessionKey !== DEFAULT_SESSION_KEY;
                      const isPinned = allCatalogByKey[session.key]?.pinRank != null;
                      return (
                        <div
                          key={session.key}
                          data-sidebar-project-session={session.key}
                        >
                          <SidebarProjectSessionRow
                            session={session}
                            label={label}
                            isActive={isActive}
                            isPinned={isPinned}
                            isEditing={editingSessionKey === session.key}
                            editingValue={editingValue}
                            onOpen={() => {
                              void selectProject(workspace.id);
                              navigateToMainChatHome(navigate, location.pathname, () => switchSession(session.key));
                            }}
                            onPin={() => {
                              void handlePinInProject(session.key);
                            }}
                            onStartRename={() => {
                              setEditingProjectId(null);
                              setEditingSessionKey(session.key);
                              setEditingValue(label);
                            }}
                            onEditingValueChange={setEditingValue}
                            onCommitRename={() => {
                              renameSession(session.key, editingValue);
                              setEditingSessionKey(null);
                            }}
                            onCancelRename={() => setEditingSessionKey(null)}
                            onDelete={() => {
                              requestSessionDelete({ key: session.key, label });
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {createOpen ? (
        <ProjectFormDialog
          open
          onClose={() => setCreateOpen(false)}
          onCreated={(workspace) => {
            setExpandedProjectIds((prev) => ({ ...prev, [workspace.id]: true }));
          }}
        />
      ) : null}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('sidebar.deleteProjectTitle')}
        message={
          deleteTarget && linkedSessionCount(deleteTarget.id) > 0
            ? t('sidebar.deleteProjectMessageWithSessions', {
                name: deleteTarget.name,
                count: linkedSessionCount(deleteTarget.id),
              })
            : t('sidebar.deleteProjectMessage', { name: deleteTarget?.name ?? '' })
        }
        confirmLabel={t('actions.delete')}
        cancelLabel={t('actions.cancel')}
        variant="destructive"
        onConfirm={handleConfirmDeleteProject}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
