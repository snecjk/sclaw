import { useEffect, useMemo, useState } from 'react';
import { Archive, ChevronDown, ChevronRight, Database, Folder, FolderOpen, HardDrive, RefreshCw, Trash2, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type {
  StorageCleanupDays,
  StorageCleanupMode,
  StorageCleanupPolicy,
  StorageCleanupResult,
  StorageOpenResult,
  StorageTarget,
  StorageUsage,
  WorkspaceStorageTarget,
} from '../../../shared/storage-management';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';
import { hostApiFetch } from '@/lib/host-api';
import { stoSettingsSectionCardClass } from '@/lib/surfaces';
import { useSettingsStore } from '@/stores/settings';
import { useStorageStore } from '@/stores/storage';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

type WorkspaceCleanupRange = StorageCleanupDays | 'all';

function workspaceUsage(target: WorkspaceStorageTarget, range: WorkspaceCleanupRange): StorageUsage {
  if (range === 'all') return target.cleanupBuckets.all;
  return target.cleanupBuckets[`olderThan${range}Days`];
}

function workspacePolicy(range: WorkspaceCleanupRange): StorageCleanupPolicy {
  return range === 'all' ? { kind: 'all' } : { kind: 'older-than', days: range };
}

function StorageRow({ target, onDelete }: { target: StorageTarget; onDelete: (target: StorageTarget) => void }) {
  const { t } = useTranslation('settings');
  const displayName = target.id === 'workspace-artifacts:default'
    ? t('storage.defaultWorkspace')
    : target.id === 'app-cache'
      ? t('storage.appCache')
      : target.id === 'app-logs'
        ? t('storage.appLogs')
    : target.id === 'openclaw-history'
      ? t('storage.openClaw')
      : target.name;
  return (
    <div className="flex items-center gap-3 border-t border-border/60 py-3 first:border-t-0">
      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="text-xs text-muted-foreground">{t(`storage.status.${target.status}`)} · {target.fileCount} {t('storage.files')}{target.latestModifiedAt ? ` · ${new Date(target.latestModifiedAt).toLocaleDateString()}` : ''}</p>
      </div>
      <span className="text-sm tabular-nums text-muted-foreground">{formatBytes(target.bytes)}</span>
      <Button size="sm" variant="outline" disabled={target.bytes === 0 || target.status !== 'ready'} onClick={() => onDelete(target)}>
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />{t('storage.cleanupAction')}
      </Button>
    </div>
  );
}

function WorkspaceRow({
  target,
  range,
  selected,
  onSelectedChange,
  onDelete,
  onOpen,
}: {
  target: WorkspaceStorageTarget;
  range: WorkspaceCleanupRange;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation('settings');
  const usage = workspaceUsage(target, range);
  const displayName = target.id === 'workspace-artifacts:default' ? t('storage.defaultWorkspace') : target.name;
  const cleanable = usage.fileCount > 0 && target.status === 'ready';
  return (
    <div className="flex items-center gap-3 border-t border-border/60 py-3 first:border-t-0">
      <input type="checkbox" checked={selected} disabled={!cleanable} onChange={(event) => onSelectedChange(event.target.checked)} />
      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="text-xs text-muted-foreground">
          {t(`storage.status.${target.status}`)} · {t('storage.totalUsage', { size: formatBytes(target.bytes), count: target.fileCount })}
        </p>
        <p className="text-xs text-muted-foreground">{t('storage.cleanableUsage', { size: formatBytes(usage.bytes), count: usage.fileCount })}</p>
      </div>
      <Button size="sm" variant="ghost" disabled={target.status === 'unavailable'} onClick={onOpen}>
        <FolderOpen className="mr-1.5 h-3.5 w-3.5" />{t('storage.openFolder')}
      </Button>
      <Button size="sm" variant="outline" disabled={!cleanable} onClick={onDelete}>
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />{t('storage.cleanupAction')}
      </Button>
    </div>
  );
}

export function StorageSettings() {
  const { t } = useTranslation('settings');
  const overview = useStorageStore((state) => state.overview);
  const loading = useStorageStore((state) => state.loading);
  const error = useStorageStore((state) => state.error);
  const load = useStorageStore((state) => state.load);
  const reminderEnabled = useSettingsStore((state) => state.storageReminderEnabled);
  const setReminderEnabled = useSettingsStore((state) => state.setStorageReminderEnabled);
  const [expanded, setExpanded] = useState(false);
  const [selectedRuns, setSelectedRuns] = useState<Set<string>>(new Set());
  const [workspaceRange, setWorkspaceRange] = useState<WorkspaceCleanupRange>(7);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Set<string>>(new Set());
  const [folderMayHaveChanged, setFolderMayHaveChanged] = useState(false);
  const [pendingTargets, setPendingTargets] = useState<StorageTarget[]>([]);
  const [cleanupMode, setCleanupMode] = useState<StorageCleanupMode>('trash');
  const [lastCleanup, setLastCleanup] = useState<StorageCleanupResult | null>(null);

  useEffect(() => { void load({ force: true }).catch(() => undefined); }, [load]);
  const workflowRuns = useMemo(() => overview?.workflowRuntime.runs ?? [], [overview]);
  const deletableRuns = useMemo(() => workflowRuns.filter((run) => run.deletable && run.bytes > 0), [workflowRuns]);
  const cleanableWorkspaces = useMemo(
    () => (overview?.workspaces ?? []).filter((target) => target.status === 'ready' && workspaceUsage(target, workspaceRange).fileCount > 0),
    [overview, workspaceRange],
  );

  const requestCleanup = (targets: StorageTarget[]) => {
    setCleanupMode('trash');
    setPendingTargets(targets);
  };

  const openWorkspaceFolder = async (target: WorkspaceStorageTarget) => {
    const result = await hostApiFetch<StorageOpenResult>('/api/storage/open', {
      method: 'POST',
      body: JSON.stringify({ targetId: target.id }),
    });
    if (!result.opened) {
      toast.error(t('storage.openFolderFailed'));
      return;
    }
    setFolderMayHaveChanged(true);
  };

  const clean = async () => {
    const workspaceOnly = pendingTargets.every((item) => item.id.startsWith('workspace-artifacts:'));
    const result = await hostApiFetch<StorageCleanupResult>('/api/storage/cleanup', {
      method: 'POST',
      body: JSON.stringify({
        targetIds: pendingTargets.map((item) => item.id),
        mode: cleanupMode,
        ...(workspaceOnly ? { policy: workspacePolicy(workspaceRange) } : {}),
      }),
      disableTimeout: true,
    });
    setLastCleanup(result);
    setPendingTargets([]);
    setSelectedRuns(new Set());
    setSelectedWorkspaces(new Set());
    await load({ force: true });
    const failures = result.targets.filter((item) => item.status !== 'cleaned').length;
    toast.success(failures
      ? t(result.mode === 'delete' ? 'storage.deletePartial' : 'storage.cleanupPartial', { size: formatBytes(result.cleanedBytes), count: failures })
      : t(result.mode === 'delete' ? 'storage.deleteSuccess' : 'storage.cleanupSuccess', { size: formatBytes(result.cleanedBytes) }));
  };

  const diskPercent = overview?.disk.totalBytes
    ? Math.max(0, Math.min(100, overview.disk.availableBytes / overview.disk.totalBytes * 100))
    : 0;
  const pendingWorkspaceUsage = pendingTargets.reduce((sum, item) => {
    if (!item.id.startsWith('workspace-artifacts:') || !('cleanupBuckets' in item)) return sum + item.bytes;
    return sum + workspaceUsage(item as WorkspaceStorageTarget, workspaceRange).bytes;
  }, 0);
  const pendingWorkspaceFiles = pendingTargets.reduce((sum, item) => {
    if (!item.id.startsWith('workspace-artifacts:') || !('cleanupBuckets' in item)) return sum + item.fileCount;
    return sum + workspaceUsage(item as WorkspaceStorageTarget, workspaceRange).fileCount;
  }, 0);
  return (
    <>
      <header>
        <div className="flex items-center justify-between gap-4">
          <div><h1 className="text-[20px] font-bold">{t('storage.title')}</h1><p className="mt-2 text-sm text-muted-foreground">{t('storage.subtitle')}</p></div>
          <Button variant="outline" disabled={loading} onClick={() => void load({ force: true }).catch(() => undefined)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{t('storage.refresh')}
          </Button>
        </div>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {folderMayHaveChanged ? <div className="mt-3 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <span>{t('storage.folderChanged')}</span>
          <Button size="sm" variant="ghost" onClick={() => { setFolderMayHaveChanged(false); void load({ force: true }).catch(() => undefined); }}>{t('storage.rescan')}</Button>
        </div> : null}
        {lastCleanup ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">{t(lastCleanup.mode === 'delete' ? 'storage.deleteReport' : 'storage.cleanupReport', {
          moved: formatBytes(lastCleanup.cleanedBytes),
          freed: lastCleanup.diskFreeBytesBefore != null && lastCleanup.diskFreeBytesAfter != null
            ? formatBytes(Math.max(0, lastCleanup.diskFreeBytesAfter - lastCleanup.diskFreeBytesBefore))
            : '—',
        })}</p> : null}
      </header>

      <section className={stoSettingsSectionCardClass}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div><p className="text-xs text-muted-foreground">{t('storage.diskRemaining')}</p><p className="mt-1 text-xl font-semibold">{overview ? formatBytes(overview.disk.availableBytes) : '—'}</p><p className="text-xs text-muted-foreground">{diskPercent.toFixed(1)}%</p></div>
          <div><p className="text-xs text-muted-foreground">{t('storage.diskTotal')}</p><p className="mt-1 text-xl font-semibold">{overview ? formatBytes(overview.disk.totalBytes) : '—'}</p></div>
          <div><p className="text-xs text-muted-foreground">{t('storage.managed')}</p><p className="mt-1 text-xl font-semibold">{overview ? formatBytes(overview.managedBytes) : '—'}</p></div>
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <div><p className="text-sm font-medium">{t('storage.reminder')}</p><p className="text-xs text-muted-foreground">{t('storage.reminderDesc')}</p></div>
          <Switch checked={reminderEnabled} onCheckedChange={setReminderEnabled} />
        </div>
      </section>

      <section className={stoSettingsSectionCardClass}>
        <div className="mb-4 flex items-center gap-3"><Database className="h-5 w-5" /><div><h2 className="font-semibold">{t('storage.appRuntime')}</h2><p className="text-xs text-muted-foreground">{t('storage.appRuntimeDesc')}</p></div></div>
        {overview ? <>
          <StorageRow target={overview.appCache} onDelete={(target) => requestCleanup([target])} />
          <StorageRow target={overview.appLogs} onDelete={(target) => requestCleanup([target])} />
        </> : null}
      </section>

      <section className={stoSettingsSectionCardClass}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <HardDrive className="h-5 w-5" />
          <div className="min-w-0 flex-1"><h2 className="font-semibold">{t('storage.projects')}</h2><p className="text-xs text-muted-foreground">{t('storage.projectsDesc')}</p></div>
          <select
            aria-label={t('storage.cleanupRange')}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={workspaceRange}
            onChange={(event) => {
              const value = event.target.value;
              setWorkspaceRange(value === 'all' ? 'all' : Number(value) as StorageCleanupDays);
              setSelectedWorkspaces(new Set());
            }}
          >
            <option value={7}>{t('storage.olderThanDays', { days: 7 })}</option>
            <option value={30}>{t('storage.olderThanDays', { days: 30 })}</option>
            <option value={90}>{t('storage.olderThanDays', { days: 90 })}</option>
            <option value="all">{t('storage.allArtifacts')}</option>
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={selectedWorkspaces.size === 0}
            onClick={() => requestCleanup((overview?.workspaces ?? []).filter((item) => selectedWorkspaces.has(item.id)))}
          >
            {t('storage.cleanSelected')}
          </Button>
        </div>
        {cleanableWorkspaces.length > 0 ? <Button
          className="mb-2"
          size="sm"
          variant="ghost"
          onClick={() => setSelectedWorkspaces(new Set(cleanableWorkspaces.map((item) => item.id)))}
        >
          {t('storage.selectAllWorkspaces')}
        </Button> : null}
        {overview?.workspaces.map((target) => <WorkspaceRow
          key={target.id}
          target={target}
          range={workspaceRange}
          selected={selectedWorkspaces.has(target.id)}
          onSelectedChange={(selected) => setSelectedWorkspaces((current) => {
            const next = new Set(current);
            if (selected) next.add(target.id); else next.delete(target.id);
            return next;
          })}
          onDelete={() => requestCleanup([target])}
          onOpen={() => { void openWorkspaceFolder(target).catch(() => toast.error(t('storage.openFolderFailed'))); }}
        />)}
      </section>

      <section className={stoSettingsSectionCardClass}>
        <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setExpanded((value) => !value)}>
          <Workflow className="h-5 w-5" /><div className="min-w-0 flex-1"><h2 className="font-semibold">{t('storage.workflow')}</h2><p className="text-xs text-muted-foreground">{overview ? `${formatBytes(overview.workflowRuntime.bytes)} · ${overview.workflowRuntime.fileCount} ${t('storage.files')}` : t('storage.workflowDesc')}</p></div>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {expanded ? <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            {deletableRuns.length > 0 ? <Button size="sm" variant="outline" onClick={() => setSelectedRuns(new Set(deletableRuns.map((run) => run.id)))}>{t('storage.selectAll')}</Button> : <span />}
            <Button size="sm" variant="outline" disabled={selectedRuns.size === 0} onClick={() => requestCleanup(workflowRuns.filter((run) => selectedRuns.has(run.id)))}>{t('storage.cleanSelected')}</Button>
          </div>
          {workflowRuns.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{t('storage.empty')}</p> : workflowRuns.map((run) => (
            <label key={run.id} className="flex items-center gap-3 border-t border-border/60 py-3 first:border-t-0">
              <input type="checkbox" disabled={!run.deletable || run.bytes === 0} checked={selectedRuns.has(run.id)} onChange={(event) => setSelectedRuns((current) => { const next = new Set(current); if (event.target.checked) next.add(run.id); else next.delete(run.id); return next; })} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{run.workflowName || run.runId}</p><p className="text-xs text-muted-foreground">{run.orphaned ? t('storage.orphaned') : run.runStatus} · {run.fileCount} {t('storage.files')}</p></div>
              <span className="text-sm tabular-nums text-muted-foreground">{formatBytes(run.bytes)}</span>
            </label>
          ))}
        </div> : null}
      </section>

      <section className={stoSettingsSectionCardClass}>
        <div className="mb-4 flex items-center gap-3"><Archive className="h-5 w-5" /><div><h2 className="font-semibold">{t('storage.openClaw')}</h2><p className="text-xs text-muted-foreground">{t('storage.openClawDesc')}</p></div></div>
        {overview ? <StorageRow target={overview.openClaw} onDelete={(target) => requestCleanup([target])} /> : null}
      </section>

      <ConfirmDialog
        open={pendingTargets.length > 0}
        title={t(cleanupMode === 'delete' ? 'storage.confirmDeleteTitle' : 'storage.confirmTitle')}
        message={pendingTargets.every((item) => item.id.startsWith('workspace-artifacts:'))
          ? t(cleanupMode === 'delete'
            ? workspaceRange === 'all' ? 'storage.confirmDeleteAllWorkspaceMessage' : 'storage.confirmDeleteWorkspaceMessage'
            : workspaceRange === 'all' ? 'storage.confirmAllWorkspaceMessage' : 'storage.confirmWorkspaceMessage', {
            count: pendingTargets.length,
            days: workspaceRange,
            size: formatBytes(pendingWorkspaceUsage),
            files: pendingWorkspaceFiles,
          })
          : t(cleanupMode === 'delete' ? 'storage.confirmDeleteMessage' : 'storage.confirmMessage', { count: pendingTargets.length, size: formatBytes(pendingWorkspaceUsage) })}
        confirmLabel={t(cleanupMode === 'delete' ? 'storage.permanentlyDelete' : 'storage.moveToTrash')}
        confirmingLabel={t(cleanupMode === 'delete' ? 'storage.deleting' : 'storage.cleaning')}
        cancelLabel={t('storage.cancel')}
        variant="destructive"
        onCancel={() => setPendingTargets([])}
        onConfirm={clean}
        onError={(cause) => toast.error(cause instanceof Error ? cause.message : String(cause))}
      >
        <fieldset className="mt-4 space-y-2">
          <legend className="mb-2 text-xs font-medium text-[var(--sto-text-secondary)]">{t('storage.cleanupMethod')}</legend>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm">
            <input className="mt-0.5" type="radio" name="storage-cleanup-mode" checked={cleanupMode === 'trash'} onChange={() => setCleanupMode('trash')} />
            <span><span className="block font-medium">{t('storage.moveToTrash')}</span><span className="block text-xs text-muted-foreground">{t('storage.moveToTrashDesc')}</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-red-500/50 p-3 text-sm">
            <input className="mt-0.5" type="radio" name="storage-cleanup-mode" checked={cleanupMode === 'delete'} onChange={() => setCleanupMode('delete')} />
            <span><span className="block font-medium text-red-600 dark:text-red-400">{t('storage.permanentlyDelete')}</span><span className="block text-xs text-muted-foreground">{t('storage.permanentlyDeleteDesc')}</span></span>
          </label>
        </fieldset>
      </ConfirmDialog>
    </>
  );
}
