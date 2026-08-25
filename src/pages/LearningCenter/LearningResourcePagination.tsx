import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LearningResourcePaginationProps {
  pageNum: number;
  pageSize: number;
  total: number;
  previousLabel: string;
  nextLabel: string;
  summaryLabel: string;
  onPageChange: (pageNum: number) => void;
}

export function LearningResourcePagination({
  pageNum,
  pageSize,
  total,
  previousLabel,
  nextLabel,
  summaryLabel,
  onPageChange,
}: LearningResourcePaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && pageNum === 1) return null;

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4" aria-label={summaryLabel}>
      <span className="text-xs text-muted-foreground">{summaryLabel}</span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pageNum <= 1}
          aria-label={previousLabel}
          onClick={() => onPageChange(pageNum - 1)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span className="sr-only sm:not-sr-only sm:ml-1">{previousLabel}</span>
        </Button>
        <span className="min-w-14 text-center text-sm text-muted-foreground">{pageNum}/{pageCount}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pageNum >= pageCount}
          aria-label={nextLabel}
          onClick={() => onPageChange(pageNum + 1)}
        >
          <span className="sr-only sm:not-sr-only sm:mr-1">{nextLabel}</span>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
