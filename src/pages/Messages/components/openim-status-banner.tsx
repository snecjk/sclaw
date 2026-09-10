import type { OpenIMConnectionStatus } from '../hooks/use-openim-messages';

export function OpenIMStatusBanner({
  status,
  error,
  onRetry,
}: {
  status: OpenIMConnectionStatus;
  error: string | null;
  conversationCount?: number;
  onRetry?: () => void;
}) {
  // Ready: no banner. Only surface mock / connecting / error.
  if (status === 'ready') {
    return null;
  }

  if (status === 'mock') {
    return (
      <div className="border-b border-[var(--sto-border-default)] bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-800 dark:text-amber-200">
        OpenIM 未启用（Mock 数据）。请检查 `.env.development.local` 并重启 `pnpm dev`。
      </div>
    );
  }

  const label = status === 'connecting'
    ? '正在连接...'
    : `连接失败${error ? `：${error}` : ''}`;

  const tone = status === 'connecting'
    ? 'bg-sky-500/10 text-sky-800 dark:text-sky-200'
    : 'bg-destructive/10 text-destructive';

  return (
    <div className={`flex items-center justify-between gap-2 border-b border-[var(--sto-border-default)] px-3 py-1.5 text-[12px] ${tone}`}>
      <span>OpenIM {label}</span>
      {(status === 'error' || status === 'connecting') && onRetry ? (
        <button
          type="button"
          className={`shrink-0 rounded px-2 py-0.5 text-[12px] underline ${status === 'connecting' ? 'opacity-70' : ''}`}
          onClick={onRetry}
        >
          重试
        </button>
      ) : null}
    </div>
  );
}
