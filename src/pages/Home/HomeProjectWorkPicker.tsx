/**
 * HomeProjectWorkPicker — 新对话落地页「进入项目工作」选择条。
 * 结构约定：父级灰底圆角壳内，输入框为独立白底圆角边框；本组件白底、无圆角、无描边。
 */
import { useMemo, useState } from 'react';
import { Check, ChevronDown, Folder, FolderInput, FolderMinus, FolderPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { sortProjectsByCreatedAt } from '@/lib/sidebar-project-session-navigation';
import { ProjectFormDialog } from '@/components/layout/sidebar-project-form-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatStore } from '@/stores/chat';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { useSessionCatalogStore } from '@/stores/session-catalog';
import { getBaseAgentIdFromProjectAgentId } from '../../../shared/project-agent';
import type { WorkspaceDto } from '@/lib/session-catalog-api';

function folderNameFromPath(path: string): string {
  const normalized = path.replace(/[/\\]+$/, '');
  const parts = normalized.split(/[/\\]/);
  return parts[parts.length - 1] || normalized;
}

async function enterProjectDraft(projectId: string): Promise<void> {
  await useSessionCatalogStore.getState().selectProject(projectId);
  useChatStore.getState().newSession({ projectId });
}

function clearProjectDraft(): void {
  const { currentAgentId, setPendingProjectId } = useChatStore.getState();
  const baseAgentId = getBaseAgentIdFromProjectAgentId(currentAgentId) ?? 'main';
  setPendingProjectId(null);
  useChatStore.setState({
    currentSessionKey: DEFAULT_SESSION_KEY,
    currentAgentId: baseAgentId,
    messages: [],
  });
  void useSessionCatalogStore.getState().selectProject(null);
}

export function HomeProjectWorkPicker({ className }: { className?: string }) {
  const { t } = useTranslation('home');
  const { t: tc } = useTranslation('common');
  const workspaces = useSessionCatalogStore((s) => s.workspaces);
  const createProject = useSessionCatalogStore((s) => s.createProject);
  const pickFolder = useSessionCatalogStore((s) => s.pickFolder);
  const pendingProjectId = useChatStore((s) => s.pendingProjectId);
  const [createOpen, setCreateOpen] = useState(false);
  const [usingExisting, setUsingExisting] = useState(false);

  const sortedWorkspaces = useMemo(
    () => sortProjectsByCreatedAt(workspaces),
    [workspaces],
  );
  const selectedProject = useMemo(
    () => sortedWorkspaces.find((workspace) => workspace.id === pendingProjectId) ?? null,
    [pendingProjectId, sortedWorkspaces],
  );

  const handleSelectProject = async (projectId: string) => {
    try {
      await enterProjectDraft(projectId);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleUseExistingFolder = async () => {
    setUsingExisting(true);
    try {
      const rootPath = await pickFolder();
      if (!rootPath) return;
      const created = await createProject(folderNameFromPath(rootPath), rootPath);
      if (!created) return;
      toast.success(tc('sidebar.projectCreated'));
      await enterProjectDraft(created.id);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setUsingExisting(false);
    }
  };

  const handleCreated = async (workspace: WorkspaceDto) => {
    try {
      await enterProjectDraft(workspace.id);
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={usingExisting}
            className={cn(
              'flex h-9 w-full items-center gap-2 bg-transparent px-5 pb-2 text-left',
              'text-sm text-muted-foreground',
              'outline-none ring-0',
              'focus:outline-none focus-visible:outline-none focus-visible:ring-0',
              'data-[state=open]:bg-transparent data-[state=open]:outline-none data-[state=open]:ring-0',
              'disabled:opacity-60',
              selectedProject && 'text-foreground',
              className,
            )}
            aria-label={t('projectWork.enter')}
          >
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate">
              {selectedProject ? selectedProject.name : t('projectWork.enter')}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[240px]"
        >
          {sortedWorkspaces.map((workspace) => {
            const selected = workspace.id === pendingProjectId;
            return (
              <DropdownMenuItem
                key={workspace.id}
                className="gap-2"
                onSelect={() => {
                  void handleSelectProject(workspace.id);
                }}
              >
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                {selected ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
              </DropdownMenuItem>
            );
          })}
          {sortedWorkspaces.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => {
              setCreateOpen(true);
            }}
          >
            <FolderPlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t('projectWork.createBlank')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            disabled={usingExisting}
            onSelect={() => {
              void handleUseExistingFolder();
            }}
          >
            <FolderInput className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t('projectWork.useExistingFolder')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            disabled={!pendingProjectId}
            onSelect={() => {
              clearProjectDraft();
            }}
          >
            <FolderMinus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t('projectWork.clearFolder')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {createOpen ? (
        <ProjectFormDialog
          open
          onClose={() => setCreateOpen(false)}
          onCreated={(workspace) => {
            void handleCreated(workspace);
          }}
        />
      ) : null}
    </>
  );
}
