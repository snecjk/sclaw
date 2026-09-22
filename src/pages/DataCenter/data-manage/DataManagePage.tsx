import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import excelIcon from '@/assets/icons/excel-icon.svg';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteFinanceBiDatasourceSon, listFinanceBiDatasourceSon } from '@/lib/finance-bi-api';
import { listCardHoverBorderShadowClass } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { FeedbackState } from '../components/entries';
import { DataCenterToolbarSearch, TabButton } from '../components/navigation';
import {
  dataCenterToolbarButtonClass,
  dataCenterToolbarInteractiveSurfaceClass,
} from '../components/toolbar-styles';
import { buildDataManageEmbedHref } from './constants';
import { DataManageDetailDrawer } from './DataManageDetailDrawer';
import {
  formatFieldSummary,
  formatModelRefsTitle,
  formatModelRefsUsage,
  isTableDatasource,
  toDatasourceViewItem,
  type DatasourceViewItem,
} from './datasource-view';

const actionBtnClass = (danger = false) => cn(
  'inline-flex h-7 shrink-0 items-center px-1 text-[12px] font-medium',
  danger
    ? 'text-[var(--sto-danger-primary)] hover:opacity-80'
    : 'text-[var(--sto-text-secondary)] hover:text-[var(--sto-brand-primary)]',
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[var(--sto-text-secondary)]',
);

const PAGE_SIZE = 20;
type DatasourceCategory = 'platform' | 'owned';
type DatasourceTypeFilter = '' | 'file' | 'api';

function typeFilterParam(filter: DatasourceTypeFilter): string | undefined {
  if (filter === 'file') return 'Excel';
  if (filter === 'api') return 'API';
  return undefined;
}

function statusToneClass(tone: DatasourceViewItem['statusTone']): string {
  if (tone === 'success') {
    return 'bg-[color-mix(in_srgb,var(--sto-success-primary)_14%,transparent)] text-[var(--sto-success-primary)]';
  }
  if (tone === 'danger') {
    return 'bg-[color-mix(in_srgb,var(--sto-danger-primary)_14%,transparent)] text-[var(--sto-danger-primary)]';
  }
  return 'bg-[color-mix(in_srgb,var(--sto-brand-primary)_14%,transparent)] text-[var(--sto-brand-primary)]';
}

function TypeMark({ mode }: { mode: DatasourceViewItem['accessMode'] }) {
  if (mode === 'file') {
    return (
      <img
        src={excelIcon}
        alt=""
        aria-hidden="true"
        className="h-7 w-7 shrink-0 object-contain"
        draggable={false}
      />
    );
  }
  const label = mode === 'api' ? 'API' : mode === 'db' ? 'DB' : '仓';
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[var(--sto-surface-subtle)] text-[10px] font-semibold text-[var(--sto-text-secondary)]">
      {label}
    </span>
  );
}

export function DataManagePage() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const authUserCode = useAuthStore((s) => s.user?.code ?? '');
  const [category, setCategory] = useState<DatasourceCategory>('platform');
  const [typeFilter, setTypeFilter] = useState<DatasourceTypeFilter>('');
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<DatasourceViewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [platformTotal, setPlatformTotal] = useState(0);
  const [ownedTotal, setOwnedTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [keywordDraft, setKeywordDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tip, setTip] = useState<{ visible: boolean; text: string; x: number; y: number }>({
    visible: false,
    text: '',
    x: 0,
    y: 0,
  });
  const [detailItem, setDetailItem] = useState<DatasourceViewItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<DatasourceViewItem | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  const fetchList = useCallback(async (
    nextPage: number,
    nextKeyword: string,
    nextCategory: DatasourceCategory,
    nextTypeFilter: DatasourceTypeFilter,
  ) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listFinanceBiDatasourceSon({
        page: nextPage,
        pageSize: PAGE_SIZE,
        keyword: nextKeyword.trim() || undefined,
        platformType: nextCategory === 'platform' ? 'platform' : 'user',
        publishStatus: nextCategory === 'platform' ? 'published' : undefined,
        type: typeFilterParam(nextTypeFilter),
      });
      if (seq !== requestSeq.current) return;
      let nextList = (result.list || []).map(toDatasourceViewItem);
      const query = nextKeyword.trim().toLowerCase();
      if (query) {
        nextList = nextList.filter((item) => {
          const nameHit = item.name.toLowerCase().includes(query);
          const fieldHit = item.fields.some((field) =>
            `${field.displayName}${field.rawName}`.toLowerCase().includes(query),
          );
          return nameHit || fieldHit;
        });
      }
      setList(nextList);
      setTotal(result.total || nextList.length);
      setPage(result.page || nextPage);
      if (!nextKeyword.trim() && !nextTypeFilter) {
        if (nextCategory === 'platform') setPlatformTotal(result.total || nextList.length);
        else setOwnedTotal(result.total || nextList.length);
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setList([]);
      setTotal(0);
      const message = err instanceof Error ? err.message : t('dataCenterPage.dataManage.loadFailedDescription');
      setError(message);
      toast.error(message);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [t]);

  const loadOtherTabCount = useCallback(async (current: DatasourceCategory) => {
    try {
      if (current === 'platform') {
        const owned = await listFinanceBiDatasourceSon({ page: 1, pageSize: 1, platformType: 'user' });
        setOwnedTotal(owned.total || 0);
        return;
      }
      const platform = await listFinanceBiDatasourceSon({
        page: 1,
        pageSize: 1,
        platformType: 'platform',
        publishStatus: 'published',
      });
      setPlatformTotal(platform.total || 0);
    } catch {
      if (current === 'platform') setOwnedTotal(0);
      else setPlatformTotal(0);
    }
  }, []);

  useEffect(() => {
    if (!authUserCode) {
      setList([]);
      setTotal(0);
      setPlatformTotal(0);
      setOwnedTotal(0);
      setError(null);
      setKeyword('');
      setKeywordDraft('');
      setPage(1);
      return;
    }
    setKeyword('');
    setKeywordDraft('');
    setTypeFilter('');
    setPage(1);
    void fetchList(1, '', category, '');
    void loadOtherTabCount(category);
  }, [authUserCode, category, fetchList, loadOtherTabCount]);

  useEffect(() => () => {
    requestSeq.current += 1;
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const onSearchChange = (value: string) => {
    setKeywordDraft(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setKeyword(value);
      void fetchList(1, value, category, typeFilter);
    }, 300);
  };

  const switchCategory = (next: DatasourceCategory) => {
    if (next === category) return;
    setCategory(next);
    setTypeFilter('');
    setKeyword('');
    setKeywordDraft('');
    setPage(1);
  };

  const switchTypeFilter = (next: DatasourceTypeFilter) => {
    setTypeFilter(next);
    setPage(1);
    void fetchList(1, keyword, category, next);
  };

  const showTip = (e: React.MouseEvent, text: string) => {
    const tipText = String(text || '').trim();
    if (!tipText) return;
    const offsetX = 14;
    const offsetY = -10;
    const maxW = 320;
    const pad = 8;
    let x = e.clientX + offsetX;
    let y = e.clientY + offsetY;
    if (x + maxW > window.innerWidth - pad) {
      x = Math.max(pad, e.clientX - maxW - 8);
    }
    if (y < pad + 36) {
      y = e.clientY + 14;
    }
    setTip({ visible: true, text: tipText, x, y });
  };

  const hideTip = () => setTip((prev) => ({ ...prev, visible: false }));

  const handleCreateOwned = () => {
    navigate(buildDataManageEmbedHref({ kind: 'create-owned' }));
  };

  const handleEditOwned = (item: DatasourceViewItem) => {
    if (isTableDatasource(item)) return;
    if (!item.code) {
      toast.warning(t('dataCenterPage.dataManage.missingCode'));
      return;
    }
    navigate(buildDataManageEmbedHref({ kind: 'edit-owned', editId: item.code }));
  };

  const handleOpenDetail = (item: DatasourceViewItem) => {
    hideTip();
    setDetailItem(item);
  };

  const handleDeleteOwned = async () => {
    const code = deleteItem?.code;
    if (!code) return;
    await deleteFinanceBiDatasourceSon(code);
    toast.success(t('dataCenterPage.dataManage.deleteSuccess'));
    setDeleteItem(null);
    void fetchList(page, keyword, category, typeFilter);
    void loadOtherTabCount(category);
  };

  const filterLabel = typeFilter === 'file'
    ? t('dataCenterPage.dataManage.filterFile')
    : typeFilter === 'api'
      ? t('dataCenterPage.dataManage.filterApi')
      : t('dataCenterPage.dataManage.filterAll');
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-[18px] shrink-0">
        <div className="flex min-w-0 items-center justify-between gap-4">
          <div className="flex h-9 items-center gap-8">
            <TabButton active={category === 'platform'} onClick={() => switchCategory('platform')}>
              {t('dataCenterPage.dataManage.platformTab')} {platformTotal}
            </TabButton>
            <TabButton active={category === 'owned'} onClick={() => switchCategory('owned')}>
              {t('dataCenterPage.dataManage.ownedTab')} {ownedTotal}
            </TabButton>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <DataCenterToolbarSearch
              value={keywordDraft}
              onValueChange={onSearchChange}
              placeholder={t('dataCenterPage.dataManage.searchPlaceholder')}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(dataCenterToolbarInteractiveSurfaceClass, 'inline-flex items-center justify-center px-3 text-[13px] font-medium outline-none')}
                >
                  {filterLabel}
                  <ChevronDown className="ml-1 h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[104px] rounded-[10px] p-2">
                <DropdownMenuItem onSelect={() => switchTypeFilter('')} className="text-[13px]">
                  {t('dataCenterPage.dataManage.filterAll')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => switchTypeFilter('file')} className="text-[13px]">
                  {t('dataCenterPage.dataManage.filterFile')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => switchTypeFilter('api')} className="text-[13px]">
                  {t('dataCenterPage.dataManage.filterApi')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              className={cn(dataCenterToolbarButtonClass, 'inline-flex items-center')}
              onClick={handleCreateOwned}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {t('dataCenterPage.dataManage.createOwned')}
            </button>
          </div>
        </div>
      </div>

      <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {error && !list.length ? (
          <FeedbackState
            icon={null}
            variant="plain"
            title={t('dataCenterPage.dataManage.loadFailedTitle')}
            description={error}
          />
        ) : loading && !list.length ? (
          <FeedbackState
            icon={<Loader2 className="h-8 w-8 animate-spin" />}
            variant="plain"
            title={t('dataCenterPage.dataManage.loading')}
            description={t('dataCenterPage.feedback.loadingDescription')}
          />
        ) : !loading && !list.length ? (
          <FeedbackState
            icon={null}
            variant="empty"
            title={keyword ? t('dataCenterPage.feedback.noMatch') : t('dataCenterPage.feedback.empty')}
            description={keyword ? '' : t('dataCenterPage.dataManage.emptyDescription')}
          />
        ) : (
          <div className="h-full min-h-0 flex-1 overflow-auto pr-1">
            <div className="flex flex-col gap-2">
              {list.map((item) => {
                const fieldSummary = formatFieldSummary(item.fields);
                const fieldAll = formatFieldSummary(item.fields, true);
                const refsText = formatModelRefsUsage(item.models);
                const refsTitle = formatModelRefsTitle(item.models);
                return (
                  <div
                    key={item.code || item.id}
                    className={cn(
                      'grid h-[56px] grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_64px_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_132px_minmax(120px,max-content)] items-center gap-2 rounded-[8px] border px-3 text-[12px] leading-5 text-[var(--sto-text-secondary)]',
                      listCardHoverBorderShadowClass,
                    )}
                  >
                    <div
                      className="flex min-w-0 items-center gap-2"
                      onMouseEnter={(e) => showTip(e, item.name)}
                      onMouseMove={(e) => showTip(e, item.name)}
                      onMouseLeave={hideTip}
                    >
                      <TypeMark mode={item.accessMode} />
                      <span className="truncate text-[13px] font-semibold leading-5 text-[var(--sto-text-primary)]">
                        {item.name}
                      </span>
                    </div>

                    <div
                      className="min-w-0 truncate"
                      onMouseEnter={(e) => showTip(e, fieldAll || t('dataCenterPage.dataManage.noFields'))}
                      onMouseMove={(e) => showTip(e, fieldAll || t('dataCenterPage.dataManage.noFields'))}
                      onMouseLeave={hideTip}
                    >
                      {fieldSummary
                        ? t('dataCenterPage.dataManage.fieldLabel', { value: fieldSummary })
                        : t('dataCenterPage.dataManage.noFields')}
                    </div>

                    <div>
                      <span
                        className={cn(
                          'inline-block max-w-full truncate rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium leading-[14px]',
                          statusToneClass(item.statusTone),
                        )}
                      >
                        {item.statusLabel}
                      </span>
                    </div>

                    <div
                      className="min-w-0 truncate"
                      onMouseEnter={(e) => showTip(e, refsTitle)}
                      onMouseMove={(e) => showTip(e, refsTitle)}
                      onMouseLeave={hideTip}
                    >
                      {refsText}
                    </div>

                    <div
                      className="min-w-0 truncate"
                      onMouseEnter={(e) => showTip(e, item.updateFreq)}
                      onMouseMove={(e) => showTip(e, item.updateFreq)}
                      onMouseLeave={hideTip}
                    >
                      {item.updateFreq}
                    </div>

                    <div
                      className={cn(
                        'min-w-0 truncate',
                        item.statusName ? 'text-[var(--sto-brand-primary)]' : 'text-[var(--sto-text-tertiary)]',
                      )}
                      onMouseEnter={(e) => showTip(e, item.statusName)}
                      onMouseMove={(e) => showTip(e, item.statusName)}
                      onMouseLeave={hideTip}
                    >
                      {item.statusName || '—'}
                    </div>

                    <div className="truncate">{item.updatedAt}</div>

                    <div className="flex items-center justify-end gap-1">
                      {category === 'owned' ? (
                        <button
                          type="button"
                          className={actionBtnClass()}
                          disabled={isTableDatasource(item)}
                          title={isTableDatasource(item) ? t('dataCenterPage.dataManage.editDisabledTable') : undefined}
                          onClick={() => handleEditOwned(item)}
                        >
                          {t('dataCenterPage.dataManage.edit')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={actionBtnClass()}
                        onClick={() => handleOpenDetail(item)}
                      >
                        {category === 'owned'
                          ? t('dataCenterPage.dataManage.detail')
                          : t('dataCenterPage.dataManage.view')}
                      </button>
                      {category === 'owned' ? (
                        <button
                          type="button"
                          className={actionBtnClass(true)}
                          onClick={() => setDeleteItem(item)}
                        >
                          {t('dataCenterPage.dataManage.delete')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {loading && list.length > 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--sto-main-bg)]/60">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--sto-icon-tertiary)]" />
          </div>
        ) : null}
      </section>

      {total > PAGE_SIZE ? (
        <div className="mt-[18px] flex shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            className={cn(dataCenterToolbarButtonClass, 'disabled:opacity-40')}
            onClick={() => void fetchList(page - 1, keyword, category, typeFilter)}
          >
            {t('dataCenterPage.dataManage.prevPage')}
          </button>
          <span className="text-[13px] text-[var(--sto-text-tertiary)]">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            className={cn(dataCenterToolbarButtonClass, 'disabled:opacity-40')}
            onClick={() => void fetchList(page + 1, keyword, category, typeFilter)}
          >
            {t('dataCenterPage.dataManage.nextPage')}
          </button>
        </div>
      ) : null}

      {tip.visible ? (
        <div
          className="pointer-events-none fixed z-[9999] max-w-[320px] rounded-md bg-[var(--sto-content-tooltip-background)] px-2.5 py-1.5 text-xs leading-4 text-[var(--sto-content-tooltip-foreground)] shadow"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      ) : null}

      {detailItem ? (
        <DataManageDetailDrawer
          item={detailItem}
          category={category}
          onClose={() => setDetailItem(null)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteItem)}
        title={t('dataCenterPage.dataManage.deleteTitle')}
        message={t('dataCenterPage.dataManage.deleteMessage')}
        confirmLabel={t('dataCenterPage.dataManage.deleteConfirm')}
        cancelLabel={t('dataCenterPage.dataManage.deleteCancel')}
        variant="destructive"
        onConfirm={handleDeleteOwned}
        onCancel={() => setDeleteItem(null)}
        onError={(error) => {
          const message = error instanceof Error ? error.message : t('dataCenterPage.dataManage.deleteFailed');
          toast.error(message);
        }}
      />
    </div>
  );
}
