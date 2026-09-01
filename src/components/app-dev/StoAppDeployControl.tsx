import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AssetsPublishSuccess } from '@/components/app-dev/AssetsPublishSuccess';
import { SitePublishSuccess } from '@/components/app-dev/SitePublishSuccess';
import { cn } from '@/lib/utils';
import { openExternalUrl } from '@/lib/preview-url';
import {
  isStoAppDeployRunning,
  type StoAppDeployJob,
} from '@/hooks/use-sto-app-deploy';
import {
  codeDeployProgressLabel,
  formatCodeDeployFailurePrompt,
  isSpuriousPendingDeployFailure,
  presentCodeDeployFields,
} from '../../../shared/code-deploy-status';
import type { CodeApplicationPageType } from '../../../shared/code-application-catalog';
import { resolvePublishSuccessPresentation } from '../../../shared/code-publish-result';

interface StoAppDeployControlProps {
  pageType: CodeApplicationPageType;
  canDeploy: boolean;
  job: StoAppDeployJob | null;
  onOpenDialog: () => void;
  onClearTerminalJob?: () => void;
  /** One-click fill the latest failure/timeout details into the AI composer. */
  onFillComposer?: (text: string) => void;
  onPublishMenu?: () => void;
}

export function resolveStoAppDeployAskAiPrompt(job: StoAppDeployJob): string {
  const trimmedPrompt = job.prompt?.trim();
  if (trimmedPrompt) return trimmedPrompt;
  return formatCodeDeployFailurePrompt(job.fields, {
    fallbackMessage: job.error || job.label,
  });
}

export function StoAppDeployControl({
  pageType,
  canDeploy,
  job,
  onOpenDialog,
  onClearTerminalJob,
  onFillComposer,
  onPublishMenu,
}: StoAppDeployControlProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const running = isStoAppDeployRunning(job);
  const presentedFields = job ? presentCodeDeployFields(job.fields) : null;
  const successPresentation = job?.phase === 'success'
    ? resolvePublishSuccessPresentation({
        pageType,
        deploymentVersion: job.fields.deploymentVersion,
        revisionId: job.fields.revisionId,
        resourcePages: job.fields.resourcePages,
      })
    : null;

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('已复制');
    } catch {
      toast.error('复制失败');
    }
  };

  const openValue = (value: string) => {
    try {
      openExternalUrl(value);
    } catch {
      toast.error('打开站点失败');
    }
  };

  useEffect(() => {
    if (!panelOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [panelOpen]);

  const handleClick = () => {
    if (job) {
      setPanelOpen((open) => !open);
      return;
    }
    if (canDeploy) onOpenDialog();
  };

  const idleDisabled = !canDeploy && !job;

  return (
    <div ref={rootRef} className="relative inline-flex items-stretch">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          'h-7 gap-1 px-2 text-xs',
          onPublishMenu && 'rounded-r-none',
          running && 'text-amber-700 dark:text-amber-300',
          (job?.phase === 'failed' || job?.phase === 'error') && 'text-destructive',
          job?.phase === 'success' && 'text-emerald-700 dark:text-emerald-300',
        )}
        disabled={idleDisabled}
        title={
          running
            ? '点击查看当前发布进度'
            : job
              ? '点击查看最近一次发布结果'
              : canDeploy
                ? '先提交代码，再发起发布'
                : '当前无法发布（sai-cli 不可用或非云端建站应用）'
        }
        onClick={handleClick}
      >
        {running ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            发布中
          </>
        ) : job?.phase === 'failed' || job?.phase === 'error' ? (
          '发布失败'
        ) : job?.phase === 'success' ? (
          '发布成功'
        ) : job?.phase === 'timeout' ? (
          '发布超时'
        ) : (
          '发布'
        )}
      </Button>
      {onPublishMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={idleDisabled}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 w-6 rounded-l-none border-l border-border/60 px-0 text-xs',
                running && 'text-amber-700 dark:text-amber-300',
                (job?.phase === 'failed' || job?.phase === 'error') && 'text-destructive',
                job?.phase === 'success' && 'text-emerald-700 dark:text-emerald-300',
              )}
              aria-label="更多发布操作"
              title="更多发布操作"
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[260] min-w-[132px]">
            <DropdownMenuItem
              disabled={idleDisabled}
              onSelect={() => {
                setPanelOpen(false);
                onPublishMenu();
              }}
            >
              发布菜单
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {panelOpen && job ? (
        <div
          className={cn(
            'absolute right-0 top-full z-[80] mt-1 w-[320px] rounded-lg border border-border',
            'bg-background p-3 text-left shadow-[0_12px_32px_rgba(15,23,42,0.14)]',
          )}
          role="dialog"
          aria-label="发布状态"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground">
                {running ? '发布进行中' : '最近发布结果'}
              </div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">{job.label}</div>
            </div>
            {running ? (
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
          </div>

          <dl className="mt-3 space-y-1.5 text-[12px]">
            <StatusRow label="状态">
              {presentedFields?.status
                ? (isSpuriousPendingDeployFailure(job.fields)
                  ? presentedFields.status
                  : `${presentedFields.status}（${codeDeployProgressLabel(job.fields)}）`)
                : running
                  ? '准备中'
                  : '-'}
            </StatusRow>
            <StatusRow label="环境">{job.fields.env || '-'}</StatusRow>
            <StatusRow label="deploymentId" mono>
              {job.fields.deploymentId || '-'}
            </StatusRow>
            <StatusRow label="appCode" mono>
              {job.fields.appCode || '-'}
            </StatusRow>
            {job.fields.pipelineInstanceId ? (
              <StatusRow label="流水线">{job.fields.pipelineInstanceId}</StatusRow>
            ) : null}
            {presentedFields?.failureStage ? (
              <StatusRow label="失败阶段">{presentedFields.failureStage}</StatusRow>
            ) : null}
            {presentedFields?.failureMessage || job.error ? (
              <StatusRow label="失败原因">
                {presentedFields?.failureMessage || job.error}
              </StatusRow>
            ) : null}
          </dl>

          {successPresentation ? (
            <div className="mt-3 border-t border-border pt-3">
              {successPresentation.pageType === 'site' ? (
                <SitePublishSuccess
                  fixedUrl={successPresentation.fixedUrl}
                  onCopy={(value) => void copyValue(value)}
                  onOpen={openValue}
                />
              ) : (
                <AssetsPublishSuccess
                  version={successPresentation.version}
                  artifactUrl={successPresentation.artifactUrl}
                  customDomain={successPresentation.customDomain}
                  onCopy={(value) => void copyValue(value)}
                />
              )}
            </div>
          ) : null}

          {!running ? (
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {onFillComposer
                && (job.phase === 'failed' || job.phase === 'error' || job.phase === 'timeout')
                ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      onFillComposer(resolveStoAppDeployAskAiPrompt(job));
                      setPanelOpen(false);
                    }}
                  >
                    填入 AI 会话
                  </Button>
                )
                : null}
              {canDeploy ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    onClearTerminalJob?.();
                    setPanelOpen(false);
                    onOpenDialog();
                  }}
                >
                  再次发布
                </Button>
              ) : null}
              {onClearTerminalJob ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    onClearTerminalJob();
                    setPanelOpen(false);
                  }}
                >
                  关闭结果
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusRow({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[76px_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('break-all text-foreground', mono && 'font-mono text-[11px]')}>
        {children}
      </dd>
    </div>
  );
}
