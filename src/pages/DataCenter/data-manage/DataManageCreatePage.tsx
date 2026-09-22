/**
 * 数据管理 preview 嵌入页 — 全屏：无侧栏、无外壳滚动、贴齐窗口。
 * 仅覆盖数据源新建 / 编辑；token 有效直达，失效才走免登。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useContentHeader } from '@/components/layout/content-header-context';
import type { FinanceBiPreviewEmbedAuth } from '@/lib/finance-bi-api';
import {
  contentHeaderActionBtnClass,
  contentHeaderTitleClass,
} from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import {
  buildDataManagePreviewUrl,
  DATA_MANAGE_LIST_HREF,
  isPreviewLeaveHash,
  parseDataManageEmbedSearch,
  type DataManagePreviewTarget,
} from './constants';
import {
  buildPreviewAuthInjectScript,
  resolveDataManagePreviewEmbed,
} from './create-owned-sso';
import './data-manage-create-page.css';

type EmbedWebviewElement = HTMLElement & {
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
  getURL?: () => string;
};

const FINANCE_BI_PREVIEW_PARTITION = 'persist:finance-bi-preview';
const SCLAW_EMBED_MESSAGE_TYPE = 'sclaw-finance-bi-embed';

function embedTitleKey(target: DataManagePreviewTarget): string {
  if (target.kind === 'edit-owned') return 'dataCenterPage.dataManage.edit';
  return 'dataCenterPage.dataManage.createOwned';
}

function DataManageEmbedFrame({
  url,
  title,
  injectAuth,
  preloadUrl,
  onEmbedBack,
}: {
  url: string;
  title: string;
  injectAuth?: FinanceBiPreviewEmbedAuth;
  preloadUrl?: string;
  onEmbedBack: () => void;
}) {
  const webviewRef = useRef<EmbedWebviewElement | null>(null);
  const isElectron = Boolean(window.electron);

  useEffect(() => {
    const frame = webviewRef.current;
    if (!frame || !isElectron) return;

    const script = injectAuth?.token ? buildPreviewAuthInjectScript(injectAuth) : '';
    const inject = () => {
      if (script) void frame.executeJavaScript?.(script).catch(() => undefined);
    };
    const onIpcMessage = (event: Event) => {
      const detail = event as Event & { channel?: string; args?: Array<{ action?: string }> };
      if (detail.channel === SCLAW_EMBED_MESSAGE_TYPE && detail.args?.[0]?.action === 'back') {
        onEmbedBack();
      }
    };
    const onGuestNavigate = () => {
      const pageUrl = frame.getURL?.() || '';
      if (isPreviewLeaveHash(pageUrl)) onEmbedBack();
    };

    frame.addEventListener('dom-ready', inject);
    frame.addEventListener('ipc-message', onIpcMessage);
    frame.addEventListener('did-navigate', onGuestNavigate);
    frame.addEventListener('did-navigate-in-page', onGuestNavigate);
    return () => {
      frame.removeEventListener('dom-ready', inject);
      frame.removeEventListener('ipc-message', onIpcMessage);
      frame.removeEventListener('did-navigate', onGuestNavigate);
      frame.removeEventListener('did-navigate-in-page', onGuestNavigate);
    };
  }, [injectAuth, isElectron, onEmbedBack, url]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === SCLAW_EMBED_MESSAGE_TYPE && event.data?.action === 'back') {
        onEmbedBack();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onEmbedBack]);

  if (isElectron) {
    return (
      <webview
        ref={webviewRef as unknown as Ref<HTMLElement>}
        src={url}
        title={title}
        partition={FINANCE_BI_PREVIEW_PARTITION}
        preload={injectAuth?.preloadUrl || preloadUrl}
      />
    );
  }
  return (
    <iframe
      title={title}
      src={url}
    />
  );
}

export function DataManageCreatePage() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const target = useMemo(() => parseDataManageEmbedSearch(location.search), [location.search]);
  const previewUrl = useMemo(() => buildDataManagePreviewUrl(target), [target]);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [injectAuth, setInjectAuth] = useState<FinanceBiPreviewEmbedAuth | undefined>(undefined);
  const [preloadUrl, setPreloadUrl] = useState<string | undefined>(undefined);

  const handleBack = useCallback(() => {
    navigate(DATA_MANAGE_LIST_HREF);
  }, [navigate]);

  const titleText = t(embedTitleKey(target));

  const title = useMemo(
    () => (
      <div className="no-drag flex min-w-0 max-w-full items-center gap-1 overflow-hidden">
        <button
          type="button"
          aria-label={t('dataCenterPage.dataManage.createOwnedBackAria')}
          onClick={handleBack}
          className={cn(contentHeaderActionBtnClass, 'text-foreground/80 hover:bg-muted')}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <p className={contentHeaderTitleClass}>{titleText}</p>
      </div>
    ),
    [handleBack, t, titleText],
  );

  useContentHeader({ title });

  useEffect(() => {
    let cancelled = false;
    setEmbedUrl(null);
    setInjectAuth(undefined);
    setPreloadUrl(undefined);
    void resolveDataManagePreviewEmbed(previewUrl)
      .then((resolved) => {
        if (cancelled) return;
        setInjectAuth(resolved.injectAuth);
        setPreloadUrl(resolved.preloadUrl || resolved.injectAuth?.preloadUrl);
        setEmbedUrl(resolved.url);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : t('dataCenterPage.dataManage.createOwnedSsoFailed');
        toast.error(message);
        setInjectAuth(undefined);
        setPreloadUrl(undefined);
        setEmbedUrl(previewUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  return (
    <div className="data-manage-create-page">
      <div className="data-manage-create-page__frame">
        {embedUrl ? (
          <DataManageEmbedFrame
            url={embedUrl}
            title={titleText}
            injectAuth={injectAuth}
            preloadUrl={preloadUrl}
            onEmbedBack={handleBack}
          />
        ) : (
          <div
            className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 text-[var(--sto-text-secondary)]"
            role="status"
          >
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            <p className="text-[13px]">{t('dataCenterPage.dataManage.createOwnedSsoLoading')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
