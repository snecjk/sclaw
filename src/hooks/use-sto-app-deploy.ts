import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  getStoAppStatus,
  listStoAppDeployHistory,
  upsertStoAppDeployHistory,
  type CodeDeployEnv,
} from '@/lib/app-dev-api';
import {
  describeStoAppDeployOutcome,
  pollDeployUntilTerminal,
  runStoAppDeployFlow,
} from '@/lib/sto-app-deploy-flow';
import {
  codeDeployProgressLabel,
  formatCodeDeployFailurePrompt,
  isCodeDeploySettled,
  isCodeDeploySuccess,
  type CodeDeployRecordFields,
} from '../../shared/code-deploy-status';
import type { SiteAppPageType } from '../../shared/site-app-catalog';
import {
  deployFieldsFromHistoryRecord,
  findInProgressStoAppDeploy,
  historyRecordFromDeployFields,
  type StoAppDeployHistoryRecord,
} from '../../shared/sto-app-deploy-history';

export type StoAppDeployPhase =
  | 'pushing'
  | 'creating'
  | 'polling'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'error';

export interface StoAppDeployJob {
  phase: StoAppDeployPhase;
  label: string;
  fields: CodeDeployRecordFields;
  startedAt: number;
  error?: string;
  prompt?: string;
  data?: unknown;
}

const TERMINAL_PHASES: ReadonlySet<StoAppDeployPhase> = new Set([
  'success',
  'failed',
  'timeout',
  'error',
]);

export function isStoAppDeployRunning(job: StoAppDeployJob | null): boolean {
  return Boolean(job && !TERMINAL_PHASES.has(job.phase));
}

function jobFromHistory(record: StoAppDeployHistoryRecord): StoAppDeployJob {
  const fields = deployFieldsFromHistoryRecord(record);
  const settled = isCodeDeploySettled(fields);
  const success = isCodeDeploySuccess(fields.status);
  return {
    phase: settled ? (success ? 'success' : 'failed') : 'polling',
    label: settled
      ? (success ? '发布成功' : '发布失败')
      : `发布进行中：${codeDeployProgressLabel(fields)}`,
    fields,
    startedAt: record.startedAt,
  };
}

export function useStoAppDeploy(input: {
  workspaceId: string;
  appCode?: string;
  appName: string;
  pageType?: SiteAppPageType | string | null;
  onFailedPrompt?: (prompt: string) => void;
  onSuccess?: () => void;
  onStatusRefresh?: () => void | Promise<void>;
}) {
  const [job, setJob] = useState<StoAppDeployJob | null>(null);
  const [history, setHistory] = useState<StoAppDeployHistoryRecord[]>([]);
  const runIdRef = useRef(0);
  const startedAtRef = useRef(Date.now());
  const running = isStoAppDeployRunning(job);

  const refreshSto = async () => {
    if (input.onStatusRefresh) {
      await input.onStatusRefresh();
      return;
    }
    await getStoAppStatus(input.workspaceId).catch(() => null);
  };

  const persistFields = async (fields: CodeDeployRecordFields, startedAt: number) => {
    const record = historyRecordFromDeployFields(fields, startedAt);
    if (!record || !input.workspaceId) return;
    try {
      const items = await upsertStoAppDeployHistory(input.workspaceId, record);
      setHistory(items);
    } catch {
      // Local history must not block publish.
    }
  };

  const applyOutcome = async (
    runId: number,
    outcome: Awaited<ReturnType<typeof runStoAppDeployFlow>>,
  ) => {
    if (runId !== runIdRef.current) return;
    await refreshSto();
    await persistFields(outcome.fields, startedAtRef.current);

    if (outcome.kind === 'success') {
      setJob({
        phase: 'success',
        label: describeStoAppDeployOutcome(outcome),
        fields: outcome.fields,
        startedAt: startedAtRef.current,
        data: outcome.data,
      });
      toast.success(describeStoAppDeployOutcome(outcome));
      input.onSuccess?.();
      return;
    }

    if (outcome.kind === 'failed') {
      setJob({
        phase: 'failed',
        label: describeStoAppDeployOutcome(outcome),
        fields: outcome.fields,
        startedAt: startedAtRef.current,
        prompt: outcome.prompt,
        data: outcome.data,
      });
      toast.error(describeStoAppDeployOutcome(outcome));
      input.onFailedPrompt?.(outcome.prompt);
      return;
    }

    setJob({
      phase: 'timeout',
      label: describeStoAppDeployOutcome(outcome),
      fields: outcome.fields,
      startedAt: startedAtRef.current,
      data: outcome.data,
    });
    toast.message(describeStoAppDeployOutcome(outcome));
  };

  useEffect(() => {
    if (!input.workspaceId) return;
    let cancelled = false;
    const runId = ++runIdRef.current;
    setJob(null);
    setHistory([]);
    void listStoAppDeployHistory(input.workspaceId)
      .then(async (items) => {
        if (cancelled) return;
        setHistory(items);
        if (runId !== runIdRef.current) return;
        const active = findInProgressStoAppDeploy(items);
        if (!active) return;
        startedAtRef.current = active.startedAt;
        setJob(jobFromHistory(active));
        try {
          const outcome = await pollDeployUntilTerminal(active.deploymentId, {
            workspaceId: input.workspaceId,
            appCode: active.appCode ?? input.appCode,
            initialData: deployFieldsFromHistoryRecord(active),
            onProgress: (fields) => {
              if (runId !== runIdRef.current) return;
              setJob({
                phase: 'polling',
                label: `发布进行中：${codeDeployProgressLabel(fields)}`,
                fields,
                startedAt: active.startedAt,
              });
              void persistFields(fields, active.startedAt);
            },
          });
          await applyOutcome(runId, outcome);
        } catch (error) {
          if (cancelled || runId !== runIdRef.current) return;
          const message = error instanceof Error ? error.message : '刷新发布状态失败';
          toast.error(message);
        }
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
    // Resume once per workspace. Callbacks are read from the latest render when the poll finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.workspaceId]);

  const start = (opts: { env: CodeDeployEnv; deploymentVersion?: string }) => {
    if (isStoAppDeployRunning(job)) {
      toast.message('已有发布任务进行中，可点击「发布中」查看进度');
      return;
    }

    const runId = ++runIdRef.current;
    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    setJob({
      phase: 'pushing',
      label: '正在提交代码…',
      fields: { env: opts.env, appCode: input.appCode },
      startedAt,
    });
    toast.message('已开始发布，可继续操作页面');

    void (async () => {
      try {
        const outcome = await runStoAppDeployFlow({
          workspaceId: input.workspaceId,
          env: opts.env,
          appCode: input.appCode,
          deploymentVersion: opts.deploymentVersion,
          appName: input.appName,
          onProgress: (progress) => {
            if (runId !== runIdRef.current) return;
            setJob((prev) => ({
              phase: progress.phase,
              label: progress.label,
              fields: {
                ...(prev?.fields ?? {}),
                ...progress.fields,
              },
              startedAt: prev?.startedAt ?? startedAt,
            }));
            void persistFields(
              {
                env: opts.env,
                applicationId: input.appCode,
                ...progress.fields,
              },
              startedAt,
            );
          },
        });

        await applyOutcome(runId, outcome);
      } catch (error) {
        if (runId !== runIdRef.current) return;
        await refreshSto();
        const message = error instanceof Error ? error.message : '发布失败';
        const fields = { env: opts.env, appCode: input.appCode };
        const prompt = formatCodeDeployFailurePrompt(fields, { fallbackMessage: message });
        setJob({
          phase: 'error',
          label: message,
          fields,
          startedAt,
          error: message,
          prompt,
        });
        toast.error(message);
        input.onFailedPrompt?.(prompt);
      }
    })();
  };

  const clear = () => {
    if (isStoAppDeployRunning(job)) return;
    setJob(null);
  };

  return {
    job,
    history,
    running,
    start,
    clear,
    statusText: job
      ? job.fields.status
        ? codeDeployProgressLabel(job.fields)
        : job.label
      : null,
  };
}
