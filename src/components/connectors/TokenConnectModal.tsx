import { Eye, EyeOff, ExternalLink, Loader2, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import type { ConnectorViewItem, TokenAuthRuntimeSpec } from '../../../shared/connectors/types';
import {
  resolveManagedCliBinary,
  unwrapConnectorRuntime,
} from '../../../shared/connectors/normalize-runtime';

function resolveTokenRuntime(runtime: Record<string, unknown> | undefined): TokenAuthRuntimeSpec {
  return unwrapConnectorRuntime(runtime) as TokenAuthRuntimeSpec;
}

function isGlabConnect(item: ConnectorViewItem): boolean {
  const runtime = unwrapConnectorRuntime(item.runtime as Record<string, unknown>);
  return (
    resolveManagedCliBinary(runtime, {
      connectorId: item.id,
      kind: item.kind,
      hasCredentials: true,
    }) === 'glab'
  );
}

interface TokenConnectModalProps {
  item: ConnectorViewItem;
  onClose: () => void;
  onSubmit: (connectorId: string, serverUrl: string, token: string) => Promise<void>;
}

export function TokenConnectModal({ item, onClose, onSubmit }: TokenConnectModalProps) {
  const runtime = resolveTokenRuntime(item.runtime as Record<string, unknown> | undefined);
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = serverUrl.trim().length > 0 && token.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(item.id, serverUrl.trim(), token.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败');
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, item.id, serverUrl, token, onSubmit, onClose]);

  return (
    <div
      className="sto-overlay-scrim sto-overlay-scrim--dialog fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="sto-overlay sto-overlay--dialog relative w-[420px] rounded-[var(--sto-dialog-radius)] border p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="sto-control sto-dialog-close absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full transition-colors"
          onClick={onClose}
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 pr-8">
          {item.iconUrl ? (
            <img src={item.iconUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground">
              {item.name.slice(0, 1)}
            </div>
          )}
          <div>
            <h2 className="m-0 text-[15px] font-bold text-[#1D2129] dark:text-foreground">
              连接 {item.name}
            </h2>
            <p className="m-0 text-[12px] text-[#86909C]">
              {isGlabConnect(item)
                ? '安装 glab 并用 Personal Access Token 授权（支持 git pull）'
                : '通过 Personal Access Token 授权'}
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="mt-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-[#1D2129] dark:text-foreground">
              服务器地址
            </label>
            <input
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder={runtime?.serverUrlHint || 'https://gitlab.example.com'}
              className="h-9 rounded-[10px] border border-border bg-white px-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 dark:bg-background"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-[#1D2129] dark:text-foreground">
              Personal Access Token
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={runtime?.tokenHint || '粘贴你的 Token'}
                className="h-9 w-full rounded-[10px] border border-border bg-white px-3 pr-9 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 dark:bg-background"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowToken((v) => !v)}
                tabIndex={-1}
              >
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {runtime?.requiredScopes?.length ? (
              <p className="m-0 text-[11px] text-[#86909C]">
                需要的 Scopes：{runtime.requiredScopes.join(', ')}
              </p>
            ) : null}
          </div>

          {runtime?.helpUrl ? (
            <a
              href={runtime.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              如何创建 Token？
            </a>
          ) : null}

          {error ? (
            <div className="rounded-[10px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div className="sto-dialog-footer mt-6">
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-[10px] border border-border px-5 text-[13px] font-medium text-[#1D2129] hover:bg-[#F2F3F5] transition-colors dark:text-foreground"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="sto-control sto-control--dialog-primary inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] px-5 text-[13px] font-medium transition-colors"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            连接
          </button>
        </div>
      </div>
    </div>
  );
}
