import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  accessModeLabel,
  authTypeLabel,
  type DatasourceViewItem,
} from './datasource-view';

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[12px] text-[var(--sto-text-tertiary)]">{label}</span>
      <b className="mt-0.5 block break-all text-[13px] font-medium text-[var(--sto-text-primary)]">{value || '—'}</b>
    </div>
  );
}

export function DataManageDetailDrawer({
  item,
  category,
  onClose,
}: {
  item: DatasourceViewItem;
  category: 'platform' | 'owned';
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  const isOwned = category === 'owned';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const handleClose = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return createPortal(
    <div className="no-drag pointer-events-auto fixed inset-0 z-[200] isolate">
      <div
        className="sto-overlay-scrim no-drag absolute inset-0"
        aria-hidden="true"
        onMouseDown={handleClose}
      />
      <aside
        className={cn(
          'sto-overlay sto-overlay--side-panel no-drag',
          'absolute inset-y-0 right-0 z-10 flex w-[min(720px,92vw)] flex-col overflow-hidden border-l',
        )}
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="no-drag flex shrink-0 items-start justify-between gap-3 border-b border-[var(--sto-border-default)] px-6 py-[18px]">
          <div className="min-w-0">
            <h3 className="truncate text-[16px] font-semibold text-[var(--sto-text-primary)]">{item.name}</h3>
            <p className="mt-1.5 text-[13px] text-[var(--sto-text-tertiary)]">
              {isOwned ? t('dataCenterPage.dataManage.ownedTab') : t('dataCenterPage.dataManage.platformTab')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('dataCenterPage.dataManage.detailClose')}
            onMouseDown={handleClose}
            onClick={handleClose}
            className="no-drag pointer-events-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--sto-icon-secondary)] hover:bg-[var(--sto-control-hover-bg)]"
          >
            <X className="h-4 w-4 pointer-events-none" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          <section className="mb-[22px]">
            <h4 className="mb-3 text-[13px] font-semibold text-[var(--sto-text-primary)]">
              {t('dataCenterPage.dataManage.detailBasic')}
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {isOwned ? (
                <InfoItem label={t('dataCenterPage.dataManage.detailAccessMode')} value={accessModeLabel(item.accessMode)} />
              ) : (
                <InfoItem label={t('dataCenterPage.dataManage.detailGroup')} value={item.group} />
              )}
              <InfoItem label={t('dataCenterPage.dataManage.detailDescription')} value={item.description || t('dataCenterPage.dataManage.detailEmpty')} />
              {isOwned ? (
                <>
                  <InfoItem label={t('dataCenterPage.dataManage.detailCreator')} value={item.createByName} />
                  <InfoItem label={t('dataCenterPage.dataManage.detailCreateTime')} value={item.createTime} />
                </>
              ) : null}
            </div>
          </section>

          {isOwned && item.apiConfig ? (
            <section className="mb-[22px]">
              <h4 className="mb-3 text-[13px] font-semibold text-[var(--sto-text-primary)]">
                {t('dataCenterPage.dataManage.detailApi')}
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <InfoItem label={t('dataCenterPage.dataManage.detailApiUrl')} value={item.apiConfig.url} />
                <InfoItem label={t('dataCenterPage.dataManage.detailApiMethod')} value={item.apiConfig.method} />
                <InfoItem label={t('dataCenterPage.dataManage.detailApiAuth')} value={authTypeLabel(item.apiConfig.authType)} />
                <InfoItem
                  label={t('dataCenterPage.dataManage.detailApiRetry')}
                  value={`${item.apiConfig.timeout}s / ${item.apiConfig.retry}次 / ${item.apiConfig.retryInterval}s`}
                />
              </div>
            </section>
          ) : null}

          <section className="mb-[22px]">
            <h4 className="mb-3 text-[13px] font-semibold text-[var(--sto-text-primary)]">
              {t('dataCenterPage.dataManage.detailRuntime')}
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <InfoItem label={t('dataCenterPage.dataManage.detailStatus')} value={item.statusName || item.statusLabel} />
              <InfoItem label={t('dataCenterPage.dataManage.detailMsg')} value={item.msg} />
              <InfoItem label={t('dataCenterPage.dataManage.detailFreq')} value={item.updateFreq} />
              <InfoItem label={t('dataCenterPage.dataManage.detailFailPolicy')} value={item.failPolicy} />
              <InfoItem label={t('dataCenterPage.dataManage.detailSyncRange')} value={item.syncTimeRange} />
            </div>
          </section>

          <section>
            <h4 className="mb-3 text-[13px] font-semibold text-[var(--sto-text-primary)]">
              {t('dataCenterPage.dataManage.detailFields', { count: item.fields.length })}
            </h4>
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="text-[var(--sto-text-tertiary)]">
                  <th className="border-b border-[var(--sto-border-default)] py-2 pr-2 font-medium">{t('dataCenterPage.dataManage.detailFieldName')}</th>
                  <th className="border-b border-[var(--sto-border-default)] py-2 pr-2 font-medium">{t('dataCenterPage.dataManage.detailFieldRaw')}</th>
                  <th className="border-b border-[var(--sto-border-default)] py-2 pr-2 font-medium">{t('dataCenterPage.dataManage.detailFieldType')}</th>
                  <th className="border-b border-[var(--sto-border-default)] py-2 font-medium">{t('dataCenterPage.dataManage.detailFieldSample')}</th>
                </tr>
              </thead>
              <tbody>
                {item.fields.length ? item.fields.map((field) => (
                  <tr key={`${field.rawName}-${field.displayName}`} className="text-[var(--sto-text-secondary)]">
                    <td className="border-b border-[var(--sto-border-default)] py-2 pr-2">{field.displayName}</td>
                    <td className="border-b border-[var(--sto-border-default)] py-2 pr-2">{field.oldName || field.rawName || '—'}</td>
                    <td className="border-b border-[var(--sto-border-default)] py-2 pr-2">{field.type || '—'}</td>
                    <td className="border-b border-[var(--sto-border-default)] py-2">{field.sample || '—'}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} className="py-3 text-[var(--sto-text-tertiary)]">{t('dataCenterPage.dataManage.noFields')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
