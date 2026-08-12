import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2, ChevronDown, Check, Folder, FolderPlus, ArrowLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { SchedulePicker, type ScheduleValue } from './SchedulePicker';
import {
  scheduleValueToCron,
  cronToScheduleValue,
  defaultScheduleValue,
} from '../lib/schedule-utils';
import {
  stripInstructionFromTaskMessage,
  resolveScheduledTaskMentions,
  prepareDingTalkAgentTurnMessage,
} from '@/lib/scheduled-task-recipients';
import { useMyTaskStore } from '../store';
import { cn } from '@/lib/utils';
import {
  dropdownOptionClass,
  dropdownPanelClass,
  formFieldFocusClass,
  formFieldHoverBorderClass,
  formFieldOpenClass,
  invertedPrimarySurfaceClass,
  modalPrimarySubmitButtonClass,
} from '@/lib/surfaces';
import type { CronJobCreateInput } from '@/types/cron';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { ClaudeTaskPermissionProfile } from '@/types/scheduled-task';
import type { ManagedLocalTask } from '@/stores/cron';
import { createDataCenterFolder, deleteDataCenterEntry, getDataCenterEntry, getDataCenterSpaces, listDataCenterEntries, renameDataCenterEntry } from '@/lib/data-center-api';
import { useAuthStore, isSiteUser } from '@/stores/auth';
import type { DataCenterEntry, DataCenterSpace, DataCenterSpaceType } from '@/types/data-center';
import { toast } from 'sonner';
import { TaskInstructionComposer } from '@/components/task/TaskInstructionComposer';
import type { MentionComposerSnapshot } from '@/lib/dingtalk-mention-composer';

type TaskEngineType = 'openclaw' | 'claude';

export type TaskCreateInputWithRun = CronJobCreateInput & {
  engineType: TaskEngineType;
  claudeWorkspacePath?: string;
  claudePermissionProfile?: ClaudeTaskPermissionProfile;
};

interface TaskCreateModalProps {
  job?: ManagedLocalTask | null;
  open: boolean;
  onClose: () => void;
  onSave: (input: TaskCreateInputWithRun) => Promise<void>;
  initialValues?: { name?: string; message?: string; schedule?: string; workflowCode?: string };
}

interface TaskCreateModalInnerProps {
  job?: ManagedLocalTask | null;
  onClose: () => void;
  onSave: (input: TaskCreateInputWithRun) => Promise<void>;
  initialValues?: { name?: string; message?: string; schedule?: string; workflowCode?: string };
}

function buildWorkflowInstructions(workflowCode: string, label?: string, t?: (key: string, options?: Record<string, unknown>) => string): string {
  if (t) {
    return label
      ? t('myTask.createModal.buildWorkflowInstructions', { workflowCode, label })
      : t('myTask.createModal.buildWorkflowInstructionsNoLabel', { workflowCode });
  }
  return label
    ? `帮我执行 id 为：${workflowCode} 的工作流 【${label}】`
    : `帮我执行 id 为：${workflowCode} 的工作流`;
}

function computeInitialValues(
  job: ManagedLocalTask | null | undefined,
  initialValues: { name?: string; message?: string; schedule?: string; workflowCode?: string } | undefined
) {

  if (job) {
    return {
      name: job.name || '',
      instructions: stripInstructionFromTaskMessage(job.prompt || ''),
      schedule: cronToScheduleValue(job.cronExpr),
      recipients: (() => {
        const fromPrompt = resolveScheduledTaskMentions(job.prompt || '');
        if (fromPrompt.length > 0) return fromPrompt;
        return job.dingtalkRecipients ?? [];
      })(),
      engineType: job.engineType,
      selectedWorkflow: job.workflowCode || '',
      saveToDataCenter: !!(job.myArtifactFolderPath || job.sharedArtifactFolderPath),
      saveToMyArtifact: !!job.myArtifactFolderPath,
      saveToSharedArtifact: !!job.sharedArtifactFolderPath,
      myArtifactFolderPath: job.myArtifactFolderPath,
      sharedArtifactFolderPath: job.sharedArtifactFolderPath,
    };
  }

  if (initialValues) {
    return {
      name: initialValues.name || '',
      instructions: initialValues.message || '',
      schedule: initialValues.schedule
        ? cronToScheduleValue(initialValues.schedule)
        : defaultScheduleValue(),
      recipients: [] as DingTalkMention[],
      engineType: 'claude' as TaskEngineType,
      selectedWorkflow: initialValues.workflowCode || '',
      saveToDataCenter: false,
      saveToMyArtifact: false,
      saveToSharedArtifact: false,
      myArtifactFolderPath: null,
      sharedArtifactFolderPath: null,
    };
  }

  return {
    name: '',
    instructions: '',
    schedule: defaultScheduleValue(),
    recipients: [] as DingTalkMention[],
    engineType: 'claude' as TaskEngineType,
    selectedWorkflow: '',
    saveToDataCenter: false,
    saveToMyArtifact: false,
    saveToSharedArtifact: false,
    myArtifactFolderPath: null,
    sharedArtifactFolderPath: null,
  };
}

function buildDataCenterTargetUri(spaceType: string, spaceId: string | null, parentEntryId = 'root'): string {
  const encodedSpaceType = encodeURIComponent(spaceType);
  const encodedParent = encodeURIComponent(parentEntryId || 'root');
  return spaceId
    ? `data-center://${encodedSpaceType}/${encodeURIComponent(spaceId)}/${encodedParent}`
    : `data-center://${encodedSpaceType}/${encodedParent}`;
}

function parseDataCenterTargetUri(uri: string | null | undefined): { spaceType: string; spaceId: string | null; parentEntryId: string } {
  const trimmed = uri?.trim() || '';
  if (!trimmed.startsWith('data-center://')) {
    return { spaceType: '', spaceId: null, parentEntryId: 'root' };
  }
  const parts = trimmed.slice('data-center://'.length).split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (parts.length === 2) return { spaceType: parts[0], spaceId: null, parentEntryId: parts[1] || 'root' };
  if (parts.length >= 3) return { spaceType: parts[0], spaceId: parts[1] || null, parentEntryId: parts.slice(2).join('/') || 'root' };
  return { spaceType: '', spaceId: null, parentEntryId: 'root' };
}

function normalizePathBreadcrumbs(rootLabel: string, breadcrumbs: Array<{ name: string }> = []): string[] {
  const rootAliases = new Set([rootLabel, '问答产物', '我的产物', '网点共享产物']);
  const names = breadcrumbs.map((item) => item.name).filter(Boolean);
  if (names.length > 0 && rootAliases.has(names[0])) {
    return names.slice(1);
  }
  return names;
}

function buildPathLabel(rootLabel: string, breadcrumbs: Array<{ name: string }> = []): string {
  const names = normalizePathBreadcrumbs(rootLabel, breadcrumbs);
  if (names.length === 0) return `${rootLabel} / 根目录`;
  return [rootLabel, ...names].join(' / ');
}

async function resolvePathLabelFromTargetUri(uri: string | null | undefined, rootLabel: string): Promise<string> {
  const parsed = parseDataCenterTargetUri(uri);
  if (!parsed.parentEntryId || parsed.parentEntryId === 'root') return `${rootLabel} / 根目录`;
  try {
    const entry = await getDataCenterEntry(parsed.parentEntryId);
    if (entry.breadcrumbs?.length) {
      const breadcrumbs = [...entry.breadcrumbs];
      const last = breadcrumbs[breadcrumbs.length - 1];
      if (last?.entryId !== entry.entryId && entry.name) {
        breadcrumbs.push({ entryId: entry.entryId, name: entry.name });
      }
      return buildPathLabel(rootLabel, breadcrumbs);
    }
    return `${rootLabel} / ${entry.name || parsed.parentEntryId}`;
  } catch {
    return `${rootLabel} / ${parsed.parentEntryId}`;
  }
}

function isSiteSharedArtifactSpace(space: DataCenterSpace): boolean {
  const rawSpaceType = (space as { spaceType?: string }).spaceType;
  return rawSpaceType === 'site_shared_artifact'
    || space.scopeType === 'site'
    || space.displayName.includes('网点共享产物');
}

interface FolderPickerDialogProps {
  open: boolean;
  title: string;
  rootLabel: string;
  spaceType: DataCenterSpaceType;
  spaceId?: string | null;
  initialParentEntryId?: string;
  onClose: () => void;
  onSelect: (selection: { parentEntryId: string; pathLabel: string }) => void;
}

function FolderPickerDialog({
  open,
  title,
  rootLabel,
  spaceType,
  spaceId,
  initialParentEntryId = 'root',
  onClose,
  onSelect,
}: FolderPickerDialogProps) {
  const [parentEntryId, setParentEntryId] = useState(initialParentEntryId || 'root');
  const [folders, setFolders] = useState<DataCenterEntry[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ entryId: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ folder: DataCenterEntry; x: number; y: number } | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<DataCenterEntry | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState<DataCenterEntry | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setParentEntryId(initialParentEntryId || 'root');
  }, [open, initialParentEntryId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listDataCenterEntries({
      spaceType,
      spaceId: spaceId || undefined,
      parentEntryId,
      entryType: 'folder',
      pageSize: 100,
      sortField: 'name',
      sortOrder: 'asc',
    })
      .then((result) => {
        if (cancelled) return;
        setFolders(result.items.filter((item) => item.entryType === 'folder'));
        setBreadcrumbs(result.breadcrumbs ?? []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setFolders([]);
        setBreadcrumbs([]);
        setError(String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, spaceType, spaceId, parentEntryId, refreshKey]);

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || createSubmitting) return;
    setCreateSubmitting(true);
    try {
      await createDataCenterFolder({
        spaceType,
        spaceId: spaceId || undefined,
        parentEntryId,
        name,
      });
      setNewFolderName('');
      setCreatingFolder(false);
      setRefreshKey((key) => key + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '新建文件夹失败');
    } finally {
      setCreateSubmitting(false);
    }
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const handleRenameFolder = async () => {
    const name = renameName.trim();
    if (!renamingFolder || !name || renameSubmitting) return;
    setRenameSubmitting(true);
    try {
      await renameDataCenterEntry(renamingFolder.entryId, name);
      setRenamingFolder(null);
      setRenameName('');
      setRefreshKey((key) => key + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重命名失败');
    } finally {
      setRenameSubmitting(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!deletingFolder || deleteSubmitting) return;
    setDeleteSubmitting(true);
    try {
      await deleteDataCenterEntry(deletingFolder.entryId);
      setDeletingFolder(null);
      setRefreshKey((key) => key + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  if (!open) return null;

  const currentLabel = buildPathLabel(rootLabel, breadcrumbs);
  const canGoBack = breadcrumbs.length > 0 || parentEntryId !== 'root';
  const parentBreadcrumb = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : null;

  return (
    <>
      <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/35 px-4" onClick={onClose}>
      <div
        className="flex max-h-[min(560px,calc(100vh-4rem))] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground">{title}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{currentLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-4 py-2">
          <button
            type="button"
            disabled={!canGoBack}
            onClick={() => setParentEntryId(parentBreadcrumb?.entryId || 'root')}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回
          </button>
          <button
            type="button"
            onClick={() => setParentEntryId('root')}
            className="h-8 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            根目录
          </button>
        </div>

        <div className="min-h-[220px] flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载目录中
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
          ) : folders.length === 0 ? (
            <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">当前目录没有子文件夹</div>
          ) : (
            <div className="flex flex-col gap-1">
              {folders.map((folder) => (
                <button
                  key={folder.entryId}
                  type="button"
                  onClick={() => setParentEntryId(folder.entryId)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ folder, x: event.clientX, y: event.clientY });
                  }}
                  className="flex h-10 items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-muted"
                >
                  <Folder className="h-4 w-4 shrink-0 text-[#4E7FFF]" />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{folder.name}</span>
                  <ChevronDown className="-rotate-90 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-3">
          <button
            type="button"
            onClick={() => setCreatingFolder(true)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <FolderPlus className="h-4 w-4" />
            新建文件夹
          </button>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={onClose} className="h-9 rounded-[10px] px-4 text-sm">取消</Button>
            <Button
              onClick={() => onSelect({ parentEntryId, pathLabel: currentLabel })}
              className={cn('h-9 rounded-[10px] px-4 text-sm', invertedPrimarySurfaceClass)}
            >
              选择当前目录
            </Button>
          </div>
        </div>
      </div>
    </div>

      {creatingFolder ? (
        <div
          className="fixed inset-0 z-[10070] flex items-center justify-center bg-black/35 px-6"
          onClick={() => {
            if (createSubmitting) return;
            setCreatingFolder(false);
            setNewFolderName('');
          }}
        >
          <div
            className="w-full max-w-[360px] rounded-2xl border border-border bg-background p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 className="text-base font-semibold text-foreground">新建文件夹</h4>
            <input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleCreateFolder();
                if (event.key === 'Escape' && !createSubmitting) {
                  setCreatingFolder(false);
                  setNewFolderName('');
                }
              }}
              placeholder="请输入文件夹名称"
              className="mt-3 h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={createSubmitting}
                onClick={() => {
                  setCreatingFolder(false);
                  setNewFolderName('');
                }}
                className="h-9 rounded-[10px] px-4 text-sm"
              >
                取消
              </Button>
              <Button
                onClick={() => void handleCreateFolder()}
                disabled={!newFolderName.trim() || createSubmitting}
                className={cn('h-9 rounded-[10px] px-4 text-sm', invertedPrimarySurfaceClass)}
              >
                {createSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '确定'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="fixed z-[10080] min-w-[128px] rounded-[10px] border border-[#E5E6EB] bg-white p-2 text-[#1D2129] shadow-[0_8px_24px_rgba(15,23,42,0.14)] dark:border-border dark:bg-popover dark:text-foreground"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="block h-9 w-full rounded-[6px] px-3 text-left text-[13px] leading-9 hover:bg-[#F2F3F5] dark:hover:bg-muted"
            onClick={() => {
              setContextMenu(null);
              setRenamingFolder(contextMenu.folder);
              setRenameName(contextMenu.folder.name);
            }}
          >
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            className="block h-9 w-full rounded-[6px] px-3 text-left text-[13px] leading-9 text-[#F53F3F] hover:bg-[#F2F3F5] dark:hover:bg-muted"
            onClick={() => {
              setContextMenu(null);
              setDeletingFolder(contextMenu.folder);
            }}
          >
            删除
          </button>
        </div>
      ) : null}

      {renamingFolder ? (
        <div
          className="fixed inset-0 z-[10070] flex items-center justify-center bg-black/35 px-6"
          onClick={() => {
            if (renameSubmitting) return;
            setRenamingFolder(null);
            setRenameName('');
          }}
        >
          <div
            className="w-full max-w-[360px] rounded-2xl border border-border bg-background p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 className="text-base font-semibold text-foreground">重命名文件夹</h4>
            <input
              autoFocus
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleRenameFolder();
                if (event.key === 'Escape' && !renameSubmitting) {
                  setRenamingFolder(null);
                  setRenameName('');
                }
              }}
              placeholder="请输入文件夹名称"
              className="mt-3 h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={renameSubmitting}
                onClick={() => {
                  setRenamingFolder(null);
                  setRenameName('');
                }}
                className="h-9 rounded-[10px] px-4 text-sm"
              >
                取消
              </Button>
              <Button
                onClick={() => void handleRenameFolder()}
                disabled={!renameName.trim() || renameSubmitting}
                className={cn('h-9 rounded-[10px] px-4 text-sm', invertedPrimarySurfaceClass)}
              >
                {renameSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '确定'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {deletingFolder ? (
        <div
          className="fixed inset-0 z-[10070] flex items-center justify-center bg-black/35 px-6"
          onClick={() => {
            if (deleteSubmitting) return;
            setDeletingFolder(null);
          }}
        >
          <div
            className="w-full max-w-[360px] rounded-2xl border border-border bg-background p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 className="text-base font-semibold text-foreground">删除文件夹</h4>
            <p className="mt-3 text-sm text-muted-foreground">
              确定要删除文件夹“{deletingFolder.name}”吗？
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={deleteSubmitting}
                onClick={() => setDeletingFolder(null)}
                className="h-9 rounded-[10px] px-4 text-sm"
              >
                取消
              </Button>
              <Button
                onClick={() => void handleDeleteFolder()}
                disabled={deleteSubmitting}
                className="h-9 rounded-[10px] bg-[#F53F3F] px-4 text-sm text-white hover:bg-[#E23B3B]"
              >
                {deleteSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '删除'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function TaskCreateModal({
  job,
  open,
  onClose,
  onSave,
  initialValues,
}: TaskCreateModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <TaskCreateModalInner
          key={
            job?.id ??
            `create:${initialValues?.workflowCode ?? initialValues?.message ?? '__create__'}`
          }
          job={job}
          onClose={onClose}
          onSave={onSave}
          initialValues={initialValues}
        />
      )}
    </AnimatePresence>
  );
}

function TaskCreateModalInner({ job, onClose, onSave, initialValues }: TaskCreateModalInnerProps) {
  const { t } = useTranslation('tasks');
  const authUser = useAuthStore((s) => s.user);
  const siteDepartmentTypes = useAuthStore((s) => s.siteDepartmentTypes);
  const isSite = siteDepartmentTypes !== null && isSiteUser(authUser?.categoryCode);
  const fetchWorkflows = useMyTaskStore((s) => s.fetchWorkflows);
  const workflowOptions = useMyTaskStore((s) => s.workflowOptions);

  useEffect(() => {
    fetchWorkflows().catch(() => {});
  }, [fetchWorkflows]);

  const init = computeInitialValues(job, initialValues);

  // 预选工作流但未带 instructions 时，按 dropdown 选中分支同源逻辑补模板文本，
  // 避免 workflowDisabled 锁死空指令框导致校验失败。
  const correctedInstructions =
    init.selectedWorkflow && !init.instructions
      ? buildWorkflowInstructions(
          init.selectedWorkflow,
          workflowOptions.find((o) => o.value === init.selectedWorkflow)?.label,
          t,
        )
      : init.instructions;

  const [name, setName] = useState(init.name);
  const [instructions, setInstructions] = useState(correctedInstructions);
  const [schedule, setSchedule] = useState<ScheduleValue>(init.schedule);
  const [saving, setSaving] = useState(false);
  const [instructionMentions, setInstructionMentions] = useState<DingTalkMention[]>(init.recipients);
  const [errors, setErrors] = useState<{ name?: string; instructions?: string; dataCenterTarget?: string }>({});
  const [engineType, setEngineType] = useState<TaskEngineType>(init.engineType);
  const [saveToDataCenter, setSaveToDataCenter] = useState(init.saveToDataCenter);
  const [saveToMyArtifact, setSaveToMyArtifact] = useState(init.saveToMyArtifact);
  const [saveToSharedArtifact, setSaveToSharedArtifact] = useState(init.saveToSharedArtifact);
  const [myArtifactFolderPath, setMyArtifactFolderPath] = useState<string | null>(init.myArtifactFolderPath);
  const [sharedArtifactFolderPath, setSharedArtifactFolderPath] = useState<string | null>(init.sharedArtifactFolderPath);
  const [myArtifactPathLabel, setMyArtifactPathLabel] = useState(() => {
    const parsed = parseDataCenterTargetUri(init.myArtifactFolderPath);
    return parsed.parentEntryId === 'root' ? '我的产物 / 根目录' : `我的产物 / ${parsed.parentEntryId}`;
  });
  const [sharedArtifactPathLabel, setSharedArtifactPathLabel] = useState(() => {
    const parsed = parseDataCenterTargetUri(init.sharedArtifactFolderPath);
    return parsed.parentEntryId === 'root' ? '网点共享产物 / 根目录' : `网点共享产物 / ${parsed.parentEntryId}`;
  });
  const [selectedSharedSpaceId, setSelectedSharedSpaceId] = useState<string>('');
  const [folderPicker, setFolderPicker] = useState<null | {
    kind: 'my' | 'shared';
    title: string;
    rootLabel: string;
    spaceType: DataCenterSpaceType;
    spaceId?: string | null;
    initialParentEntryId: string;
  }>(null);

  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>(init.selectedWorkflow);
  const workflowRef = useRef<HTMLDivElement>(null);

  const workflowDisabled = !!selectedWorkflow;

  useEffect(() => {
    let cancelled = false;
    if (myArtifactFolderPath) {
      resolvePathLabelFromTargetUri(myArtifactFolderPath, '我的产物')
        .then((label) => {
          if (!cancelled) setMyArtifactPathLabel(label);
        })
        .catch(() => {});
    }
    if (sharedArtifactFolderPath) {
      resolvePathLabelFromTargetUri(sharedArtifactFolderPath, '网点共享产物')
        .then((label) => {
          if (!cancelled) setSharedArtifactPathLabel(label);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [myArtifactFolderPath, sharedArtifactFolderPath]);

  useEffect(() => {
    if (!isSite || !saveToDataCenter || !saveToSharedArtifact) return;
    let cancelled = false;
    getDataCenterSpaces()
      .then((result) => {
        if (cancelled) return;
        const spaces = (result.spaces ?? []).filter(isSiteSharedArtifactSpace);
        const existingSpaceId = sharedArtifactFolderPath?.replace(/^data-center:\/\/site_shared_artifact\//, '').split('/')[0] || '';
        const nextSpaceId = existingSpaceId || spaces[0]?.spaceId || '';
        setSelectedSharedSpaceId(nextSpaceId);
        if (nextSpaceId && !sharedArtifactFolderPath) {
          setSharedArtifactFolderPath(buildDataCenterTargetUri('site_shared_artifact', nextSpaceId));
          setSharedArtifactPathLabel('网点共享产物 / 根目录');
        }
      })
      .catch(() => {
        setSelectedSharedSpaceId('');
      });
    return () => {
      cancelled = true;
    };
  }, [isSite, saveToDataCenter, saveToSharedArtifact, sharedArtifactFolderPath]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (workflowRef.current && !workflowRef.current.contains(e.target as Node)) {
        setWorkflowOpen(false);
      }
    }
    if (workflowOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [workflowOpen]);

  const isEditing = !!job;

  const handleSubmit = async () => {
    const newErrors: typeof errors = {};
    if (!name.trim()) newErrors.name = t('myTask.createModal.nameRequired');
    if (!instructions.trim()) newErrors.instructions = t('myTask.createModal.instructionsRequired');
    const shouldSaveToSharedArtifact = isSite && saveToSharedArtifact;
    if (saveToDataCenter && !saveToMyArtifact && !shouldSaveToSharedArtifact) {
      newErrors.dataCenterTarget = '请选择至少一个数据中心保存位置';
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        message: prepareDingTalkAgentTurnMessage(
          instructions.trim(),
          instructionMentions,
          { scenario: 'scheduled-task' },
        ),
        schedule: scheduleValueToCron(schedule),
        enabled: true,
        dingTalkMentions: instructionMentions.length > 0 ? instructionMentions : undefined,
        workflowCode: selectedWorkflow || undefined,
        engineType,
        claudeWorkspacePath: undefined,
        claudePermissionProfile: engineType === 'claude' ? 'dangerous-bypass' : undefined,
        myArtifactFolderPath: saveToDataCenter && saveToMyArtifact
          ? myArtifactFolderPath || buildDataCenterTargetUri('qa_artifact', null)
          : null,
        sharedArtifactFolderPath: saveToDataCenter && shouldSaveToSharedArtifact
          ? sharedArtifactFolderPath || (selectedSharedSpaceId ? buildDataCenterTargetUri('site_shared_artifact', selectedSharedSpaceId) : null)
          : null,
      });
      onClose();
    } catch (err) {
      const message = String(err);
      if (message.includes('409') || message.includes(t('myTask.error.nameDuplicate'))) {
        setErrors({ name: t('myTask.error.nameDuplicate') });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      <motion.div
        className="w-full max-w-[min(820px,100%)] bg-background rounded-[22px] border border-border shadow-2xl flex flex-col max-h-[calc(100vh-4rem)]"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <div className="flex items-start justify-between gap-4 mb-6 px-[18px] pt-[18px] flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-foreground tracking-[-0.02em] leading-[1.3] mb-2.5">
              {isEditing ? t('myTask.createModal.editTitle') : t('myTask.createModal.createTitle')}
            </h2>
            <p className="text-[13px] leading-[1.55] text-muted-foreground">
              {t('myTask.createModal.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 flex items-center justify-center w-9 h-9 -mr-2 -mt-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={t('myTask.createModal.closeAria')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-[18px] pb-[16px] flex flex-col gap-5 flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">{t('myTask.createModal.nameLabel')}</label>
            <input
              type="text"
              value={name}
							maxLength={40}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors((p) => ({ ...p, name: undefined }));
              }}
              disabled={isEditing}
              placeholder={t('myTask.createModal.namePlaceholder')}
              className={cn(
                'h-[42px] w-full rounded-[10px] border bg-background px-3.5 text-sm transition-colors placeholder:text-muted-foreground',
                formFieldFocusClass,
                isEditing ? 'border-border text-muted-foreground cursor-not-allowed opacity-70' : '',
                errors.name ? 'border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.12)]' : 'border-border',
              )}
              autoComplete="off"
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          {/* 执行引擎已固定为 Claude，暂时隐藏选择器 */}
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">{t('myTask.createModal.engineLabel')}</label>
            <select
              value={engineType}
              onChange={(e) => setEngineType(e.target.value as TaskEngineType)}
              disabled={isEditing}
              className={cn(
                'h-[42px] w-full rounded-[10px] border border-border bg-background px-3.5 text-sm transition-colors',
                formFieldFocusClass,
                isEditing ? 'border-border text-muted-foreground cursor-not-allowed opacity-70' : 'border-border',
              )}
            >
              <option value="openclaw">OpenClaw</option>
              <option value="claude">Claude Agent</option>
            </select>
            <p className="text-[11.5px] text-muted-foreground">
              {isEditing
                ? t('myTask.createModal.engineEditHint')
                : engineType === 'claude'
                  ? t('myTask.createModal.engineClaudeHint')
                  : t('myTask.createModal.engineOpenclawHint')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">{t('myTask.createModal.workflowLabel')}</label>
            <div className="relative w-full" ref={workflowRef}>
              <button
                type="button"
                onClick={() => setWorkflowOpen(!workflowOpen)}
                className={cn(
                  'flex h-[42px] w-full cursor-pointer items-center justify-between gap-1.5 rounded-[10px] border bg-background px-3.5 pr-2.5 text-sm font-medium outline-none transition-colors',
                  workflowOpen ? formFieldOpenClass : cn('border-border', formFieldHoverBorderClass),
                )}
              >
                <span
                  className={cn(
                    'truncate',
                    !selectedWorkflow && 'text-muted-foreground font-normal'
                  )}
                >
                  {selectedWorkflow
                    ? workflowOptions.find((o) => o.value === selectedWorkflow)?.label
                    : t('myTask.createModal.workflowPlaceholder')}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                    workflowOpen && 'rotate-180'
                  )}
                />
              </button>
              {workflowOpen && (
                <div className="absolute top-[calc(100%+6px)] left-0 z-20 w-full min-w-[140px]">
                  <div className={cn('flex max-h-[280px] flex-col gap-0.5 overflow-y-auto rounded-xl p-1.5', dropdownPanelClass)}>
                    {workflowOptions.length === 0 && (
                      <div className="px-2.5 py-3 text-sm text-muted-foreground text-center">
                        {t('myTask.createModal.workflowEmpty')}
                      </div>
                    )}
                    {workflowOptions.map((opt) => {
                      const isSelected = selectedWorkflow === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setSelectedWorkflow('');
                              setInstructions('');
                            } else {
                              setSelectedWorkflow(opt.value);
                              setInstructions(buildWorkflowInstructions(opt.value, opt.label, t));
                            }
                            setWorkflowOpen(false);
                          }}
                          className={cn(
                            'flex w-full min-h-9 items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm',
                            dropdownOptionClass(isSelected),
                          )}
                        >
                          <span>{opt.label}</span>
                          <Check className={cn('h-4 w-4 shrink-0 text-primary', isSelected ? 'opacity-100' : 'opacity-0')} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">
              {t('myTask.createModal.instructionsLabel')}
            </label>
            <TaskInstructionComposer
              value={instructions}
              initialMentions={instructionMentions}
              onChange={(text) => {
                setInstructions(text);
                if (errors.instructions) setErrors((p) => ({ ...p, instructions: undefined }));
              }}
              onSnapshotChange={(snapshot: MentionComposerSnapshot) => {
                setInstructionMentions(snapshot.mentions);
              }}
              disabled={workflowDisabled}
              invalid={Boolean(errors.instructions)}
              placeholder={t('myTask.createModal.instructionsPlaceholder')}
              enableAttachments
              enableSkill
              enableWorkflow
              enableQuickInput
              enableDingTalkMention
            />
            {errors.instructions && <p className="text-xs text-destructive">{errors.instructions}</p>}
            {workflowDisabled ? (
              <p className="text-xs text-muted-foreground">{t('myTask.createModal.workflowAutoHint')}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <span className="block text-sm font-semibold text-foreground">{t('myTask.createModal.scheduleLabel')}</span>
            <SchedulePicker value={schedule} onChange={setSchedule} />
          </div>

          <div
            className={cn(
              'flex flex-col gap-3 rounded-[10px] border bg-muted/20 p-3',
              errors.dataCenterTarget
                ? 'border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.12)]'
                : 'border-border',
            )}
          >
            <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <input
                type="checkbox"
                checked={saveToDataCenter}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setSaveToDataCenter(checked);
                  if (!checked) {
                    setSaveToMyArtifact(false);
                    setSaveToSharedArtifact(false);
                    setMyArtifactFolderPath(null);
                    setSharedArtifactFolderPath(null);
                    if (errors.dataCenterTarget) setErrors((p) => ({ ...p, dataCenterTarget: undefined }));
                  }
                }}
                className="h-4 w-4 rounded border-border"
              />
              保存到数据中心
            </label>
            {saveToDataCenter ? (
              <div className="flex flex-col gap-3 pl-6">
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={saveToMyArtifact}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSaveToMyArtifact(checked);
                      setMyArtifactFolderPath(checked ? buildDataCenterTargetUri('qa_artifact', null) : null);
                      if (checked) setMyArtifactPathLabel('我的产物 / 根目录');
                      if (checked && errors.dataCenterTarget) setErrors((p) => ({ ...p, dataCenterTarget: undefined }));
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-border"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">我的产物</span>
                    {saveToMyArtifact ? (
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate text-xs text-muted-foreground">保存路径：{myArtifactPathLabel}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const parsed = parseDataCenterTargetUri(myArtifactFolderPath);
                            setFolderPicker({
                              kind: 'my',
                              title: '选择我的产物目录',
                              rootLabel: '我的产物',
                              spaceType: 'qa_artifact',
                              initialParentEntryId: parsed.parentEntryId,
                            });
                          }}
                          className="h-7 rounded-lg border border-border bg-background px-2 text-xs font-medium hover:bg-muted"
                        >
                          选择目录
                        </button>
                      </span>
                    ) : null}
                  </span>
                </label>
                {isSite ? (
                  <label className="flex items-start gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={saveToSharedArtifact}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSaveToSharedArtifact(checked);
                        if (!checked) setSharedArtifactFolderPath(null);
                        if (checked && errors.dataCenterTarget) setErrors((p) => ({ ...p, dataCenterTarget: undefined }));
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-border"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">网点共享产物</span>
                      {saveToSharedArtifact ? (
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="min-w-0 truncate text-xs text-muted-foreground">保存路径：{sharedArtifactPathLabel}</span>
                          <button
                            type="button"
                            disabled={!selectedSharedSpaceId}
                            onClick={() => {
                              const parsed = parseDataCenterTargetUri(sharedArtifactFolderPath);
                              setFolderPicker({
                                kind: 'shared',
                                title: '选择网点共享产物目录',
                                rootLabel: '网点共享产物',
                                spaceType: 'site_shared_artifact',
                                spaceId: selectedSharedSpaceId,
                                initialParentEntryId: parsed.parentEntryId,
                              });
                            }}
                            className="h-7 rounded-lg border border-border bg-background px-2 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            选择目录
                          </button>
                        </span>
                      ) : null}
                    </span>
                  </label>
                ) : null}
                <p className="text-xs text-muted-foreground">路径变更仅对后续执行生效，历史产物不会自动移动。</p>
              </div>
            ) : null}
          </div>
          {errors.dataCenterTarget ? (
            <p className="-mt-1 text-xs text-destructive">{errors.dataCenterTarget}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 px-[18px] py-4 border-t border-border bg-muted/20 rounded-b-[22px] flex-shrink-0">
          <Button
            variant="outline"
            onClick={onClose}
            className="rounded-[10px] px-5 h-[42px] text-sm"
          >
            {t('myTask.createModal.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className={modalPrimarySubmitButtonClass}
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                {t('myTask.createModal.saving')}
              </>
            ) : (
              t('myTask.createModal.save')
            )}
          </Button>
        </div>
      </motion.div>
      {folderPicker ? (
        <FolderPickerDialog
          open
          title={folderPicker.title}
          rootLabel={folderPicker.rootLabel}
          spaceType={folderPicker.spaceType}
          spaceId={folderPicker.spaceId}
          initialParentEntryId={folderPicker.initialParentEntryId}
          onClose={() => setFolderPicker(null)}
          onSelect={(selection) => {
            if (folderPicker.kind === 'my') {
              setMyArtifactFolderPath(buildDataCenterTargetUri('qa_artifact', null, selection.parentEntryId));
              setMyArtifactPathLabel(selection.pathLabel);
            } else {
              setSharedArtifactFolderPath(buildDataCenterTargetUri('site_shared_artifact', selectedSharedSpaceId, selection.parentEntryId));
              setSharedArtifactPathLabel(selection.pathLabel);
            }
            setFolderPicker(null);
          }}
        />
      ) : null}
    </motion.div>
  );
}
