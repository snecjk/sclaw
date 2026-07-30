import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/** Fixed decorative bar heights (relative). Animation delay staggers each bar. */
const WAVE_BARS = [0.4, 0.7, 1, 0.55, 0.85, 0.45, 0.95, 0.6, 0.8, 0.5, 0.9, 0.55, 0.75, 0.42, 0.65] as const;

/** 距底部小于该值时视为「仍贴底」，新转写继续自动滚到底。 */
const STICK_BOTTOM_THRESHOLD_PX = 40;

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
  statusLabel: string;
  transcript: string;
  connecting?: boolean;
  className?: string;
  compact?: boolean;
}

/**
 * Replaces the text editor while voice ASR is active.
 * Waveform is decorative (CSS only), not driven by microphone level.
 */
export function VoiceComposerPanel({
  statusLabel,
  transcript,
  connecting = false,
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
    // 等浏览器应用 scrollTop 后再允许手动滚动检测，避免被误判回贴底
    requestAnimationFrame(() => {
      autoScrollingRef.current = false;
    });
  }, [transcript]);

  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center gap-3 rounded-xl',
        compact ? 'min-h-[72px] py-3' : 'min-h-[96px] py-4',
        className,
      )}
    >
      <VoiceWaveform className={connecting ? 'opacity-50' : undefined} />
      <p className="text-[12px] font-medium text-primary/90">
        {statusLabel}
      </p>
      <div
        ref={transcriptRef}
        onScroll={syncStickFromScroll}
        onWheel={(event) => {
          // 阻止外层 composer 吃掉滚轮，保证预览区可独立上下翻
          event.stopPropagation();
          // 用户主动滚轮时立刻按当前位置更新贴底状态
          requestAnimationFrame(syncStickFromScroll);
        }}
        className={cn(
          // 不用 flex+justify-end：会破坏 overflow 滚动，导致只能跟到底
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
    </div>
  );
}
