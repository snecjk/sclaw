import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** 距底部小于该值时视为「仍贴底」，新转写继续自动滚到底。 */
const STICK_BOTTOM_THRESHOLD_PX = 40;

export type VoiceComposerMode = 'listening' | 'confirm' | 'waiting';

/** 临听：精致光核 + 阳光柔光向外扩散（装饰动画，不跟麦克风音量） */
export function VoiceListeningOrb({ className }: { className?: string }) {
  const shineRef = useRef<HTMLSpanElement>(null);

  // 内高光随机扭动：不等间隔游走，避免固定频率循环
  useEffect(() => {
    const el = shineRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let cancelled = false;
    let timer = 0;

    const tick = () => {
      if (cancelled || !shineRef.current) return;
      const node = shineRef.current;
      const top = 1 + Math.random() * 6;
      const left = 1 + Math.random() * 6;
      const rotate = -40 + Math.random() * 80;
      const scale = 0.75 + Math.random() * 0.55;
      const opacity = 0.45 + Math.random() * 0.55;
      const duration = 0.35 + Math.random() * 0.95;

      node.style.transition = `top ${duration}s ease-in-out, left ${duration}s ease-in-out, transform ${duration}s ease-in-out, opacity ${duration}s ease-in-out`;
      node.style.top = `${top}px`;
      node.style.left = `${left}px`;
      node.style.transform = `rotate(${rotate}deg) scale(${scale})`;
      node.style.opacity = String(opacity);

      // 下一次在「差不多走完」前后随机再拐，避免节拍感
      const nextIn = duration * 1000 * (0.45 + Math.random() * 0.75);
      timer = window.setTimeout(tick, nextIn);
    };

    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div
      className={cn('relative flex h-14 w-14 items-center justify-center', className)}
      aria-hidden
    >
      <span className="stoclaw-voice-glow stoclaw-voice-glow--warm" />
      <span className="stoclaw-voice-glow stoclaw-voice-glow--gold stoclaw-voice-glow--d1" />
      <span className="stoclaw-voice-glow stoclaw-voice-glow--peach stoclaw-voice-glow--d2" />
      {/* 外柔晕 → 主光核 → 内高光，三层叠出体积感 */}
      <span className="stoclaw-voice-orb-halo" />
      <span className="stoclaw-voice-orb relative z-10">
        <span className="stoclaw-voice-orb-core" />
        <span ref={shineRef} className="stoclaw-voice-orb-shine" />
      </span>
    </div>
  );
}

/** @deprecated 使用 VoiceListeningOrb */
export const VoiceWaveform = VoiceListeningOrb;

/** 语音模式：一小段音波沿输入框上沿从左向右滚过 */
const VOICE_EDGE_BAR_HEIGHTS = (() => {
  const n = 14;
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * Math.PI;
    // 中间高、两端收成尖，整段只占上沿一小截
    const envelope = Math.sin(t);
    const ripple = 0.45 + 0.55 * Math.abs(Math.sin(i * 1.7 + 0.3));
    return Math.max(0.2, envelope * ripple);
  });
})();

/** 每根条不同周期/相位，滚动时高度错落变化，避免整段硬平移 */
const VOICE_EDGE_BAR_MOTION = VOICE_EDGE_BAR_HEIGHTS.map((_, i) => ({
  durationSec: 0.38 + (i % 5) * 0.09 + (i % 3) * 0.04,
  delaySec: (i * 0.07) % 0.85,
}));

export function VoiceTopCrawlWave({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        // inset 避开左右圆角：只在上沿平直段滚动，避免角上像悬浮
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
  /** 确认倒计时剩余秒数（向上取整展示） */
  confirmSecondsLeft?: number;
  /** 确认阶段顶部提示，如「准备自动发送」 */
  confirmTitle?: string;
  cancelLabel?: string;
  onCancelConfirm?: () => void;
  className?: string;
  compact?: boolean;
}

/**
 * Replaces the text editor while voice ASR is active.
 * Listening indicator is decorative (CSS only), not driven by microphone level.
 */
export function VoiceComposerPanel({
  mode = 'listening',
  statusLabel,
  transcript,
  connecting = false,
  confirmSecondsLeft,
  confirmTitle,
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

  const showListening = mode === 'listening';
  const dimListening = connecting || mode === 'waiting';
  const isConfirm = mode === 'confirm';

  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center gap-3 rounded-xl',
        compact ? 'min-h-[72px] py-3' : 'min-h-[96px] py-4',
        className,
      )}
    >
      {showListening ? (
        <VoiceListeningOrb className={dimListening ? 'opacity-50' : undefined} />
      ) : mode === 'waiting' ? (
        <div className="flex h-11 items-center justify-center" aria-hidden>
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary/80" />
        </div>
      ) : (
        <div className="flex min-h-11 flex-col items-center justify-center gap-1">
          {confirmTitle ? (
            <p className="text-[12px] font-medium text-primary/90">
              {confirmTitle}
            </p>
          ) : null}
          <div className="text-[22px] font-semibold tabular-nums leading-none text-primary">
            {typeof confirmSecondsLeft === 'number' ? confirmSecondsLeft : '—'}
          </div>
        </div>
      )}
      {!isConfirm ? (
        <p className="text-[12px] font-medium text-primary/90">
          {statusLabel}
        </p>
      ) : null}
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
      {isConfirm && onCancelConfirm ? (
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
