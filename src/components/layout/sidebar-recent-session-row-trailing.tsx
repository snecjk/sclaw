/**
 * SidebarRecentSessionRowTrailing — 最近会话行尾：状态位 + hover「...」菜单（重命名 / 移至项目 / 删除）。
 */
import {
  ChevronRight,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarRecentSessionStatus } from '@/components/layout/sidebar-recent-session-status';
import { cn } from '@/lib/utils';
import {
  sidebarRecentMenuContentClass,
  sidebarRecentMenuDeleteItemClass,
  sidebarRecentMenuDividerClass,
  sidebarRecentMenuItemClass,
  sidebarTextIconClass,
} from '@/lib/surfaces';
import type { WorkspaceDto } from '@/lib/session-catalog-api';

export interface SidebarRecentSessionRowTrailingProps {
  sessionKey: string;
  isActive?: boolean;
  projects: WorkspaceDto[];
  currentProjectId: string | null;
  isInProject: boolean;
  onRename: () => void;
  onDelete: () => void;
  onMoveToProject: (projectId: string) => void;
  onRemoveFromProject: () => void;
  onCreateProject: () => void;
  className?: string;
}

const SIDEBAR_RECENT_ROW_TRAILING_W_CLASS = 'w-12';

export function SidebarRecentSessionRowTrailing({
  sessionKey,
  isActive = false,
  projects,
  currentProjectId,
  isInProject,
  onRename,
  onDelete,
  onMoveToProject,
  onRemoveFromProject,
  onCreateProject,
  className,
}: SidebarRecentSessionRowTrailingProps) {
  const { t } = useTranslation('common');
  const assignableProjects = projects.filter((project) => project.id !== currentProjectId);

  return (
    <div
      className={cn(
        'absolute right-[10px] top-1/2 flex -translate-y-1/2 items-center justify-end',
        SIDEBAR_RECENT_ROW_TRAILING_W_CLASS,
        className,
      )}
    >
      <div
        className={cn(
          'pointer-events-none flex h-5 w-full items-center justify-end',
          'transition-opacity group-hover:opacity-0 group-hover:invisible',
        )}
      >
        <SidebarRecentSessionStatus sessionKey={sessionKey} />
      </div>
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-end',
          'invisible opacity-0 transition-opacity group-hover:visible group-hover:opacity-100',
          'rounded-md',
          isActive
            ? 'bg-[var(--sto-sidebar-subitem-active-bg)] group-hover:bg-[var(--sto-sidebar-row-hover-bg)]'
            : 'bg-[var(--sto-sidebar-bg)] group-hover:bg-[var(--sto-sidebar-row-hover-bg)]',
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('sidebar.sessionRowMenu')}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md',
                sidebarTextIconClass,
                'hover:bg-black/[0.04]',
              )}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={sidebarRecentMenuContentClass}>
            <DropdownMenuItem
              className={sidebarRecentMenuItemClass}
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
            >
              <Pencil className="h-4 w-4 shrink-0" aria-hidden />
              {t('actions.rename')}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={sidebarRecentMenuItemClass}>
                <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1 truncate">{t('sidebar.moveToProject')}</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={sidebarRecentMenuContentClass}>
                <DropdownMenuItem
                  className={cn(sidebarRecentMenuItemClass, 'justify-start')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateProject();
                  }}
                >
                  <FolderPlus className="h-4 w-4 shrink-0" aria-hidden />
                  {t('sidebar.newProject')}
                </DropdownMenuItem>
                {isInProject || assignableProjects.length > 0 ? (
                  <DropdownMenuSeparator className={sidebarRecentMenuDividerClass} />
                ) : null}
                {isInProject ? (
                  <DropdownMenuItem
                    className={cn(sidebarRecentMenuItemClass, 'justify-start')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFromProject();
                    }}
                  >
                    {t('sidebar.removeFromProject')}
                  </DropdownMenuItem>
                ) : null}
                {assignableProjects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    className={cn(sidebarRecentMenuItemClass, 'justify-start')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveToProject(project.id);
                    }}
                  >
                    <span
                      className="min-w-0 max-w-[10em] truncate text-left"
                      title={project.name}
                    >
                      {project.name}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              className={sidebarRecentMenuDeleteItemClass}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
              {t('actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
