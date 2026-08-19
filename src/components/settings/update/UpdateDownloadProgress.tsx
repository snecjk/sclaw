import { Progress } from '@/components/ui/progress';
import type { ProgressInfo } from '@/stores/update';
import { cn } from '@/lib/utils';
import { formatMegabytes, formatSpeedMBps } from './format-bytes';

interface UpdateDownloadProgressProps {
  progress: ProgressInfo;
  version?: string | null;
  title?: string | null;
  className?: string;
  compact?: boolean;
}

export function UpdateDownloadProgress({
  progress,
  version,
  title,
  className,
  compact = false,
}: UpdateDownloadProgressProps) {
  const percent = Math.round(progress.percent);
  const label = version?.trim()
    ? title?.trim() || `v${version.trim()}`
    : null;

  return (
    <div className={cn('space-y-2', className)}>
      {label && !compact ? (
        <p className="text-[13px] font-medium text-[#1D2129] dark:text-foreground">
          {label}
        </p>
      ) : null}
      <div className="flex items-center gap-1.5">
        <Progress
          value={percent}
          className="h-[5px] min-h-[5px] flex-1 overflow-hidden rounded-full bg-[#F0F2F5] dark:bg-white/10 [&>div]:!rounded-full [&>div]:!bg-[#00B42A] dark:[&>div]:!bg-emerald-400"
        />
        <span className="w-9 shrink-0 text-right text-[12px] font-normal tabular-nums leading-[17px] text-[#86909C] dark:text-muted-foreground">
          {percent}%
        </span>
      </div>
      {!compact ? (
        <div className="flex items-center justify-between text-[12px] tabular-nums leading-[17px] text-[#86909C] dark:text-muted-foreground">
          <span>{formatSpeedMBps(progress.bytesPerSecond)}</span>
          <span>
            {formatMegabytes(progress.transferred)}/{formatMegabytes(progress.total)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
