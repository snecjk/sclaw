import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** Fixed decorative bar heights (relative). Animation delay staggers each bar. */
const WAVE_BARS = [0.4, 0.7, 1, 0.55, 0.85, 0.45, 0.95, 0.6, 0.8, 0.5, 0.9, 0.55, 0.75, 0.42, 0.65] as const;

/** 距底部小于该值时视为「仍贴底」，新转写继续自动滚到底。 */
const STICK_BOTTOM_THRESHOLD_PX = 40;

export type VoiceComposerMode = 'listening' | 'confirm' | 'waiting';

export function VoiceWaveform({ className }: { className?: string }) {
  return (
    <div
      className={cn('flex h-11 items-end justify-center gap-[3px]', className)}
      aria-hidden
    >
      {WAVE_BARS.map((height, index) => (
        <span
          key={index}
          className="stoclaw-voice-wave-bar w-[3px] rounded-full bg-primary/85 dark:bg-primary/90"
          style={{
            height: `${Math.round(height * 100)}%`,
            animationDelay: `${index * 0.07}s`,
          }}
        />
      ))}
    </div>
  );
}

interface VoiceComposerPanelProps {
  mode?: VoiceComposerMode;
  statusLabel: string;
  transcript: string;
  connecting?: boolean;
  /** 确认倒计时剩余秒数（向上取整展示） */
  confirmSecondsLeft?: number;
  cancelLabel?: string;
  onCancelConfirm?: () => void;
  className?: string;
  compact?: boolean;
}

/**
 * Replaces the text editor while voice ASR is active.
 * Waveform is decorative (CSS only), not driven by microphone level.
 */
export function VoiceComposerPanel({
  mode = 'listening',
  statusLabel,
  transcript,
  connecting = false,
  confirmSecondsLeft,
  cancelLabel,
  onCancelConfirm,
  className,
  compact = false,
}: VoiceComposerPanelProps) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const autoScrollingRef = useRef(false);

  const syncStickFromScroll = useCallback(() => {
    if (autoScrollingRef.current) return;
    const el = transcriptRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= STICK_BOTTOM_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el || !stickToBottomRef.current) return;

    autoScrollingRef.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      autoScrollingRef.current = false;
    });
  }, [transcript]);

  const showWave = mode === 'listening';
  const dimWave = connecting || mode === 'waiting';

  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center gap-3 rounded-xl',
        compact ? 'min-h-[72px] py-3' : 'min-h-[96px] py-4',
        className,
      )}
    >
      {showWave ? (
        <VoiceWaveform className={dimWave ? 'opacity-50' : undefined} />
      ) : mode === 'waiting' ? (
        <div className="flex h-11 items-center justify-center" aria-hidden>
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary/80" />
        </div>
      ) : (
        <div className="flex h-11 items-center justify-center gap-2 text-[22px] font-semibold tabular-nums text-primary">
          {typeof confirmSecondsLeft === 'number' ? confirmSecondsLeft : '—'}
        </div>
      )}
      <p className="text-[12px] font-medium text-primary/90">
        {statusLabel}
      </p>
      <div
        ref={transcriptRef}
        onScroll={syncStickFromScroll}
        onWheel={(event) => {
          event.stopPropagation();
          requestAnimationFrame(syncStickFromScroll);
        }}
        className={cn(
          'max-h-28 w-full overflow-y-auto overscroll-contain px-1',
          'text-center text-[14px] leading-relaxed text-foreground/90',
          !transcript && 'text-muted-foreground/70',
        )}
        role="log"
        aria-live="off"
        tabIndex={0}
      >
        <p className="whitespace-pre-wrap break-words">
          {transcript || '…'}
        </p>
      </div>
      {mode === 'confirm' && onCancelConfirm ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-0.5 h-8 rounded-full px-4 text-[12px]"
          onClick={onCancelConfirm}
        >
          {cancelLabel || '取消'}
        </Button>
      ) : null}
    </div>
  );
}
