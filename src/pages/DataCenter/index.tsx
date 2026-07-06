/**
 * /data-center — 侧栏「数据中心」，页内：数据中心 → 线上数据 → 客户关系卡片。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, isSiteUser } from '@/stores/auth';
import { cn } from '@/lib/utils';
import {
  stoMainInnerShell,
  stoPageTitleClass,
  workflowListCardBodyClass,
  workflowListCardCoverClass,
  workflowListCardCoverWrapClass,
  workflowListCardMainClass,
  workflowListCardShellClass,
  workflowListTabClass,
} from '@/lib/surfaces';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { getAppEnv } from '../../../shared/env-config';
import customerRelationsCardIcon from '@/assets/data-center-customer-relations-card.png';

const DATA_CENTER_URLS: Record<string, string> = {
  production: 'https://wd-vip.sto.cn/claw-businessOrganization',
  staging: 'https://pre-wd-vip.sto.cn/claw-businessOrganization',
  test: 'https://wd-vip-test.sto.cn/claw-businessOrganization',
  development: 'https://wd-vip-test.sto.cn/claw-businessOrganization',
};

function CustomerRelationsIframe({ token }: { token: string }) {
  const { t } = useTranslation('common');

  const iframeUrl = useMemo(() => {
    const trimmed = token.trim();
    if (!trimmed) return null;
    const appEnv = getAppEnv();
    const baseUrl = DATA_CENTER_URLS[appEnv] ?? DATA_CENTER_URLS.production;
    return `${baseUrl}?token=${encodeURIComponent(trimmed)}`;
  }, [token]);

  if (!iframeUrl) {
    return (
      <div className="flex min-h-[400px] flex-1 items-center justify-center rounded-2xl border border-border bg-card dark:bg-secondary">
        <p className="text-sm text-muted-foreground">{t('dataCenterPage.linkUnavailable')}</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card dark:bg-secondary">
      <iframe
        src={iframeUrl}
        className="h-[calc(100%+50px)] w-full border-0"
        title={t('dataCenterPage.customerRelationsTitle')}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

function CustomerRelationsCard({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation('common');

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        workflowListCardShellClass,
        'w-[278px] max-w-full text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      <div className={workflowListCardCoverWrapClass}>
        <div
          className={cn(
            workflowListCardCoverClass,
            'flex h-[90px] items-center justify-center bg-[rgba(255,232,193,0.25)] dark:bg-primary/10',
          )}
        >
          <img
            src={customerRelationsCardIcon}
            alt=""
            className="h-[96px] w-auto max-w-[85%] object-contain"
            draggable={false}
          />
        </div>
      </div>
      <div className={workflowListCardBodyClass}>
        <div className={workflowListCardMainClass}>
          <h3 className="text-base font-semibold leading-6 text-foreground">
            {t('dataCenterPage.customerRelationsTitle')}
          </h3>
          <p className="text-sm leading-[22px] text-muted-foreground">
            {t('dataCenterPage.customerRelationsDesc')}
          </p>
        </div>
      </div>
    </button>
  );
}

const DATA_CENTER_TABS = [
  { key: 'online', labelKey: 'dataCenterPage.onlineTab' as const, disabled: false },
  { key: 'local', labelKey: 'dataCenterPage.localTab' as const, disabled: true },
  { key: 'access', labelKey: 'dataCenterPage.dataAccessTab' as const, disabled: true },
];

function DataCenterTabs() {
  const { t } = useTranslation('common');

  return (
    <div
      className="mt-6 flex shrink-0 items-center gap-5 border-b border-border pb-3"
      role="tablist"
      aria-label={t('dataCenterPage.tabAria')}
    >
      {DATA_CENTER_TABS.map((tab) =>
        tab.disabled ? (
          <span
            key={tab.key}
            role="tab"
            aria-selected={false}
            aria-disabled="true"
            className={cn(workflowListTabClass(false), 'cursor-not-allowed opacity-45')}
          >
            {t(tab.labelKey)}
          </span>
        ) : (
          <span key={tab.key} role="tab" aria-selected className={workflowListTabClass(true)}>
            {t(tab.labelKey)}
          </span>
        ),
      )}
    </div>
  );
}

export function DataCenter() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const authUser = useAuthStore((s) => s.user);
  const siteDepartmentTypes = useAuthStore((s) => s.siteDepartmentTypes);
  const isSite =
    siteDepartmentTypes !== null && isSiteUser(authUser?.categoryCode);
  const stoToken = authUser?.stoToken?.trim() ?? '';
  const [opened, setOpened] = useState(false);
  const pageTitle = t('dataCenterPage.title');

  useEffect(() => {
    if (siteDepartmentTypes !== null && !isSite) {
      navigate('/', { replace: true });
    }
  }, [isSite, navigate, siteDepartmentTypes]);

  if (siteDepartmentTypes === null) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col items-center justify-center', stoMainInnerShell)}>
        <LoadingSpinner />
      </div>
    );
  }

  if (!isSite) {
    return null;
  }

  if (!stoToken) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col', stoMainInnerShell)}>
        <div className="flex flex-1 items-center justify-center">
          <p className="text-base text-muted-foreground">{t('dataCenterPage.tokenMissing')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', stoMainInnerShell)}>
      <header className="shrink-0">
        <h1 className={stoPageTitleClass}>{pageTitle}</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
          {t('dataCenterPage.subtitle')}
        </p>
      </header>

      <DataCenterTabs />

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        {opened ? (
          <>
            <button
              type="button"
              onClick={() => setOpened(false)}
              className="mb-4 inline-flex w-fit items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {t('actions.back')}
            </button>
            <CustomerRelationsIframe token={stoToken} />
          </>
        ) : (
          <div className="flex flex-wrap gap-3">
            <CustomerRelationsCard onOpen={() => setOpened(true)} />
          </div>
        )}
      </div>
    </div>
  );
}
