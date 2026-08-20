import { ChevronRight, Loader2, Plus, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { listCardHoverBorderShadowClass } from '@/lib/surfaces';
import { navigateToNewSessionWithDraft } from '@/lib/main-chat-navigation';
import {
  resolveManagedCliBinary,
  unwrapConnectorRuntime,
} from '../../../shared/connectors/normalize-runtime';
import type { ConnectorStatus, ConnectorViewItem } from '../../../shared/connectors/types';
import { TokenConnectModal } from './TokenConnectModal';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function needsTokenForm(item: ConnectorViewItem): boolean {
  if (item.kind === 'api_token') return true;
  if (item.kind !== 'managed_cli' && item.kind !== 'managed-cli') return false;
  const runtime = unwrapConnectorRuntime(asRecord(item.runtime));
  const binary = resolveManagedCliBinary(runtime, {
    connectorId: item.id,
    kind: item.kind,
  });
  const authType = String(asRecord(runtime.auth).type || '').toLowerCase();
  return binary === 'glab' || authType === 'api_token' || authType === 'token';
}

function primaryActionLabel(status: ConnectorStatus): string {
  if (status === 'connected') return '断开';
  if (status === 'installed') return '继续授权';
  if (status === 'error') return '重试连接';
  if (status === 'installing' || status === 'authorizing') return '连接中…';
  return '连接';
}

interface ConnectorCardProps {
  item: ConnectorViewItem;
  busy: boolean;
  onConnect: (id: string) => Promise<void>;
  onDisconnect: (id: string) => Promise<void>;
  onTokenConnect?: (connectorId: string, serverUrl: string, token: string) => Promise<void>;
}

export function ConnectorCard({ item, busy, onConnect, onDisconnect, onTokenConnect }: ConnectorCardProps) {
  const inFlight =
    busy || item.localStatus === 'installing' || item.localStatus === 'authorizing';
  const connected = item.localStatus === 'connected';
  const isTokenKind = needsTokenForm(item);
  const [detailOpen, setDetailOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const navigate = useNavigate();

  const handleConnect = useCallback(async () => {
    try {
      await onConnect(item.id);
      toast.success(`${item.name} 已连接`);
      setIntroOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      if (/取消/.test(message)) {
        toast.message(message);
        return;
      }
      toast.error(message);
    }
  }, [item.id, item.name, onConnect]);

  const handleDisconnect = useCallback(async () => {
    try {
      await onDisconnect(item.id);
      toast.success(`${item.name} 已断开`);
      setDetailOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    }
  }, [item.id, item.name, onDisconnect]);

  const handleTokenSubmit = useCallback(async (connectorId: string, serverUrl: string, token: string) => {
    if (onTokenConnect) {
      await onTokenConnect(connectorId, serverUrl, token);
      toast.success(`${item.name} 已连接`);
      setIntroOpen(false);
    }
  }, [item.name, onTokenConnect]);

  const openBoundDetail = useCallback(() => {
    setDetailOpen(true);
  }, []);

  const openIntro = useCallback(() => {
    if (inFlight) return;
    setIntroOpen(true);
  }, [inFlight]);

  const handleCardClick = useCallback(() => {
    if (connected) {
      openBoundDetail();
      return;
    }
    openIntro();
  }, [connected, openBoundDetail, openIntro]);

  const handleIntroConnect = useCallback(() => {
    if (isTokenKind) {
      setIntroOpen(false);
      setTokenModalOpen(true);
      return;
    }
    void handleConnect();
  }, [isTokenKind, handleConnect]);

  // 运营侧配置的试用提示词；旧服务端缺字段时保持 undefined，
  // 绝不用 description/summary 冒充提示词。
  const tryPrompt = item.prompt?.trim() ?? '';

  const handleTryPrompt = useCallback(() => {
    if (!tryPrompt) {
      toast.message('暂无试用提示词');
      return;
    }
    setDetailOpen(false);
    navigateToNewSessionWithDraft(navigate, tryPrompt);
  }, [navigate, tryPrompt]);

  return (
    <>
      <article
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCardClick();
          }
        }}
        className={cn(
          'group relative flex h-[80px] min-w-0 cursor-pointer items-center gap-3 overflow-hidden rounded-2xl border bg-white px-4',
          'border-border shadow-sm',
          'transition-[border-color,box-shadow] duration-200 ease-out',
          listCardHoverBorderShadowClass,
          'active:shadow-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          'dark:bg-background',
        )}
        title={item.lastError || undefined}
      >
        {item.iconUrl ? (
          <img
            src={item.iconUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-lg object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground transition-transform duration-200 group-hover:scale-105">
            {item.name.slice(0, 1)}
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="m-0 truncate text-[15px] font-bold leading-[22px] text-[#1D2129] dark:text-foreground">
              {item.name}
            </h3>
            {connected ? (
              <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            ) : null}
          </div>
          <p
            className={cn(
              'm-0 h-[36px] line-clamp-2 text-[13px] leading-[18px]',
              item.lastError
                ? 'text-destructive'
                : 'text-[#86909C] dark:text-muted-foreground',
            )}
          >
            {item.lastError || item.description || '\u00A0'}
          </p>
        </div>

        {connected ? (
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-white transition-colors hover:bg-[#F2F3F5] dark:bg-background"
            onClick={(e) => {
              e.stopPropagation();
              openBoundDetail();
            }}
            title="查看详情"
          >
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ) : (
          <button
            type="button"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-white transition-colors hover:bg-[#F2F3F5] dark:bg-background',
              inFlight && 'opacity-70',
            )}
            disabled={inFlight}
            onClick={(e) => {
              e.stopPropagation();
              openIntro();
            }}
            title={isTokenKind ? '配置连接' : primaryActionLabel(item.localStatus)}
          >
            {inFlight ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Plus className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        )}
      </article>

      {/* 未绑定 — 介绍弹框 */}
      {introOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setIntroOpen(false)}
        >
          <div
            className="relative w-[360px] rounded-2xl bg-white p-6 shadow-xl dark:bg-background"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[#F2F3F5]"
              onClick={() => setIntroOpen(false)}
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>

            <div className="flex flex-col items-center gap-3 pt-2">
              {item.iconUrl ? (
                <img src={item.iconUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-lg font-semibold text-muted-foreground">
                  {item.name.slice(0, 1)}
                </div>
              )}
              <h2 className="m-0 text-base font-bold text-[#1D2129] dark:text-foreground">
                {item.name}
              </h2>
              {item.description ? (
                <p className="m-0 text-center text-[13px] leading-[20px] text-[#86909C] dark:text-muted-foreground">
                  {item.description}
                </p>
              ) : null}
            </div>

            <div className="mt-6 flex items-center justify-center">
              <button
                type="button"
                className="inline-flex h-9 min-w-[120px] items-center justify-center gap-1.5 rounded-[10px] bg-primary px-8 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                disabled={inFlight}
                onClick={handleIntroConnect}
              >
                {inFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {inFlight ? '连接中…' : '连接'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 已绑定 — 详情弹框（与箭头一致） */}
      {detailOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDetailOpen(false)}
        >
          <div
            className="relative w-[360px] rounded-2xl bg-white p-6 shadow-xl dark:bg-background"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[#F2F3F5]"
              onClick={() => setDetailOpen(false)}
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>

            <div className="flex flex-col items-center gap-3 pt-2">
              {item.iconUrl ? (
                <img src={item.iconUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-lg font-semibold text-muted-foreground">
                  {item.name.slice(0, 1)}
                </div>
              )}
              <h2 className="m-0 text-base font-bold text-[#1D2129] dark:text-foreground">
                {item.name}
              </h2>
              {item.description ? (
                <p className="m-0 text-center text-[13px] leading-[20px] text-[#86909C] dark:text-muted-foreground">
                  {item.description}
                </p>
              ) : null}
            </div>

            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-destructive/40 px-5 text-[13px] font-medium text-destructive transition-colors hover:bg-destructive/5"
                onClick={() => void handleDisconnect()}
              >
                解绑
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-border px-5 text-[13px] font-medium text-[#1D2129] transition-colors hover:bg-[#F2F3F5] disabled:cursor-not-allowed disabled:opacity-50 dark:text-foreground"
                disabled={!tryPrompt}
                title={tryPrompt ? '到主聊天试用该连接器' : '暂无试用提示词'}
                onClick={handleTryPrompt}
              >
                去试试
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Token 类型 — 配置连接弹框 */}
      {tokenModalOpen ? (
        <TokenConnectModal
          item={item}
          onClose={() => setTokenModalOpen(false)}
          onSubmit={handleTokenSubmit}
        />
      ) : null}
    </>
  );
}
