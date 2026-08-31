import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { CodeDeployEnv } from '@/lib/app-dev-api';
import { getStoAppStatus } from '@/lib/app-dev-api';
import {
  describeStoAppDeployOutcome,
  runStoAppDeployFlow,
} from '@/lib/sto-app-deploy-flow';
import {
  codeDeployStatusLabel,
  formatCodeDeployFailurePrompt,
  type CodeDeployRecordFields,
} from '../../shared/code-deploy-status';

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

export function useStoAppDeploy(input: {
  workspaceId: string;
  appCode?: string;
  appName: string;
  onFailedPrompt?: (prompt: string) => void;
  onStatusRefresh?: () => void | Promise<void>;
}) {
  const [job, setJob] = useState<StoAppDeployJob | null>(null);
  const runIdRef = useRef(0);
  const running = isStoAppDeployRunning(job);

  const refreshSto = async () => {
    if (input.onStatusRefresh) {
      await input.onStatusRefresh();
      return;
    }
    await getStoAppStatus(input.workspaceId).catch(() => null);
  };

  const start = (opts: { env: CodeDeployEnv; deploymentVersion?: string }) => {
    if (isStoAppDeployRunning(job)) {
      toast.message('已有发布任务进行中，可点击「发布中」查看进度');
      return;
    }

    const runId = ++runIdRef.current;
    setJob({
      phase: 'pushing',
      label: '正在提交代码…',
      fields: { env: opts.env, appCode: input.appCode },
      startedAt: Date.now(),
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
              startedAt: prev?.startedAt ?? Date.now(),
            }));
          },
        });

        if (runId !== runIdRef.current) return;
        await refreshSto();

        if (outcome.kind === 'success') {
          setJob({
            phase: 'success',
            label: describeStoAppDeployOutcome(outcome),
            fields: outcome.fields,
            startedAt: Date.now(),
            data: outcome.data,
          });
          toast.success(describeStoAppDeployOutcome(outcome));
          return;
        }

        if (outcome.kind === 'failed') {
          setJob({
            phase: 'failed',
            label: describeStoAppDeployOutcome(outcome),
            fields: outcome.fields,
            startedAt: Date.now(),
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
          startedAt: Date.now(),
          data: outcome.data,
        });
        toast.message(describeStoAppDeployOutcome(outcome));
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
          startedAt: Date.now(),
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
    running,
    start,
    clear,
    statusText: job
      ? job.fields.status
        ? codeDeployStatusLabel(job.fields.status)
        : job.label
      : null,
  };
}
