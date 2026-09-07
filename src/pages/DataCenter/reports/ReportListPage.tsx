import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { listCardHoverBorderShadowClass } from '@/lib/surfaces';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  applyFinanceBiModelMenuAccess,
  formatFinanceBiAutoUpdate,
  formatFinanceBiCreator,
  listFinanceBiModelMenu,
  type FinanceBiModelMenuItem,
} from '@/lib/finance-bi-api';
import { FeedbackState } from '../components/entries';
import { DataCenterToolbarSearch, TabButton } from '../components/navigation';
import { dataCenterToolbarButtonClass } from '../components/toolbar-styles';
import { actionTooltipClass } from '../constants';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuthStore } from '@/stores/auth';

const PAGE_SIZE = 20;

function formatVisibleFields(model: FinanceBiModelMenuItem, all = false): string {
  const fields = model.coreFieldList || [];
  if (!fields.length) return '—';
  const names = fields
    .map((f) => f.name || f.originName || f.fieldName || '')
    .filter(Boolean);
  if (!names.length) return '—';
  if (all || names.length <= 3) return names.join('、');
  return `${names.slice(0, 3).join('、')} 等${names.length}个字段`;
}

function formatPublishTime(value?: string): string {
  if (!value) return '—';
  // 对齐「我的文件」时间展示：2026 / 08 / 19 17:33
  const raw = value.replace('T', ' ').slice(0, 16);
  const [datePart, timePart] = raw.split(' ');
  if (!datePart) return raw;
  return `${datePart.replace(/-/g, ' / ')}${timePart ? ` ${timePart}` : ''}`;
}

function permissionStatusText(model: FinanceBiModelMenuItem): string {
  if (model.hasPermission) return '已授权';
  if (model.accessRequestStatus === 'pending') return '申请中';
  return '未授权';
}

function permissionStatusClass(model: FinanceBiModelMenuItem): string {
  if (model.hasPermission) {
    return 'bg-[#E8FFEA] text-[#00B42A] dark:bg-emerald-950/40 dark:text-emerald-400';
  }
  if (model.accessRequestStatus === 'pending') {
    return 'bg-[#FFF7E8] text-[#FF7D00] dark:bg-amber-950/40 dark:text-amber-400';
  }
  return 'bg-[#F0F2F5] text-[#6B778C] dark:bg-muted dark:text-muted-foreground';
}

function applyButtonText(model: FinanceBiModelMenuItem): string {
  if (model.accessRequestStatus === 'pending') return '申请中';
  return '申请权限';
}

export function ReportListPage() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const authUserCode = useAuthStore((s) => s.user?.code ?? '');
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<FinanceBiModelMenuItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [keywordDraft, setKeywordDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [applySubmitting, setApplySubmitting] = useState(false);
  const [tip, setTip] = useState<{ visible: boolean; text: string; x: number; y: number }>({
    visible: false,
    text: '',
    x: 0,
    y: 0,
  });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchList = useCallback(async (nextPage: number, nextKeyword: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listFinanceBiModelMenu({
        page: nextPage,
        pageSize: PAGE_SIZE,
        keyword: nextKeyword.trim() || undefined,
      });
      setList(result?.list || []);
      setTotal(result?.total || 0);
      setPage(result?.page || nextPage);
    } catch (err) {
      setList([]);
      setTotal(0);
      const message = err instanceof Error ? err.message : t('dataCenterPage.financeReport.loadFailedDescription');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!authUserCode) {
      setList([]);
      setTotal(0);
      setError(null);
      setKeyword('');
      setKeywordDraft('');
      setPage(1);
      return;
    }
    setKeyword('');
    setKeywordDraft('');
    setPage(1);
    void fetchList(1, '');
  }, [fetchList, authUserCode]);

  const onSearchChange = (value: string) => {
    setKeywordDraft(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setKeyword(value);
      void fetchList(1, value);
    }, 300);
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

  const handleApply = async (model: FinanceBiModelMenuItem) => {
    if (!model.menuCode || applySubmitting) return;
    if (model.accessRequestStatus === 'pending') return;
    setApplySubmitting(true);
    try {
      await applyFinanceBiModelMenuAccess(model.menuCode);
      toast.success('已提交权限申请');
      await fetchList(page, keyword);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '申请权限失败');
    } finally {
      setApplySubmitting(false);
    }
  };

  const handleViewProduct = (model: FinanceBiModelMenuItem) => {
    if (!model.hasPermission) {
      toast.warning('暂无权限，请先申请权限');
      return;
    }
    if (!model.modelCode) {
      toast.warning('模型信息不完整，无法查看产物');
      return;
    }
    const query = new URLSearchParams({
      modelCode: model.modelCode,
      from: 'square-table',
    });
    if (model.modelName) query.set('modelName', model.modelName);
    navigate(`/data-center/reports/history?${query.toString()}`);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 对齐「我的文件」：第一行子 Tab + 搜索；第二行统计文案 */}
      <div className="mb-[18px] shrink-0">
        <div className="flex min-w-0 items-center justify-between gap-4">
          <div className="flex h-9 items-center gap-8">
            <TabButton active>{t('dataCenterPage.financeReport.allReports')}</TabButton>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <DataCenterToolbarSearch
              value={keywordDraft}
              onValueChange={onSearchChange}
              placeholder={t('dataCenterPage.financeReport.searchPlaceholder')}
            />
          </div>
        </div>

        <div className="mt-4 flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-5 text-[#1D2129] dark:text-foreground">
              {t('dataCenterPage.financeReport.totalCount', { count: total })}
            </p>
            <p className="text-[12px] leading-5 text-[#6B778C] dark:text-muted-foreground">
              {t('dataCenterPage.financeReport.listHint')}
            </p>
          </div>
        </div>
      </div>

      <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {error && !list.length ? (
          <FeedbackState
            icon={null}
            variant="plain"
            title={t('dataCenterPage.financeReport.loadFailedTitle')}
            description={error}
          />
        ) : loading && !list.length ? (
          <FeedbackState
            icon={<Loader2 className="h-8 w-8 animate-spin" />}
            variant="plain"
            title={t('dataCenterPage.financeReport.loading')}
            description={t('dataCenterPage.feedback.loadingDescription')}
          />
        ) : !loading && !list.length ? (
          <FeedbackState
            icon={null}
            variant="empty"
            title={keyword ? t('dataCenterPage.feedback.noMatch') : t('dataCenterPage.feedback.empty')}
            description={keyword ? '' : t('dataCenterPage.financeReport.emptyDescription')}
          />
        ) : (
          <div className="h-full min-h-0 flex-1 overflow-auto pr-1">
            <div className="flex flex-col gap-2">
              {list.map((model) => (
                <div
                  key={model.id}
                  className={cn(
                    'grid h-[56px] grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_72px_minmax(0,0.8fr)_minmax(0,0.9fr)_128px_48px] items-center gap-2 rounded-[8px] border px-3 text-[12px] leading-5 text-[#6B778C] transition-[background-color,border-color,box-shadow] duration-base dark:text-muted-foreground',
                    listCardHoverBorderShadowClass,
                    model.hasPermission && 'cursor-pointer',
                  )}
                  onClick={() => handleViewProduct(model)}
                >
                  <div
                    className="flex min-w-0 items-center gap-2"
                    onMouseEnter={(e) => showTip(e, model.modelName || '')}
                    onMouseMove={(e) => showTip(e, model.modelName || '')}
                    onMouseLeave={hideTip}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center text-[#4E5969] dark:text-muted-foreground">
                      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
                        <rect x="6" y="4" width="18" height="24" rx="2.5" fill="#EEF3FF" />
                        <path
                          d="M10 10h10M10 14.5h10M10 19h7"
                          stroke="#4E7FFF"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <span className="truncate text-[13px] font-semibold leading-5 text-[#1D2129] dark:text-foreground">
                      {model.modelName || '—'}
                    </span>
                  </div>

                  <div
                    className="min-w-0 truncate"
                    onMouseEnter={(e) => showTip(e, formatVisibleFields(model, true))}
                    onMouseMove={(e) => showTip(e, formatVisibleFields(model, true))}
                    onMouseLeave={hideTip}
                  >
                    {formatVisibleFields(model)}
                  </div>

                  <div>
                    <span
                      className={cn(
                        'inline-block max-w-full truncate rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium leading-[14px]',
                        permissionStatusClass(model),
                      )}
                    >
                      {permissionStatusText(model)}
                    </span>
                  </div>

                  <div
                    className="min-w-0 truncate"
                    onMouseEnter={(e) => showTip(e, formatFinanceBiAutoUpdate(model))}
                    onMouseMove={(e) => showTip(e, formatFinanceBiAutoUpdate(model))}
                    onMouseLeave={hideTip}
                  >
                    {formatFinanceBiAutoUpdate(model)}
                  </div>

                  <div
                    className="min-w-0 truncate"
                    onMouseEnter={(e) => showTip(e, formatFinanceBiCreator(model))}
                    onMouseMove={(e) => showTip(e, formatFinanceBiCreator(model))}
                    onMouseLeave={hideTip}
                  >
                    {formatFinanceBiCreator(model)}
                  </div>

                  <div className="truncate">{formatPublishTime(model.publishTime)}</div>

                  <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--sto-icon-secondary)] hover:bg-[#F2F3F5] hover:text-[#1D2129] dark:hover:bg-muted dark:hover:text-foreground"
                              aria-label="更多"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={6} className={actionTooltipClass}>
                          更多
                        </TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="end" className="min-w-[128px] rounded-[10px] p-2">
                        <DropdownMenuItem
                          disabled={!model.hasPermission}
                          onSelect={() => handleViewProduct(model)}
                          className="text-[13px]"
                        >
                          查看产物
                        </DropdownMenuItem>
                        {!model.hasPermission ? (
                          <DropdownMenuItem
                            disabled={model.accessRequestStatus === 'pending' || applySubmitting}
                            onSelect={() => { void handleApply(model); }}
                            className="text-[13px]"
                          >
                            {applyButtonText(model)}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading && list.length > 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--sto-main-bg)]/60">
            <Loader2 className="h-5 w-5 animate-spin text-[#86909C]" />
          </div>
        ) : null}
      </section>

      {total > PAGE_SIZE ? (
        <div className="mt-[18px] flex shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            className={cn(dataCenterToolbarButtonClass, 'disabled:opacity-40')}
            onClick={() => void fetchList(page - 1, keyword)}
          >
            上一页
          </button>
          <span className="text-[13px] text-[#86909C] dark:text-muted-foreground">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            className={cn(dataCenterToolbarButtonClass, 'disabled:opacity-40')}
            onClick={() => void fetchList(page + 1, keyword)}
          >
            下一页
          </button>
        </div>
      ) : null}

      {tip.visible ? (
        <div
          className="pointer-events-none fixed z-[9999] max-w-[320px] rounded-md bg-[#1D2129] px-2.5 py-1.5 text-xs leading-4 text-white shadow"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      ) : null}
    </div>
  );
}
