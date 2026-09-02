import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CodeDeployEnv } from '@/lib/app-dev-api';
import { listAppExternalServiceBindings } from '@/lib/app-dev-api';
import type { CodeApplicationPageType } from '../../../shared/code-application-catalog';

const ENV_OPTIONS: Array<{ value: CodeDeployEnv; label: string; hint: string }> = [
  { value: 'daily', label: '日常 (daily)', hint: '开发/联调环境' },
  { value: 'stage', label: '预发 (stage)', hint: '预发布验证' },
  { value: 'online', label: '生产 (online)', hint: '线上环境，请谨慎' },
];

interface StoAppDeployDialogProps {
  open: boolean;
  appName: string;
  appCode?: string;
  workspaceId?: string;
  pageType?: CodeApplicationPageType;
  onCancel: () => void;
  onConfirm: (input: {
    env: CodeDeployEnv;
    deploymentVersion?: string;
  }) => void;
}

export function StoAppDeployDialog({
  open,
  appName,
  appCode,
  workspaceId,
  pageType = 'site',
  onCancel,
  onConfirm,
}: StoAppDeployDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [env, setEnv] = useState<CodeDeployEnv>('daily');
  const [deploymentVersion, setDeploymentVersion] = useState('');
  const [showAssetsIdentityWarning, setShowAssetsIdentityWarning] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setEnv('daily');
      setDeploymentVersion('');
      setShowAssetsIdentityWarning(false);
      cancelRef.current?.focus();
      if (pageType === 'assets' && workspaceId) {
        void listAppExternalServiceBindings(workspaceId)
          .then((items) => setShowAssetsIdentityWarning(
            items.some((item) => item.auth.type === 'stoToken'),
          ))
          .catch(() => setShowAssetsIdentityWarning(false));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, pageType, workspaceId]);

  if (!open) return null;

  const handleConfirm = () => {
    onConfirm({
      env,
      deploymentVersion: deploymentVersion.trim() || undefined,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-black/40 p-4 dark:bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sto-app-deploy-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className={cn(
          'w-full max-w-[460px] overflow-hidden rounded-[12px] border border-border bg-background p-5',
          'shadow-[0_12px_40px_rgba(15,23,42,0.12)]',
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="sto-app-deploy-title" className="text-[16px] font-semibold text-foreground">
            发布应用
          </h2>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={onCancel}
            aria-label="关闭"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          将「{appName}」部署到目标环境。确认后会先提交代码，再发起发布；
          弹窗会立即关闭，可在顶部「发布中」按钮查看进度。
        </p>

        <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
          应用编码（appCode）：
          <span className="ml-1 font-mono text-foreground">
            {appCode || '将从本机绑定/状态自动解析'}
          </span>
        </div>

        <fieldset className="mt-4 space-y-2">
          <legend className="mb-1.5 text-xs font-medium text-foreground">部署环境</legend>
          {ENV_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5',
                env === option.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-background hover:bg-muted/40',
              )}
            >
              <input
                type="radio"
                name="deploy-env"
                className="mt-1"
                checked={env === option.value}
                onChange={() => setEnv(option.value)}
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-foreground">{option.label}</span>
                <span className="block text-[11px] text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">
            部署版本（可选）
          </span>
          <input
            value={deploymentVersion}
            onChange={(event) => setDeploymentVersion(event.target.value)}
            className={cn(
              'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
            )}
            placeholder="不填则由服务端生成"
          />
        </label>

        {env === 'online' ? (
          <p className="mt-3 text-[12px] text-[var(--sto-functional-warning)] dark:text-amber-300">
            即将发布到生产环境，请确认代码已在预发验证通过。
          </p>
        ) : null}

        {showAssetsIdentityWarning ? (
          <p className="mt-3 rounded-lg bg-[var(--sto-functional-warning)]/10 px-3 py-2 text-[12px] text-[var(--sto-functional-warning)] dark:text-amber-300">
            Assets 发布后由 iframe 宿主提供身份；请确认宿主已接入 Token Bridge。
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
          >
            确认发布（先提交再发布）
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
