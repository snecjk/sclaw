import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2, ChevronDown, Folder, FolderPlus, ArrowLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { AiBeautifyButton } from '@/components/ai-beautify/AiBeautifyButton';
import { SchedulePicker, type ScheduleValue } from './SchedulePicker';
import {
  scheduleValueToCron,
  tryCronToScheduleValue,
  defaultScheduleValue,
  validateScheduleMonthDays,
  validateScheduleTimes,
} from '../lib/schedule-utils';
import {
  stripInstructionFromTaskMessage,
  resolveScheduledTaskMentions,
} from '@/lib/scheduled-task-recipients';
import { useMyTaskStore } from '../store';
import { cn } from '@/lib/utils';
import {
  formFieldFocusClass,
  invertedPrimarySurfaceClass,
  modalPrimarySubmitButtonClass,
  taskCreateFormControlClass,
  taskCreateFormLabelClass,
} from '@/lib/surfaces';
import type { CronJobCreateInput } from '@/types/cron';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { ClaudeTaskPermissionProfile } from '@/types/scheduled-task';
import type { ManagedLocalTask } from '@/stores/cron';
import { createDataCenterFolder, deleteDataCenterEntry, getDataCenterEntry, getDataCenterSpaces, listDataCenterEntries, renameDataCenterEntry } from '@/lib/data-center-api';
import { useAuthStore, isSiteUser } from '@/stores/auth';
import type { DataCenterEntry, DataCenterSpace, DataCenterSpaceType } from '@/types/data-center';
import { toast } from 'sonner';
import { IconCheckbox } from '@/components/icon-checkbox';
import { TaskInstructionComposer, type TaskComposerSnapshot, type TaskInstructionComposerHandle } from './TaskInstructionComposer';
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';
import { buildComposerGatewayPayload } from '@/lib/composer-gateway-text';
import { resolveSkillPrompt } from '@/lib/skill-plaza-resolve';
import { extractDingTalkMentionsFromComposerSegments } from '../../../../shared/dingtalk-send/scheduled-task-dingtalk-lift';
import {
  composerSegmentsHaveBogusSkills,
  composerSegmentsLookNlStacked,
  isPlausibleSkillLabel,
  reconstructComposerSegmentsFromPrompt,
} from '../../../../shared/scheduled-task-composer-segments';
import { unescapeLiteralNewlines } from '../../../../shared/text-escape';

type TaskEngineType = 'openclaw' | 'claude';

export type TaskCreateInputWithRun = CronJobCreateInput & {
  engineType: TaskEngineType;
  claudeWorkspacePath?: string;
  claudePermissionProfile?: ClaudeTaskPermissionProfile;
  /** @deprecated extra 真源；保存时不再写 skill_code 列 */
  skillCode?: string | null;
  extra?: Record<string, unknown> | null;
};

interface TaskCreateModalProps {
  job?: ManagedLocalTask | null;
  open: boolean;
  onClose: () => void;
  onSave: (input: TaskCreateInputWithRun) => Promise<void>;
  /** workflowCode：从工作流页入口打开时，seed 为 composer workflow token（不再用表单下拉） */
  initialValues?: { name?: string; message?: string; schedule?: string; workflowCode?: string; workflowName?: string };
}

interface TaskCreateModalInnerProps {
  job?: ManagedLocalTask | null;
  onClose: () => void;
  onSave: (input: TaskCreateInputWithRun) => Promise<void>;
  initialValues?: { name?: string; message?: string; schedule?: string; workflowCode?: string; workflowName?: string };
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

function seedWorkflowSegment(
  workflowCode: string | undefined,
  workflowName?: string,
): PersistedComposerSegment[] | null {
  const id = workflowCode?.trim();
  if (!id) return null;
  return [{
    type: 'workflow',
    id,
    name: workflowName?.trim() || id,
    source: 'mine',
  }];
}

function computeInitialValues(
  job: ManagedLocalTask | null | undefined,
  initialValues: { name?: string; message?: string; schedule?: string; workflowCode?: string; workflowName?: string } | undefined,
  workflowLabelResolver?: (code: string) => string | undefined,
) {

  if (job) {
    const fromExtra = extractDingTalkMentionsFromComposerSegments(job.extra);
    const fromPrompt = resolveScheduledTaskMentions(job.prompt || '');
    const recipients = fromExtra?.length
      ? fromExtra
      : fromPrompt.length > 0
        ? fromPrompt
        : (job.dingtalkRecipients ?? []);
    const composerSegments = Array.isArray(job.extra?.composerSegments)
      ? (job.extra!.composerSegments as PersistedComposerSegment[])
      : null;
    const composerAttachments = Array.isArray(job.extra?.composerAttachments)
      ? (job.extra!.composerAttachments as Array<{
        fileName?: string;
        mimeType?: string;
        persistentPath?: string;
        provenance?: unknown;
      }>)
      : [];
    // 用持久路径补齐 file segment，便于编辑回填附件 token
    let enrichedSegments = composerSegments;
    if (composerSegments && composerAttachments.length > 0) {
      let fileIdx = 0;
      enrichedSegments = composerSegments.map((seg) => {
        if (seg.type !== 'file') return seg;
        const att = composerAttachments[fileIdx];
        fileIdx += 1;
        if (!att?.persistentPath) return seg;
        return {
          ...seg,
          fileName: att.fileName || seg.fileName,
          mimeType: att.mimeType || seg.mimeType,
          filePath: att.persistentPath,
          stagedPath: att.persistentPath,
          provenance: (att.provenance as typeof seg.provenance) ?? seg.provenance,
        };
      });
    }
    // 历史：列有 workflow_code 但 segments 无 → 编辑时补进 composer（迁移脚本也会做）
    if (job.workflowCode?.trim()) {
      const code = job.workflowCode.trim();
      const hasWf = (enrichedSegments ?? []).some(
        (seg) => seg.type === 'workflow' && seg.id === code,
      );
      if (!hasWf) {
        enrichedSegments = [
          ...(enrichedSegments ?? []),
          {
            type: 'workflow',
            id: code,
            name: workflowLabelResolver?.(code) || code,
            source: 'mine',
          },
        ];
      }
    }
    const createdViaNl = (job.extra as { createdVia?: string } | null | undefined)?.createdVia === 'nl';
    // 存量 NL：分堆 segments，或含假 skill chip（调度说明误包）→ 按 prompt 重建交错顺序
    if (
      createdViaNl
      && job.prompt?.trim()
      && (
        composerSegmentsLookNlStacked(enrichedSegments)
        || composerSegmentsHaveBogusSkills(enrichedSegments)
      )
    ) {
      const segs = enrichedSegments ?? [];
      const attachments = segs
        .filter((s): s is Extract<PersistedComposerSegment, { type: 'file' }> => s.type === 'file')
        .map((s) => ({
          fileName: s.fileName,
          mimeType: s.mimeType || 'application/octet-stream',
          sourcePath: s.filePath || s.stagedPath || '',
          persistentPath: s.filePath || s.stagedPath || '',
          provenance: s.provenance,
        }));
      const skills = segs
        .filter((s): s is Extract<PersistedComposerSegment, { type: 'skill' }> => s.type === 'skill')
        .map((s) => ({ slug: s.slug, title: s.title }))
        .filter((s) => isPlausibleSkillLabel(s.title || s.slug));
      const mentions = segs
        .filter((s): s is Extract<PersistedComposerSegment, { type: 'mention' }> => s.type === 'mention')
        .map((s) => s.mention);
      const wfSeg = segs.find(
        (s): s is Extract<PersistedComposerSegment, { type: 'workflow' }> => s.type === 'workflow',
      );
      enrichedSegments = reconstructComposerSegmentsFromPrompt({
        prompt: unescapeLiteralNewlines(job.prompt),
        attachments,
        skills,
        mentions: mentions.length > 0 ? mentions : recipients,
        workflowCode: wfSeg?.id || job.workflowCode,
        workflowName: wfSeg?.name || workflowLabelResolver?.(job.workflowCode || '') || job.workflowCode,
      }) as PersistedComposerSegment[];
    }
    const rawInstructions = stripInstructionFromTaskMessage(job.prompt || '', enrichedSegments);
    // C-4：NL 创建的存量任务 prompt 可能含字面 `\n`（C-2 之前入库），读取时显示侧
    // 归一化（幂等，不回写；用户保存时自然固化）。UI 创建任务不误转。
    const instructions = createdViaNl ? unescapeLiteralNewlines(rawInstructions) : rawInstructions;
    const decoded = tryCronToScheduleValue(job.cronExpr);
    return {
      name: job.name || '',
      instructions,
      schedule: decoded ?? defaultScheduleValue(),
      scheduleLocked: decoded === null,
      originalCronExpr: typeof job.cronExpr === 'string' ? job.cronExpr : null,
      recipients,
      composerSegments: enrichedSegments,
      engineType: job.engineType,
      createdViaNl,
      saveToMyArtifact: !!job.myArtifactFolderPath,
      saveToSharedArtifact: !!job.sharedArtifactFolderPath,
      myArtifactFolderPath: job.myArtifactFolderPath,
      sharedArtifactFolderPath: job.sharedArtifactFolderPath,
    };
  }

  if (initialValues) {
    const seededWorkflow = seedWorkflowSegment(
      initialValues.workflowCode,
      initialValues.workflowName
        || (initialValues.workflowCode
          ? workflowLabelResolver?.(initialValues.workflowCode)
          : undefined),
    );
    const instructions = initialValues.message
      || (initialValues.workflowCode
        ? buildWorkflowInstructions(
          initialValues.workflowCode,
          initialValues.workflowName
            || workflowLabelResolver?.(initialValues.workflowCode),
        )
        : '');
    const decoded = initialValues.schedule
      ? tryCronToScheduleValue(initialValues.schedule)
      : defaultScheduleValue();
    const scheduleLocked = Boolean(initialValues.schedule) && decoded === null;
    return {
      name: initialValues.name || '',
      instructions,
      schedule: decoded ?? defaultScheduleValue(),
      scheduleLocked,
      originalCronExpr: scheduleLocked ? initialValues.schedule ?? null : null,
      recipients: [] as DingTalkMention[],
      composerSegments: seededWorkflow,
      engineType: 'claude' as TaskEngineType,
      createdViaNl: false,
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
    scheduleLocked: false,
    originalCronExpr: null as string | null,
    recipients: [] as DingTalkMention[],
    composerSegments: null as PersistedComposerSegment[] | null,
    engineType: 'claude' as TaskEngineType,
    createdViaNl: false,
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
  const [loading, setLoading] = useState(true);
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

  const navigateTo = (entryId: string) => {
    setParentEntryId(entryId);
    setLoading(true);
    setError(null);
  };

  const reload = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((key) => key + 1);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
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
      reload();
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
      reload();
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
      reload();
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
            onClick={() => navigateTo(parentBreadcrumb?.entryId || 'root')}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回
          </button>
          <button
            type="button"
            onClick={() => navigateTo('root')}
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
                  onClick={() => navigateTo(folder.entryId)}
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
          className="fixed z-[10080] min-w-[128px] rounded-[10px] border border-[var(--sto-border-default)] bg-[var(--sto-card-elevated-bg)] p-2 text-[var(--sto-text-primary)] shadow-[var(--sto-feature-shadow-menu)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="block h-9 w-full rounded-[6px] px-3 text-left text-[13px] leading-9 hover:bg-[var(--sto-control-hover-bg)]"
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
            className="block h-9 w-full rounded-[6px] px-3 text-left text-[13px] leading-9 text-[var(--sto-dialog-destructive-background)] hover:bg-[var(--sto-control-hover-bg)]"
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
                className="h-9 rounded-[10px] bg-[var(--sto-dialog-destructive-background)] px-4 text-sm text-[hsl(var(--destructive-foreground))] hover:bg-[var(--sto-dialog-destructive-hover-background)]"
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

  const init = computeInitialValues(job, initialValues, (code) =>
    workflowOptions.find((o) => o.value === code)?.label,
  );

  const [name, setName] = useState(init.name);
  const [instructions, setInstructions] = useState(init.instructions);
  const [schedule, setSchedule] = useState<ScheduleValue>(init.schedule);
  const scheduleLocked = init.scheduleLocked;
  const originalCronExpr = init.originalCronExpr;
  const [saving, setSaving] = useState(false);
  const [instructionMentions] = useState<DingTalkMention[]>(init.recipients);
  const composerSnapshotRef = useRef<TaskComposerSnapshot | null>(null);
  const instructionComposerRef = useRef<TaskInstructionComposerHandle>(null);
  const initialComposerSegments = init.composerSegments;
  const initialCreatedViaNl = init.createdViaNl;
  const [errors, setErrors] = useState<{ name?: string; instructions?: string; schedule?: string }>({});
  const [engineType, setEngineType] = useState<TaskEngineType>(init.engineType);
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
    if (!isSite || !saveToSharedArtifact) return;
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
  }, [isSite, saveToSharedArtifact, sharedArtifactFolderPath]);

  const isEditing = !!job;

  const handleSubmit = async () => {
    const newErrors: typeof errors = {};
    if (!name.trim()) newErrors.name = t('myTask.createModal.nameRequired');
    const snapshot = composerSnapshotRef.current;
    const hasComposerContent = Boolean(
      instructions.trim()
      || (snapshot?.skills?.length ?? 0) > 0
      || (snapshot?.workflows?.length ?? 0) > 0
      || (snapshot?.attachments?.length ?? 0) > 0
      || (snapshot?.mentions?.length ?? 0) > 0,
    );
    if (!hasComposerContent) newErrors.instructions = t('myTask.createModal.instructionsRequired');
    if (!scheduleLocked) {
      const timesError = validateScheduleTimes(schedule.times);
      if (timesError === 'empty') newErrors.schedule = t('myTask.schedule.timesRequired');
      if (schedule.frequency === 'monthly' && validateScheduleMonthDays(schedule) === 'empty') {
        newErrors.schedule = t('myTask.schedule.monthDaysRequired');
      }
    } else if (!originalCronExpr?.trim()) {
      newErrors.schedule = t('myTask.schedule.tooComplexToEdit');
    }
    const shouldSaveToSharedArtifact = isSite && saveToSharedArtifact;
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      const readyAttachments = (snapshot?.attachments ?? []).filter((a) => a.status === 'ready');
      const payload = await buildComposerGatewayPayload({
        segments: snapshot?.segments ?? [],
        plainText: snapshot?.plainText ?? instructions,
        attachments: readyAttachments,
        resolveSkillPrompt,
      });

      const composerAttachments = readyAttachments.map((att) => ({
        id: att.id,
        fileName: att.fileName,
        mimeType: att.mimeType,
        sourcePath: att.stagedPath,
        provenance: att.provenance,
      }));

      await onSave({
        name: name.trim(),
        message: payload.gatewayText.trim() || instructions.trim(),
        schedule: scheduleLocked && originalCronExpr
          ? originalCronExpr
          : scheduleValueToCron(schedule),
        enabled: true,
        dingTalkMentions: payload.persistedSegments
          .filter((seg): seg is Extract<PersistedComposerSegment, { type: 'mention' }> => seg.type === 'mention')
          .map((seg) => seg.mention),
        // extra 真源：不写 skill_code / workflow_code 列
        skillCode: null,
        workflowCode: undefined,
        extra: {
          ...(job?.extra && typeof job.extra === 'object' ? job.extra : {}),
          composerSegments: payload.persistedSegments,
          composerAttachments,
        },
        engineType,
        claudeWorkspacePath: undefined,
        claudePermissionProfile: engineType === 'claude' ? 'dangerous-bypass' : undefined,
        myArtifactFolderPath: saveToMyArtifact
          ? myArtifactFolderPath || buildDataCenterTargetUri('qa_artifact', null)
          : null,
        sharedArtifactFolderPath: shouldSaveToSharedArtifact
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
        className="w-full max-w-[min(640px,100%)] bg-[#FFFFFF] rounded-[18px] border border-border shadow-2xl flex flex-col max-h-[calc(100vh-4rem)]"
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

        <div className="sto-hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-[18px] pb-[16px]">
          <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className={taskCreateFormLabelClass}>{t('myTask.createModal.nameLabel')}</label>
            <input
              type="text"
              value={name}
							maxLength={40}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors((p) => ({ ...p, name: undefined }));
              }}
              placeholder={t('myTask.createModal.namePlaceholder')}
              className={cn(
                taskCreateFormControlClass,
                'placeholder:text-muted-foreground',
                formFieldFocusClass,
                errors.name && 'border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.12)]',
              )}
              autoComplete="off"
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <label className={taskCreateFormLabelClass}>
                {t('myTask.createModal.instructionsLabel')}
              </label>
              <AiBeautifyButton
                type="task"
                value={instructions}
                disabled={saving}
                className="shrink-0"
                hasStructuredChips={() =>
                  (composerSnapshotRef.current?.segments ?? []).some(
                    (seg) => seg.type === 'file' || seg.type === 'skill' || seg.type === 'workflow',
                  )
                }
                resolveWorkflow={() => {
                  const wf = composerSnapshotRef.current?.workflows[0];
                  return { workflowId: wf?.id, workflowName: wf?.name };
                }}
                onBeautified={(next) => {
                  if (instructionComposerRef.current) {
                    instructionComposerRef.current.applyBeautifiedText(next);
                  } else {
                    setInstructions(next);
                  }
                  if (errors.instructions) setErrors((p) => ({ ...p, instructions: undefined }));
                }}
                onEmpty={() => {
                  setErrors((p) => ({ ...p, instructions: t('myTask.createModal.instructionsRequired') }));
                }}
              />
            </div>
            <TaskInstructionComposer
              ref={instructionComposerRef}
              value={instructions}
              initialMentions={instructionMentions}
              initialSegments={initialComposerSegments}
              createdViaNl={initialCreatedViaNl}
              onChange={(text) => {
                setInstructions(text);
                if (errors.instructions) setErrors((p) => ({ ...p, instructions: undefined }));
              }}
              onSnapshotChange={(snapshot: TaskComposerSnapshot) => {
                // 只写 ref：勿 setState（mentions 每帧新数组引用会与下方 emitSnapshot effect 死循环）
                composerSnapshotRef.current = snapshot;
              }}
              invalid={Boolean(errors.instructions)}
              placeholder={t('myTask.createModal.instructionsPlaceholder')}
              enableAttachments
              enableSkill
              enableWorkflow
              enableQuickInput
              enableDingTalkMention
            />
            {errors.instructions && <p className="text-xs text-destructive">{errors.instructions}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <span className={taskCreateFormLabelClass}>{t('myTask.createModal.scheduleLabel')}</span>
            {scheduleLocked ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">{t('myTask.schedule.tooComplexToEdit')}</p>
                {originalCronExpr ? (
                  <code className="block overflow-x-auto rounded-[8px] border border-[#E5E6EB] bg-[#F7F8FA] px-3 py-2 text-[12px] text-foreground">
                    {originalCronExpr}
                  </code>
                ) : null}
                {errors.schedule && (
                  <p className="text-xs text-destructive">{errors.schedule}</p>
                )}
              </div>
            ) : (
              <SchedulePicker
                value={schedule}
                onChange={(next) => {
                  setSchedule(next);
                  if (errors.schedule) {
                    setErrors((p) => {
                      const nextErrors = { ...p };
                      delete nextErrors.schedule;
                      return nextErrors;
                    });
                  }
                }}
              />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className={taskCreateFormLabelClass}>
              {t('myTask.createModal.resultSaveToLabel')}
            </span>
            <div className="flex flex-wrap items-center gap-8">
              <button
                type="button"
                className="inline-flex items-center gap-2 text-[12px] text-foreground"
                onClick={() => {
                  const next = !saveToMyArtifact;
                  setSaveToMyArtifact(next);
                  setMyArtifactFolderPath(next ? buildDataCenterTargetUri('qa_artifact', null) : null);
                  if (next) setMyArtifactPathLabel('我的产物 / 根目录');
                }}
              >
                <IconCheckbox checked={saveToMyArtifact} />
                {t('myTask.createModal.myArtifactLabel')}
              </button>
              {isSite ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-[12px] text-foreground"
                  onClick={() => {
                    const next = !saveToSharedArtifact;
                    setSaveToSharedArtifact(next);
                    if (!next) setSharedArtifactFolderPath(null);
                  }}
                >
                  <IconCheckbox checked={saveToSharedArtifact} />
                  {t('myTask.createModal.sharedArtifactLabel')}
                </button>
              ) : null}
            </div>
            {saveToMyArtifact ? (
              <div className="flex flex-wrap items-center gap-2">
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
              </div>
            ) : null}
            {isSite && saveToSharedArtifact ? (
              <div className="flex flex-wrap items-center gap-2">
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
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <label className={taskCreateFormLabelClass}>{t('myTask.createModal.engineLabel')}</label>
            <select
              value={engineType}
              disabled={isEditing}
              onChange={(e) => setEngineType(e.target.value as TaskEngineType)}
              className={cn(
                taskCreateFormControlClass,
                formFieldFocusClass,
                isEditing && 'cursor-not-allowed opacity-60',
              )}
            >
              <option value="openclaw">OpenClaw</option>
              <option value="claude">Claude Agent</option>
            </select>
          </div>
          </div>
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
          key={`${folderPicker.kind}:${folderPicker.spaceId ?? ''}:${folderPicker.initialParentEntryId}`}
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
