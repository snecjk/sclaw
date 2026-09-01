import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  stoMainInnerShell,
  stoPageTitleClass,
} from '@/lib/surfaces';
import {
  exportFinanceBiProductData,
  financeBiBatchStatusLabel,
  financeBiFieldKey,
  inferFinanceBiFilterType,
  isFinanceBiProductRecordReady,
  listFinanceBiProductExportRecords,
  listFinanceBiProductModelOptions,
  listFinanceBiProducts,
  pickFinanceBiProductRecord,
  queryFinanceBiProductRecord,
  type FinanceBiExportRecord,
  type FinanceBiProductBatch,
  type FinanceBiProductFilterType,
  type FinanceBiProductModelOption,
  type FinanceBiProductPreviewField,
  type FinanceBiProductPreviewFilter,
} from '@/lib/finance-bi-api';
import { dataCenterToolbarButtonClass } from '../components/toolbar-styles';
import { ReportDateRangePicker, type ReportDateRangeValue } from './ReportDateRangePicker';
import { ReportFilterSelect } from './ReportFilterSelect';

const PREVIEW_PAGE_SIZE = 50;
const DOWNLOAD_PAGE_SIZE = 20;

type FilterDraft = {
  filterType: FinanceBiProductFilterType;
  value: string;
  min: string;
  max: string;
};

type TableFilterState = {
  selectedKeys: string[];
  drafts: Record<string, FilterDraft>;
  applied: FinanceBiProductPreviewFilter[];
};

function emptyFilterState(): TableFilterState {
  return { selectedKeys: [], drafts: {}, applied: [] };
}

function formatBatchOptionLabel(batch: FinanceBiProductBatch): string {
  const name = (batch.batchName || '').trim() || '未命名产物';
  const time = (batch.createTime || '').replace('T', ' ').slice(0, 16);
  const status = financeBiBatchStatusLabel(batch.batchStatus);
  return [name, time, status].filter(Boolean).join(' · ');
}

function createDraft(type: FinanceBiProductFilterType, prev?: FilterDraft): FilterDraft {
  return {
    filterType: type,
    value: prev?.value || '',
    min: prev?.min || '',
    max: prev?.max || '',
  };
}

function buildFiltersFromDrafts(
  selectedKeys: string[],
  drafts: Record<string, FilterDraft>,
): FinanceBiProductPreviewFilter[] {
  const filters: FinanceBiProductPreviewFilter[] = [];
  for (const key of selectedKeys) {
    const draft = drafts[key];
    if (!draft) continue;
    if (draft.filterType === 'text') {
      const value = draft.value.trim();
      if (!value) continue;
      filters.push({ field: key, filterType: 'text', value });
      continue;
    }
    const min = draft.min.trim();
    const max = draft.max.trim();
    if (!min && !max) continue;
    filters.push({ field: key, filterType: draft.filterType, min: min || undefined, max: max || undefined });
  }
  return filters;
}

function silentDownload(url: string) {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = url;
  document.body.appendChild(iframe);
  window.setTimeout(() => {
    iframe.remove();
  }, 60_000);
}

export function ReportHistoryPage() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialModelCode = (searchParams.get('modelCode') || '').trim();
  const initialModelName = (searchParams.get('modelName') || '').trim();

  const [modelOptions, setModelOptions] = useState<FinanceBiProductModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState(initialModelCode);
  const [runDateRange, setRunDateRange] = useState<ReportDateRangeValue>(null);
  const [batches, setBatches] = useState<FinanceBiProductBatch[]>([]);
  const [selectedBatchCode, setSelectedBatchCode] = useState('');
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [previewTableType, setPreviewTableType] = useState<'detail' | 'summary'>('detail');
  const [appliedBatch, setAppliedBatch] = useState<FinanceBiProductBatch | null>(null);
  const [fields, setFields] = useState<FinanceBiProductPreviewField[]>([]);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [columnTotals, setColumnTotals] = useState<Record<string, string>>({});
  const [previewTotal, setPreviewTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [previewReady, setPreviewReady] = useState(false);

  const [filterStateByTable, setFilterStateByTable] = useState<Record<'detail' | 'summary', TableFilterState>>({
    detail: emptyFilterState(),
    summary: emptyFilterState(),
  });
  const [filterAreaExpanded, setFilterAreaExpanded] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [pendingFilterKeys, setPendingFilterKeys] = useState<string[]>([]);

  const [downloadCenterOpen, setDownloadCenterOpen] = useState(false);
  const [downloadCenterLoading, setDownloadCenterLoading] = useState(false);
  const [downloadRecords, setDownloadRecords] = useState<FinanceBiExportRecord[]>([]);
  const [downloadCenterPage, setDownloadCenterPage] = useState(1);
  const [downloadCenterTotal, setDownloadCenterTotal] = useState(0);
  const [downloadCenterBump, setDownloadCenterBump] = useState(false);

  const selectedBatch = useMemo(
    () => batches.find((b) => b.batchCode === selectedBatchCode) || null,
    [batches, selectedBatchCode],
  );

  const currentFilterState = filterStateByTable[previewTableType];
  const selectedFilterFields = useMemo(() => {
    return fields
      .map((field, index) => {
        const key = financeBiFieldKey(field, index);
        return { key, field, filterType: inferFinanceBiFilterType(field) };
      })
      .filter((item) => currentFilterState.selectedKeys.includes(item.key));
  }, [fields, currentFilterState.selectedKeys]);

  const showFilterMore = selectedFilterFields.length > 6;
  const visibleFilterFields = showFilterMore && !filterAreaExpanded
    ? selectedFilterFields.slice(0, 6)
    : selectedFilterFields;

  const hasSummaryRecord = useMemo(() => {
    if (!appliedBatch) return false;
    return isFinanceBiProductRecordReady(
      pickFinanceBiProductRecord(appliedBatch.recordList, 'summary'),
    );
  }, [appliedBatch]);

  const modelSelectOptions = useMemo(
    () => modelOptions.map((item) => ({
      value: item.modelId,
      label: item.modelName || item.modelId,
    })),
    [modelOptions],
  );

  const batchSelectOptions = useMemo(
    () => batches.map((batch) => ({
      value: batch.batchCode,
      label: formatBatchOptionLabel(batch),
    })),
    [batches],
  );

  const fieldKeys = useMemo(
    () => fields.map((field, index) => financeBiFieldKey(field, index)),
    [fields],
  );

  const totalPages = Math.max(1, Math.ceil(previewTotal / PREVIEW_PAGE_SIZE));
  const downloadTotalPages = Math.max(1, Math.ceil(downloadCenterTotal / DOWNLOAD_PAGE_SIZE));

  const resetPreviewState = () => {
    setPreviewReady(false);
    setAppliedBatch(null);
    setRows([]);
    setFields([]);
    setColumnTotals({});
    setPageNum(1);
    setFilterAreaExpanded(false);
  };

  const loadModelOptions = useCallback(async () => {
    try {
      const options = await listFinanceBiProductModelOptions();
      const next = [...options];
      if (initialModelCode && !next.some((item) => item.modelId === initialModelCode)) {
        next.unshift({
          modelId: initialModelCode,
          modelName: initialModelName || initialModelCode,
        });
      }
      setModelOptions(next);
      setSelectedModelId((prev) => prev || initialModelCode || next[0]?.modelId || '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载模板失败');
      setModelOptions(
        initialModelCode
          ? [{ modelId: initialModelCode, modelName: initialModelName || initialModelCode }]
          : [],
      );
      if (initialModelCode) setSelectedModelId(initialModelCode);
    }
  }, [initialModelCode, initialModelName]);

  const loadRunRecords = useCallback(async (modelId: string, start?: string, end?: string) => {
    if (!modelId) {
      setBatches([]);
      setSelectedBatchCode('');
      return;
    }
    setRecordsLoading(true);
    try {
      const result = await listFinanceBiProducts({
        modelCode: modelId,
        dateStart: start ? `${start} 00:00:00` : undefined,
        dateEnd: end ? `${end} 23:59:59` : undefined,
        pageNum: 1,
        pageSize: 200,
      });
      const list = result?.list || [];
      setBatches(list);
      setSelectedBatchCode(list[0]?.batchCode || '');
    } catch (error) {
      setBatches([]);
      setSelectedBatchCode('');
      toast.error(error instanceof Error ? error.message : '运行记录加载失败');
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModelOptions();
  }, [loadModelOptions]);

  useEffect(() => {
    if (!selectedModelId) {
      setBatches([]);
      setSelectedBatchCode('');
      return;
    }
    // 运行日期与运行记录不做联动：仅模板变化时加载运行记录
    void loadRunRecords(selectedModelId);
    resetPreviewState();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅模板变化时重载运行记录
  }, [selectedModelId, loadRunRecords]);

  const resolvePreviewRecordCode = (batch: FinanceBiProductBatch, tableType: 'detail' | 'summary') => {
    const record = pickFinanceBiProductRecord(batch.recordList, tableType);
    return isFinanceBiProductRecordReady(record) ? record.recordCode : '';
  };

  const loadPreview = async (
    batch: FinanceBiProductBatch,
    tableType: 'detail' | 'summary',
    page: number,
    filters?: FinanceBiProductPreviewFilter[],
  ) => {
    let nextType = tableType;
    let recordCode = resolvePreviewRecordCode(batch, nextType);
    if (!recordCode && nextType === 'summary') {
      nextType = 'detail';
      setPreviewTableType('detail');
      recordCode = resolvePreviewRecordCode(batch, 'detail');
      toast.warning('该产物未配置汇总表，已切换到明细宽表');
    }
    if (!recordCode) {
      setPreviewReady(false);
      setRows([]);
      setFields([]);
      setColumnTotals({});
      toast.warning('产物数据未就绪，无法预览');
      return;
    }

    const appliedFilters = filters ?? filterStateByTable[nextType].applied;

    setQueryLoading(true);
    try {
      const preview = await queryFinanceBiProductRecord({
        recordCode,
        filters: appliedFilters.length ? appliedFilters : undefined,
        pageNum: page,
        pageSize: PREVIEW_PAGE_SIZE,
      });
      const nextFields = preview?.fieldList || [];
      setFields(nextFields);
      setRows(preview?.rows || []);
      setColumnTotals(preview?.columnTotals || {});
      setPreviewTotal(preview?.total || 0);
      setPageNum(preview?.pageNum || page);
      setPreviewReady(true);
      setPreviewTableType(nextType);

      const validKeys = new Set(nextFields.map((field, index) => financeBiFieldKey(field, index)));
      setFilterStateByTable((prev) => {
        const state = prev[nextType];
        const selectedKeys = state.selectedKeys.filter((key) => validKeys.has(key));
        const drafts: Record<string, FilterDraft> = {};
        for (const key of selectedKeys) {
          const field = nextFields.find((item, index) => financeBiFieldKey(item, index) === key);
          drafts[key] = createDraft(inferFinanceBiFilterType(field || {}), state.drafts[key]);
        }
        return {
          ...prev,
          [nextType]: {
            ...state,
            selectedKeys,
            drafts,
            applied: state.applied.filter((item) => validKeys.has(item.field)),
          },
        };
      });
    } catch (error) {
      setPreviewReady(false);
      setRows([]);
      setFields([]);
      setColumnTotals({});
      toast.error(error instanceof Error ? error.message : '预览失败');
    } finally {
      setQueryLoading(false);
    }
  };

  const handleQuery = async () => {
    if (!selectedModelId) {
      toast.warning('请选择模板');
      return;
    }
    if (!selectedBatch) {
      toast.warning('请选择运行记录');
      return;
    }
    if (selectedBatch.batchStatus !== 'done') {
      toast.warning(
        `该运行记录状态为「${financeBiBatchStatusLabel(selectedBatch.batchStatus) || selectedBatch.batchStatus}」，暂不可预览`,
      );
      return;
    }
    setAppliedBatch(selectedBatch);
    setFilterStateByTable({ detail: emptyFilterState(), summary: emptyFilterState() });
    setFilterAreaExpanded(false);
    await loadPreview(selectedBatch, 'detail', 1, []);
  };

  const handleReset = () => {
    setRunDateRange(null);
    resetPreviewState();
    setFilterStateByTable({ detail: emptyFilterState(), summary: emptyFilterState() });
    if (selectedModelId) {
      void loadRunRecords(selectedModelId);
    }
  };

  const handleSwitchTableType = async (type: 'detail' | 'summary') => {
    if (!appliedBatch || type === previewTableType || queryLoading) return;
    if (type === 'summary' && !resolvePreviewRecordCode(appliedBatch, 'summary')) {
      toast.warning('该产物未配置汇总表整理或尚未生成汇总分析表');
      return;
    }
    setFilterAreaExpanded(false);
    await loadPreview(appliedBatch, type, 1);
  };

  const handlePageChange = async (nextPage: number) => {
    if (!appliedBatch || queryLoading) return;
    await loadPreview(appliedBatch, previewTableType, nextPage);
  };

  const openFilterModal = () => {
    setPendingFilterKeys([...currentFilterState.selectedKeys]);
    setFilterModalOpen(true);
  };

  const confirmFilterModal = () => {
    setFilterStateByTable((prev) => {
      const current = prev[previewTableType];
      const drafts: Record<string, FilterDraft> = {};
      for (const key of pendingFilterKeys) {
        const field = fields.find((item, index) => financeBiFieldKey(item, index) === key);
        drafts[key] = createDraft(inferFinanceBiFilterType(field || {}), current.drafts[key]);
      }
      return {
        ...prev,
        [previewTableType]: {
          ...current,
          selectedKeys: [...pendingFilterKeys],
          drafts,
        },
      };
    });
    setFilterAreaExpanded(false);
    setFilterModalOpen(false);
  };

  const updateDraft = (key: string, patch: Partial<FilterDraft>) => {
    setFilterStateByTable((prev) => {
      const current = prev[previewTableType];
      const draft = current.drafts[key] || createDraft('text');
      return {
        ...prev,
        [previewTableType]: {
          ...current,
          drafts: {
            ...current.drafts,
            [key]: { ...draft, ...patch },
          },
        },
      };
    });
  };

  const applyFieldFilters = async () => {
    if (!appliedBatch) return;
    const applied = buildFiltersFromDrafts(
      currentFilterState.selectedKeys,
      currentFilterState.drafts,
    );
    setFilterStateByTable((prev) => ({
      ...prev,
      [previewTableType]: {
        ...prev[previewTableType],
        applied,
      },
    }));
    await loadPreview(appliedBatch, previewTableType, 1, applied);
  };

  const resetFieldFilters = async () => {
    if (!appliedBatch) return;
    setFilterStateByTable((prev) => {
      const current = prev[previewTableType];
      const drafts: Record<string, FilterDraft> = {};
      for (const key of current.selectedKeys) {
        drafts[key] = createDraft(current.drafts[key]?.filterType || 'text');
      }
      return {
        ...prev,
        [previewTableType]: {
          ...current,
          drafts,
          applied: [],
        },
      };
    });
    await loadPreview(appliedBatch, previewTableType, 1, []);
  };

  const loadDownloadCenter = useCallback(async (page = 1) => {
    setDownloadCenterLoading(true);
    try {
      const result = await listFinanceBiProductExportRecords({
        pageNum: page,
        pageSize: DOWNLOAD_PAGE_SIZE,
      });
      setDownloadRecords(result?.list || []);
      setDownloadCenterTotal(result?.total || 0);
      setDownloadCenterPage(result?.pageNum || page);
    } catch (error) {
      setDownloadRecords([]);
      setDownloadCenterTotal(0);
      toast.error(error instanceof Error ? error.message : '下载中心加载失败');
    } finally {
      setDownloadCenterLoading(false);
    }
  }, []);

  const openDownloadCenter = () => {
    setDownloadCenterOpen(true);
    void loadDownloadCenter(1);
  };

  const handleExport = async () => {
    if (!previewReady || !appliedBatch || exportLoading) return;
    setExportLoading(true);
    try {
      await exportFinanceBiProductData({
        code: appliedBatch.batchCode,
        tableType: previewTableType,
        filters: currentFilterState.applied,
      });
      toast.success('导出任务已提交，请到下载中心查看');
      setDownloadCenterBump(true);
      window.setTimeout(() => setDownloadCenterBump(false), 450);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExportLoading(false);
    }
  };

  const downloadExportFile = (row: FinanceBiExportRecord) => {
    const url = (row.downloadUrl || '').trim();
    if (row.exportStatus !== 'success' || !url) {
      toast.warning('文件尚未生成或不可下载');
      return;
    }
    silentDownload(url);
  };

  const goBack = () => {
    navigate('/data-center?section=data_source');
  };

  const columnTotalItems = useMemo(() => {
    return fieldKeys
      .map((key, index) => {
        const total = columnTotals[key];
        if (total == null || total === '') return null;
        const label = (fields[index]?.name || '').trim() || key;
        return { key, label, total };
      })
      .filter(Boolean) as Array<{ key: string; label: string; total: string }>;
  }, [columnTotals, fieldKeys, fields]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--sto-main-bg)]">
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-auto px-6 pb-6 pt-0 [scrollbar-gutter:stable]">
        <main className={cn(stoMainInnerShell, 'flex min-h-0 min-w-[720px] flex-1 flex-col')}>
          <header className="mb-6 flex shrink-0 items-start gap-3">
            <button
              type="button"
              onClick={goBack}
              className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[#4E5969] hover:bg-[#F2F3F5] dark:text-muted-foreground dark:hover:bg-muted"
              aria-label="返回"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className={stoPageTitleClass}>{t('dataCenterPage.financeReport.historyTitle')}</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
                {t('dataCenterPage.financeReport.historyDescription')}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className={cn(
                dataCenterToolbarButtonClass,
                'mt-1 shrink-0',
                downloadCenterBump && 'animate-pulse border-[#1D2129] text-[#1D2129] dark:border-foreground dark:text-foreground',
              )}
              onClick={openDownloadCenter}
            >
              下载中心
            </Button>
          </header>

          <section className="mb-[18px] shrink-0 rounded-[10px] border border-[#E5E6EB] bg-white p-4 dark:border-border dark:bg-card">
            <div className="grid grid-cols-1 gap-3 min-[960px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_auto]">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label className="text-[12px] text-[#4E5969] dark:text-muted-foreground">
                  模板<span className="text-[#F53F3F]">*</span>
                </Label>
                <ReportFilterSelect
                  value={selectedModelId}
                  options={modelSelectOptions}
                  onChange={setSelectedModelId}
                  placeholder="请选择模板"
                  filterable
                  clearable
                />
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <Label className="text-[12px] text-[#4E5969] dark:text-muted-foreground">运行日期</Label>
                <ReportDateRangePicker
                  value={runDateRange}
                  onChange={setRunDateRange}
                  disabled={!selectedModelId}
                />
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <Label className="text-[12px] text-[#4E5969] dark:text-muted-foreground">
                  运行记录<span className="text-[#F53F3F]">*</span>
                </Label>
                <ReportFilterSelect
                  value={selectedBatchCode}
                  options={batchSelectOptions}
                  onChange={setSelectedBatchCode}
                  placeholder={
                    !selectedModelId ? '请先选择模板' : recordsLoading ? '加载中…' : '请选择运行记录'
                  }
                  disabled={!selectedModelId || recordsLoading}
                  clearable
                  loading={recordsLoading}
                />
              </div>

              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className={cn(dataCenterToolbarButtonClass, 'min-w-[72px]')}
                  disabled={queryLoading}
                  onClick={() => { void handleQuery(); }}
                >
                  {queryLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                  查询
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(dataCenterToolbarButtonClass, 'min-w-[72px]')}
                  disabled={queryLoading}
                  onClick={handleReset}
                >
                  重置
                </Button>
              </div>
            </div>
          </section>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-[#E5E6EB] bg-white dark:border-border dark:bg-card">
            {previewReady ? (
              <>
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#F2F3F5] px-4 py-3 dark:border-border">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={cn(
                        'h-8 rounded-[8px] px-3 text-[13px] font-medium',
                        previewTableType === 'detail'
                          ? 'bg-[#1D2129] text-white dark:bg-foreground dark:text-background'
                          : 'text-[#4E5969] hover:bg-[#F2F3F5] dark:text-muted-foreground dark:hover:bg-muted',
                      )}
                      onClick={() => { void handleSwitchTableType('detail'); }}
                    >
                      明细宽表
                    </button>
                    {hasSummaryRecord ? (
                      <button
                        type="button"
                        className={cn(
                          'h-8 rounded-[8px] px-3 text-[13px] font-medium',
                          previewTableType === 'summary'
                            ? 'bg-[#1D2129] text-white dark:bg-foreground dark:text-background'
                            : 'text-[#4E5969] hover:bg-[#F2F3F5] dark:text-muted-foreground dark:hover:bg-muted',
                        )}
                        onClick={() => { void handleSwitchTableType('summary'); }}
                      >
                        汇总分析表
                      </button>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        dataCenterToolbarButtonClass,
                        currentFilterState.selectedKeys.length > 0
                          && 'border-[#1D2129] text-[#1D2129] dark:border-foreground dark:text-foreground',
                      )}
                      disabled={!fields.length}
                      onClick={openFilterModal}
                    >
                      {currentFilterState.selectedKeys.length
                        ? `筛选 ${currentFilterState.selectedKeys.length}`
                        : '筛选'}
                    </Button>
                    <button
                      type="button"
                      className="inline-flex h-[34px] items-center justify-center rounded-[10px] bg-[#1D2129] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#4E5969] disabled:pointer-events-none disabled:opacity-50 dark:bg-foreground dark:text-background dark:hover:bg-foreground/90"
                      disabled={exportLoading}
                      onClick={() => { void handleExport(); }}
                    >
                      {exportLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                      导出
                    </button>
                  </div>
                </div>

                {selectedFilterFields.length > 0 ? (
                  <div className="shrink-0 border-b border-[#F2F3F5] px-4 py-3 dark:border-border">
                    <div
                      className={cn(
                        'grid grid-cols-1 gap-3 min-[900px]:grid-cols-2 min-[1200px]:grid-cols-3',
                        showFilterMore && !filterAreaExpanded && 'max-h-[148px] overflow-hidden',
                      )}
                    >
                      {visibleFilterFields.map(({ key, field, filterType }) => {
                        const draft = currentFilterState.drafts[key] || createDraft(filterType);
                        const label = (field.name || '').trim() || key;
                        return (
                          <div key={key} className="flex min-w-0 flex-col gap-1.5">
                            <span className="truncate text-[12px] font-medium text-[#4E5969] dark:text-muted-foreground">
                              {label}
                            </span>
                            {filterType === 'timeRange' ? (
                              <ReportDateRangePicker
                                value={draft.min && draft.max ? [draft.min, draft.max] : null}
                                onChange={(range) => {
                                  updateDraft(key, {
                                    filterType: 'timeRange',
                                    min: range?.[0] || '',
                                    max: range?.[1] || '',
                                  });
                                }}
                              />
                            ) : filterType === 'numberRange' ? (
                              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                                <Input
                                  type="number"
                                  value={draft.min}
                                  placeholder="最小"
                                  className="h-[34px] rounded-[10px] text-[13px]"
                                  onChange={(e) => updateDraft(key, { min: e.target.value })}
                                />
                                <span className="text-[12px] text-muted-foreground">~</span>
                                <Input
                                  type="number"
                                  value={draft.max}
                                  placeholder="最大"
                                  className="h-[34px] rounded-[10px] text-[13px]"
                                  onChange={(e) => updateDraft(key, { max: e.target.value })}
                                />
                              </div>
                            ) : (
                              <Input
                                value={draft.value}
                                placeholder="请输入"
                                className="h-[34px] rounded-[10px] text-[13px]"
                                onChange={(e) => updateDraft(key, { value: e.target.value })}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      {showFilterMore ? (
                        <button
                          type="button"
                          className="text-[12px] text-[#1D2129] dark:text-foreground"
                          onClick={() => setFilterAreaExpanded((v) => !v)}
                        >
                          {filterAreaExpanded ? '收起' : '查看更多'}
                        </button>
                      ) : <span />}
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(dataCenterToolbarButtonClass, 'min-w-[64px]')}
                          disabled={queryLoading}
                          onClick={() => { void applyFieldFilters(); }}
                        >
                          查询
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(dataCenterToolbarButtonClass, 'min-w-[64px]')}
                          disabled={queryLoading}
                          onClick={() => { void resetFieldFilters(); }}
                        >
                          重置
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {columnTotalItems.length > 0 ? (
                  <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-b border-[#F2F3F5] px-4 py-2 text-[12px] text-[#4E5969] dark:border-border dark:text-muted-foreground">
                    {columnTotalItems.map((item) => (
                      <span key={item.key}>
                        {item.label}合计：{item.total}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="relative min-h-0 flex-1 overflow-auto">
                  {queryLoading ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-background/60">
                      <Loader2 className="h-5 w-5 animate-spin text-[#86909C]" />
                    </div>
                  ) : null}
                  <table className="min-w-full border-collapse text-left text-[12px]">
                    <thead className="sticky top-0 z-[1] bg-[#F7F8FA] dark:bg-muted">
                      <tr>
                        {fields.map((field, index) => {
                          const key = fieldKeys[index];
                          return (
                            <th
                              key={key}
                              className="whitespace-nowrap border-b border-[#E5E6EB] px-3 py-2.5 font-semibold text-[#1D2129] dark:border-border dark:text-foreground"
                            >
                              {(field.name || '').trim() || key}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={Math.max(fields.length, 1)}
                            className="px-3 py-10 text-center text-[#86909C]"
                          >
                            暂无数据
                          </td>
                        </tr>
                      ) : (
                        rows.map((row, rowIndex) => (
                          <tr key={rowIndex} className="hover:bg-[#F7F8FA] dark:hover:bg-muted/40">
                            {fieldKeys.map((key) => (
                              <td
                                key={`${rowIndex}-${key}`}
                                className="max-w-[240px] truncate whitespace-nowrap border-b border-[#F2F3F5] px-3 py-2.5 text-[#4E5969] dark:border-border dark:text-muted-foreground"
                                title={String(row[key] ?? '')}
                              >
                                {row[key] == null || row[key] === '' ? '—' : String(row[key])}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[#F2F3F5] px-4 py-3 dark:border-border">
                  <p className="text-[12px] text-[#86909C] dark:text-muted-foreground">
                    共 {previewTotal} 行
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={pageNum <= 1 || queryLoading}
                      className={cn(dataCenterToolbarButtonClass, 'disabled:opacity-40')}
                      onClick={() => { void handlePageChange(pageNum - 1); }}
                    >
                      上一页
                    </button>
                    <span className="text-[13px] text-[#86909C]">
                      {pageNum} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={pageNum >= totalPages || queryLoading}
                      className={cn(dataCenterToolbarButtonClass, 'disabled:opacity-40')}
                      onClick={() => { void handlePageChange(pageNum + 1); }}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center text-center">
                <h2 className="text-[14px] font-semibold text-[#1D2129] dark:text-foreground">
                  {t('dataCenterPage.financeReport.historyEmptyTitle')}
                </h2>
                <p className="mt-1 max-w-md text-[12px] leading-5 text-[#A8B0BD] dark:text-muted-foreground">
                  {t('dataCenterPage.financeReport.historyEmptyDescription')}
                </p>
              </div>
            )}
          </section>
        </main>
      </div>

      <Dialog open={filterModalOpen} onOpenChange={setFilterModalOpen}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {previewTableType === 'summary' ? '汇总分析表筛选条件' : '明细宽表筛选条件'}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            <p className="text-[12px] text-muted-foreground">筛选条件:</p>
            {fields.length === 0 ? (
              <div className="py-8 text-center text-[13px] text-muted-foreground">暂无可选字段</div>
            ) : (
              fields.map((field, index) => {
                const key = financeBiFieldKey(field, index);
                const checked = pendingFilterKeys.includes(key);
                const typeName = field.dataTypeName
                  || (inferFinanceBiFilterType(field) === 'timeRange'
                    ? '日期'
                    : inferFinanceBiFilterType(field) === 'numberRange'
                      ? '数值'
                      : '文本');
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setPendingFilterKeys((prev) =>
                          checked ? prev.filter((item) => item !== key) : [...prev, key],
                        );
                      }}
                      className="h-4 w-4 accent-[#1D2129]"
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                      {(field.name || '').trim() || key}
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{typeName}</span>
                  </label>
                );
              })
            )}
          </div>
          <DialogFooter className="gap-2 sm:space-x-0">
            <button
              type="button"
              className={cn(dataCenterToolbarButtonClass, 'min-w-[72px]')}
              onClick={() => setFilterModalOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-[34px] min-w-[72px] items-center justify-center rounded-[10px] bg-[#1D2129] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#4E5969] dark:bg-foreground dark:text-background dark:hover:bg-foreground/90"
              onClick={confirmFilterModal}
            >
              确认
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={downloadCenterOpen}
        onOpenChange={(open) => {
          setDownloadCenterOpen(open);
        }}
      >
        <SheetContent
          side="right"
          className="no-drag flex w-[min(72vw,880px)] flex-col gap-0 overflow-hidden bg-white p-0 dark:bg-card sm:max-w-none"
        >
          <SheetHeader className="no-drag shrink-0 space-y-0 border-b border-[#E5E6EB] px-5 py-4 text-left dark:border-border">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="text-[16px] font-semibold text-[#1D2129] dark:text-foreground">
                  下载中心
                </SheetTitle>
                <p className="mt-1 text-[12px] text-[#86909C] dark:text-muted-foreground">
                  导出任务完成后可在此下载文件
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[#4E5969] hover:bg-[#F2F3F5] dark:text-muted-foreground dark:hover:bg-muted"
                onClick={() => setDownloadCenterOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </SheetHeader>

          <div className="relative min-h-0 flex-1 overflow-auto bg-[#F7F8FA] px-5 py-4 dark:bg-background">
            {downloadCenterLoading ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 dark:bg-background/70">
                <Loader2 className="h-5 w-5 animate-spin text-[#86909C]" />
              </div>
            ) : null}

            {downloadRecords.length === 0 && !downloadCenterLoading ? (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-[10px] border border-dashed border-[#E5E6EB] bg-white dark:border-border dark:bg-card">
                <p className="text-[14px] font-medium text-[#1D2129] dark:text-foreground">暂无导出记录</p>
                <p className="mt-1 text-[12px] text-[#86909C]">在预览区点击「导出」后，任务会出现在这里</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-[10px] border border-[#E5E6EB] bg-white dark:border-border dark:bg-card">
                <table className="min-w-full border-collapse text-left text-[12px]">
                  <thead>
                    <tr className="bg-[#F7F8FA] dark:bg-muted/60">
                      {[
                        { key: 'name', label: '文件名', className: 'min-w-[180px]' },
                        { key: 'type', label: '表类型', className: 'w-[100px]' },
                        { key: 'status', label: '状态', className: 'w-[96px]' },
                        { key: 'size', label: '大小', className: 'w-[88px]' },
                        { key: 'time', label: '创建时间', className: 'w-[160px]' },
                        { key: 'action', label: '操作', className: 'w-[72px]' },
                      ].map((col) => (
                        <th
                          key={col.key}
                          className={cn(
                            'whitespace-nowrap border-b border-[#E5E6EB] px-4 py-3 font-semibold text-[#1D2129] dark:border-border dark:text-foreground',
                            col.className,
                          )}
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {downloadRecords.map((row, index) => {
                      const canDownload = row.exportStatus === 'success' && !!row.downloadUrl;
                      return (
                        <tr
                          key={row.exportKey || String(row.id) || String(index)}
                          className="border-b border-[#F2F3F5] last:border-b-0 hover:bg-[#FAFBFC] dark:border-border dark:hover:bg-muted/30"
                        >
                          <td className="max-w-[260px] px-4 py-3.5">
                            <div
                              className="truncate text-[13px] font-medium text-[#1D2129] dark:text-foreground"
                              title={row.fileName || ''}
                            >
                              {row.fileName || '—'}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-[#4E5969] dark:text-muted-foreground">
                            {row.tableTypeName || row.tableType || '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5">
                            <span
                              className={cn(
                                'inline-flex rounded-[6px] px-2 py-0.5 text-[11px] font-medium',
                                row.exportStatus === 'success' && 'bg-[#F2F3F5] text-[#1D2129] dark:bg-muted dark:text-foreground',
                                row.exportStatus === 'failed' && 'bg-[#F2F3F5] text-[#86909C]',
                                (row.exportStatus === 'pending' || row.exportStatus === 'running')
                                  && 'bg-[#F2F3F5] text-[#4E5969]',
                                !['success', 'failed', 'pending', 'running'].includes(row.exportStatus)
                                  && 'bg-[#F2F3F5] text-[#4E5969]',
                              )}
                            >
                              {row.exportStatusName || row.exportStatus || '—'}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-[#4E5969] dark:text-muted-foreground">
                            {row.fileSizeText || '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-[#4E5969] dark:text-muted-foreground">
                            {(row.createTime || '').replace('T', ' ').slice(0, 19) || '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5">
                            <button
                              type="button"
                              className={cn(
                                'text-[12px] font-medium',
                                canDownload
                                  ? 'text-[#1D2129] underline-offset-2 hover:underline dark:text-foreground'
                                  : 'cursor-not-allowed text-[#C9CDD4]',
                              )}
                              disabled={!canDownload}
                              onClick={() => downloadExportFile(row)}
                            >
                              下载
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {downloadCenterTotal > 0 ? (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[#E5E6EB] bg-white px-5 py-3 dark:border-border dark:bg-card">
              <span className="text-[12px] text-[#86909C]">
                共 {downloadCenterTotal} 条
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={downloadCenterPage <= 1 || downloadCenterLoading}
                  className={cn(dataCenterToolbarButtonClass, 'disabled:opacity-40')}
                  onClick={() => { void loadDownloadCenter(downloadCenterPage - 1); }}
                >
                  上一页
                </button>
                <span className="min-w-[52px] text-center text-[13px] text-[#4E5969] dark:text-muted-foreground">
                  {downloadCenterPage} / {downloadTotalPages}
                </span>
                <button
                  type="button"
                  disabled={downloadCenterPage >= downloadTotalPages || downloadCenterLoading}
                  className={cn(dataCenterToolbarButtonClass, 'disabled:opacity-40')}
                  onClick={() => { void loadDownloadCenter(downloadCenterPage + 1); }}
                >
                  下一页
                </button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
