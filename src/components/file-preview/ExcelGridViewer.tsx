/**
 * ExcelGridViewer — Excel 网格化预览（对齐 Kimi OfficePreview 体验）
 *
 * 基于 SheetJS（已内置 xlsx 依赖）：
 * - 多 sheet 标签切换
 * - 列字母（A/B/…/AA）+ 行号，首行/首列 sticky
 * - 合并单元格（colspan/rowspan）与列宽（!cols wpx）
 * - 大表分页渲染（默认 200 行，可继续加载），raw:false 取显示格式文本
 */
import { useEffect, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { PreviewLoading } from './PreviewLoading';

const INITIAL_ROWS = 200;
const ROWS_PER_PAGE = 500;

interface SheetMerge {
  /** 起始单元格 key `${r}:${c}` → 跨度 */
  spans: Map<string, { rowSpan: number; colSpan: number }>;
  /** 被合并覆盖的单元格 key 集合 */
  covered: Set<string>;
}

interface SheetData {
  name: string;
  rows: string[][];
  colWidths: (number | undefined)[];
  merge: SheetMerge;
  totalRows: number;
  totalCols: number;
}

interface ExcelGridViewerProps {
  buffer: Uint8Array;
  className?: string;
}

function colLetter(index: number): string {
  let i = index + 1;
  let s = '';
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

export function ExcelGridViewer({ buffer, className }: ExcelGridViewerProps) {
  const { t } = useTranslation('chat');
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [error, setError] = useState('');
  const [activeSheet, setActiveSheet] = useState(0);
  const [visibleRows, setVisibleRows] = useState(INITIAL_ROWS);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setError('');
    setActiveSheet(0);
    setVisibleRows(INITIAL_ROWS);

    void (async () => {
      try {
        // @ts-ignore — xlsx 无内置 d.ts（与 FilePreviewViewer 既有模式一致）
        const XLSX = await import(/* @vite-ignore */ 'xlsx');
        const workbook = XLSX.read(buffer, { type: 'array' });
        const parsed: SheetData[] = workbook.SheetNames.map((name: string) => {
          const worksheet = workbook.Sheets[name];
          const rows = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '',
            raw: false, // 显示格式文本（日期/数字按单元格格式）
          }) as string[][];

          const colWidths = ((worksheet['!cols'] ?? []) as { wpx?: number }[])
            .map((col) => (typeof col?.wpx === 'number' ? col.wpx : undefined));

          const spans = new Map<string, { rowSpan: number; colSpan: number }>();
          const covered = new Set<string>();
          const merges = (worksheet['!merges'] ?? []) as {
            s: { r: number; c: number };
            e: { r: number; c: number };
          }[];
          for (const m of merges) {
            const rowSpan = m.e.r - m.s.r + 1;
            const colSpan = m.e.c - m.s.c + 1;
            if (rowSpan <= 1 && colSpan <= 1) continue;
            spans.set(`${m.s.r}:${m.s.c}`, { rowSpan, colSpan });
            for (let r = m.s.r; r <= m.e.r; r += 1) {
              for (let c = m.s.c; c <= m.e.c; c += 1) {
                if (r === m.s.r && c === m.s.c) continue;
                covered.add(`${r}:${c}`);
              }
            }
          }

          const totalCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
          return { name, rows, colWidths, merge: { spans, covered }, totalRows: rows.length, totalCols };
        });

        if (!cancelled) setSheets(parsed);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Excel 解析失败');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [buffer]);

  if (error) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-sm', className)}>
        <FileSpreadsheet className="h-12 w-12 text-muted-foreground opacity-40" aria-hidden />
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!sheets) {
    return <PreviewLoading label={t('preview.office.parsing', { label: 'Excel' })} variant="spreadsheet" className={className} />;
  }

  const sheet = sheets[Math.min(activeSheet, sheets.length - 1)];
  if (!sheet || sheet.rows.length === 0) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground', className)}>
        <FileSpreadsheet className="h-10 w-10 opacity-40" aria-hidden />
        <p>{t('preview.excel.empty')}</p>
      </div>
    );
  }

  const shownRows = sheet.rows.slice(0, visibleRows);
  const remaining = sheet.rows.length - shownRows.length;

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-white dark:bg-[#0d1117]', className)}>
      {/* Sheet 标签栏 */}
      {sheets.length > 1 ? (
        <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 px-2">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => {
                setActiveSheet(i);
                setVisibleRows(INITIAL_ROWS);
              }}
              className={cn(
                'inline-flex h-6 max-w-[10rem] shrink-0 items-center rounded-md px-2.5 text-xs transition-colors',
                i === activeSheet
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <span className="truncate">{s.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* 网格区 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-collapse text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 min-w-[44px] border border-border/60 bg-muted/80 px-1 py-1 text-center text-[11px] font-normal text-muted-foreground backdrop-blur-sm" />
              {Array.from({ length: sheet.totalCols }, (_, c) => (
                <th
                  key={c}
                  style={sheet.colWidths[c] ? { width: sheet.colWidths[c], minWidth: sheet.colWidths[c] } : { minWidth: 80 }}
                  className="border border-border/60 bg-muted/80 px-2 py-1 text-center text-[11px] font-normal text-muted-foreground backdrop-blur-sm"
                >
                  {colLetter(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownRows.map((row, r) => (
              <tr key={r} className={r % 2 === 1 ? 'bg-muted/20' : undefined}>
                <td className="sticky left-0 z-10 min-w-[44px] border border-border/60 bg-muted/80 px-1 py-0.5 text-center text-[11px] text-muted-foreground backdrop-blur-sm">
                  {r + 1}
                </td>
                {Array.from({ length: sheet.totalCols }, (_, c) => {
                  const key = `${r}:${c}`;
                  if (sheet.merge.covered.has(key)) return null;
                  const span = sheet.merge.spans.get(key);
                  return (
                    <td
                      key={c}
                      rowSpan={span?.rowSpan}
                      colSpan={span?.colSpan}
                      className="max-w-[320px] truncate border border-border/60 px-2 py-0.5 text-foreground"
                      title={String(row[c] ?? '')}
                    >
                      {String(row[c] ?? '')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {/* 分页加载 */}
        {remaining > 0 ? (
          <div className="sticky left-0 flex items-center justify-center gap-3 py-3">
            <button
              type="button"
              onClick={() => setVisibleRows((v) => v + ROWS_PER_PAGE)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
            >
              {t('preview.excel.showMore', { count: remaining })}
            </button>
            <button
              type="button"
              onClick={() => setVisibleRows(sheet.rows.length)}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {t('preview.excel.showAll', { count: sheet.rows.length })}
            </button>
          </div>
        ) : null}
      </div>

      {/* 状态行 */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border/60 px-3 text-[11px] text-muted-foreground">
        <FileSpreadsheet className="h-3 w-3" aria-hidden />
        <span>{t('preview.excel.stats', { rows: sheet.totalRows, cols: sheet.totalCols })}</span>
        {sheets.length > 1 ? <span>· {sheet.name}</span> : null}
      </div>
    </div>
  );
}
