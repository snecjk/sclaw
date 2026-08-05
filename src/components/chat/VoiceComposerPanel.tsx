import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { VOICE_LEVEL_BAR_COUNT } from '@/lib/voice-asr';

/** 距底部小于该值时视为「仍贴底」，新转写继续自动滚到底。 */
const STICK_BOTTOM_THRESHOLD_PX = 40;

export type VoiceComposerMode = 'listening' | 'confirm' | 'waiting';

const FALLBACK_LEVELS = Array.from({ length: VOICE_LEVEL_BAR_COUNT }, () => 0.06);

type VoiceBarsTone = 'active' | 'dim' | 'idle';

/**
 * 居中细声线：由真实麦音频谱驱动；无 levels 时显示底线。
 */
export function VoiceListeningBars({
  className,
  tone = 'active',
  levels,
}: {
  className?: string;
  tone?: VoiceBarsTone;
  /** 0–1，长度建议 VOICE_LEVEL_BAR_COUNT */
  levels?: number[];
}) {
  const bins = levels && levels.length > 0 ? levels : FALLBACK_LEVELS;
  const live = tone === 'active' || tone === 'dim';

  return (
    <div
      className={cn(
        'stoclaw-voice-soundline mx-auto flex h-9 w-full max-w-[520px] items-center justify-center gap-[1.5px]',
        tone === 'dim' && 'opacity-55',
        tone === 'idle' && 'opacity-60',
        className,
      )}
      aria-hidden
    >
      {bins.map((level, i) => {
        // 频谱已在中间→两侧对称排布，这里只轻微收两端，避免边角毛刺
        const t = bins.length <= 1 ? 0.5 : i / (bins.length - 1);
        const envelope = Math.pow(Math.sin(t * Math.PI), 0.35);
        const raw = live ? Math.min(1, Math.max(0.03, level)) : 0.08;
        const h = Math.max(0.06, raw * (0.5 + 0.5 * envelope));
        return (
          <span
            key={i}
            className="stoclaw-voice-soundline-bar stoclaw-voice-soundline-bar--live"
            style={{
              height: `${Math.round(h * 100)}%`,
              opacity: 0.45 + h * 0.55,
            }}
          />
        );
      })}
    </div>
  );
}

/** @deprecated 大光核已停用；保留导出以免外部引用断裂 */
export function VoiceListeningOrb({ className }: { className?: string }) {
  return <VoiceListeningBars className={className} tone="active" />;
}

/** @deprecated 使用 VoiceListeningBars */
export const VoiceWaveform = VoiceListeningBars;

/** 语音模式：一小段音波沿输入框上沿从左向右滚过 */
const VOICE_EDGE_BAR_HEIGHTS = (() => {
  const n = 14;
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * Math.PI;
    const envelope = Math.sin(t);
    const ripple = 0.45 + 0.55 * Math.abs(Math.sin(i * 1.7 + 0.3));
    return Math.max(0.2, envelope * ripple);
  });
})();

const VOICE_EDGE_BAR_MOTION = VOICE_EDGE_BAR_HEIGHTS.map((_, i) => ({
  durationSec: 0.38 + (i % 5) * 0.09 + (i % 3) * 0.04,
  delaySec: (i * 0.07) % 0.85,
}));

export function VoiceTopCrawlWave({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'stoclaw-voice-edge pointer-events-none absolute z-20',
        className,
      )}
      aria-hidden
    >
      <div className="stoclaw-voice-edge-runner">
        <div className="stoclaw-voice-edge-bars">
          {VOICE_EDGE_BAR_HEIGHTS.map((h, i) => (
            <span
              key={i}
              className="stoclaw-voice-edge-bar"
              style={{
                height: `${Math.round(h * 100)}%`,
                animationDuration: `${VOICE_EDGE_BAR_MOTION[i].durationSec}s`,
                animationDelay: `${VOICE_EDGE_BAR_MOTION[i].delaySec}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface VoiceComposerPanelProps {
  mode?: VoiceComposerMode;
  statusLabel: string;
  transcript: string;
  connecting?: boolean;
  /** 实时麦声音频谱 0–1 */
  levels?: number[];
  confirmSecondsLeft?: number;
  confirmTitle?: string;
  className?: string;
  compact?: boolean;
}

/**
 * Replaces the text editor while voice ASR is active.
 * Centered live soundline + status + short transcript preview.
 */
export function VoiceComposerPanel({
  mode = 'listening',
  statusLabel,
  transcript,
  connecting = false,
  levels,
  confirmSecondsLeft,
  confirmTitle,
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

  const isConfirm = mode === 'confirm';
  const barsTone: VoiceBarsTone = mode === 'waiting'
    ? 'idle'
    : connecting || mode !== 'listening'
      ? 'dim'
      : 'active';

  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center gap-1.5',
        compact ? 'min-h-[56px] py-1' : 'min-h-[64px] flex-1 py-1.5',
        className,
      )}
    >
      {isConfirm ? (
        <div className="flex w-full items-center justify-center gap-2">
          <div className="tabular-nums text-[18px] font-semibold leading-none text-primary">
            {typeof confirmSecondsLeft === 'number' ? confirmSecondsLeft : '—'}
          </div>
          {confirmTitle ? (
            <p className="truncate text-[12px] font-medium text-primary/90">
              {confirmTitle}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <VoiceListeningBars tone={barsTone} levels={levels} />
          <p className="max-w-full truncate text-center text-[12px] font-medium leading-none text-primary/90">
            {statusLabel}
          </p>
        </>
      )}

      <div
        ref={transcriptRef}
        onScroll={syncStickFromScroll}
        onWheel={(event) => {
          event.stopPropagation();
          requestAnimationFrame(syncStickFromScroll);
        }}
        className={cn(
          'max-h-10 w-full min-h-0 overflow-y-auto overscroll-contain px-1',
          'text-center text-[13px] leading-[1.35] text-foreground/90',
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
