import { useEffect, useRef, useState } from 'react';

/** 活跃块正常打字速度（字/秒）— 偏慢可读 */
const TYPING_CHARS_PER_SECOND = 22;
/** 单帧最多 reveal 字数 */
const MAX_CHARS_PER_FRAME = 3;
/** 块结束未打完时，快速补完时长（毫秒） */
const FINISH_DURATION_MS = 500;
/**
 * 各打字机模块（思考正文 / 工具参数 / 流式回复）共用上限：
 * 自块开始 reveal 起累计动画不超过此值，超时 instant 展示当前全文。
 */
export const TYPEWRITER_MAX_DURATION_MS = 2000;

export interface UseTypewriterRevealOptions {
  /** 活跃块 identity；变化且 enabled 时从 0 重新打字 */
  resetKey: string;
}

export interface UseTypewriterRevealResult {
  text: string;
  /** 含活跃打字 + 块结束补完阶段 */
  isAnimating: boolean;
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) {
    i += 1;
  }
  return i;
}

type RevealPhase = 'idle' | 'typing' | 'finishing';

/**
 * useTypewriterReveal — 增量打字机（Gateway 快照模型）
 *
 * - 仅对「相对上一快照的新增后缀」做打字；公共前缀 instant 落定
 * - enabled=false 且曾活跃：500ms 内快速补完，避免块切换闪屏
 * - 从未 enabled：立即全文（历史块）
 * - 自块开始累计 reveal 超过 {@link TYPEWRITER_MAX_DURATION_MS}：instant 展示当前全文（过长 JSON 等）
 */
export function useTypewriterReveal(
  targetText: string,
  enabled: boolean,
  { resetKey }: UseTypewriterRevealOptions,
): UseTypewriterRevealResult {
  const [displayedLength, setDisplayedLength] = useState(() =>
    enabled ? 0 : targetText.length,
  );
  const [phase, setPhase] = useState<RevealPhase>(enabled ? 'typing' : 'idle');

  const targetRef = useRef(targetText);
  const prevSnapshotRef = useRef('');
  const lengthRef = useRef(enabled ? 0 : targetText.length);
  const lastFrameAtRef = useRef(0);
  const finishCpsRef = useRef(TYPING_CHARS_PER_SECOND);
  const wasEnabledRef = useRef(enabled);
  const typingStartedAtRef = useRef(0);
  /** 超过 {@link TYPEWRITER_MAX_DURATION_MS} 后，同一块后续增量 instant 展示 */
  const typingCapExceededRef = useRef(false);

  targetRef.current = targetText;

  const snapToFullTarget = (markCapExceeded = false) => {
    if (markCapExceeded) {
      typingCapExceededRef.current = true;
    }
    const fullLen = targetRef.current.length;
    lengthRef.current = fullLen;
    setDisplayedLength(fullLen);
    setPhase('idle');
    prevSnapshotRef.current = targetRef.current;
  };

  // 新块：重置进度
  useEffect(() => {
    if (!enabled) return;
    prevSnapshotRef.current = '';
    lengthRef.current = 0;
    lastFrameAtRef.current = 0;
    finishCpsRef.current = TYPING_CHARS_PER_SECOND;
    typingStartedAtRef.current = performance.now();
    typingCapExceededRef.current = false;
    setPhase('typing');
    setDisplayedLength(0);
  }, [enabled, resetKey]);

  // 快照更新：公共前缀 instant 落定，只对后缀打字
  useEffect(() => {
    if (typingCapExceededRef.current && enabled) {
      lengthRef.current = targetText.length;
      setDisplayedLength(targetText.length);
      prevSnapshotRef.current = targetText;
      return;
    }

    if (phase === 'idle' && !enabled) return;

    const prevSnapshot = prevSnapshotRef.current;
    if (prevSnapshot !== targetText) {
      const prefixLen = commonPrefixLength(prevSnapshot, targetText);
      if (prefixLen > lengthRef.current) {
        lengthRef.current = prefixLen;
        setDisplayedLength(prefixLen);
      }
      prevSnapshotRef.current = targetText;
    }
  }, [targetText, enabled, phase]);

  // 活跃 → 非活跃：进入快速补完（从未活跃过的历史块直接全文）
  useEffect(() => {
    const wasEnabled = wasEnabledRef.current;
    wasEnabledRef.current = enabled;

    if (enabled) return;

    if (!wasEnabled) {
      lengthRef.current = targetText.length;
      setDisplayedLength(targetText.length);
      setPhase('idle');
      prevSnapshotRef.current = targetText;
      return;
    }

    const elapsed = performance.now() - typingStartedAtRef.current;
    if (typingCapExceededRef.current || elapsed >= TYPEWRITER_MAX_DURATION_MS) {
      snapToFullTarget(false);
      return;
    }

    const remaining = targetRef.current.length - lengthRef.current;
    if (remaining <= 0) {
      setPhase('idle');
      lengthRef.current = targetText.length;
      setDisplayedLength(targetText.length);
      return;
    }

    const budgetMs = Math.max(0, TYPEWRITER_MAX_DURATION_MS - elapsed);
    const finishMs = Math.min(FINISH_DURATION_MS, budgetMs);
    if (finishMs <= 0) {
      snapToFullTarget(false);
      return;
    }

    finishCpsRef.current = remaining / (finishMs / 1000);
    lastFrameAtRef.current = 0;
    setPhase('finishing');
  }, [enabled, targetText]);

  // 过长内容：打字机动画上限 2s，超时 instant 全文
  useEffect(() => {
    if (phase !== 'typing' || !enabled) return undefined;

    const elapsed = performance.now() - typingStartedAtRef.current;
    const remainingMs = TYPEWRITER_MAX_DURATION_MS - elapsed;

    if (remainingMs <= 0) {
      snapToFullTarget(true);
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      snapToFullTarget(true);
    }, remainingMs);

    return () => clearTimeout(timeoutId);
  }, [phase, enabled, resetKey]);

  // rAF：typing / finishing
  useEffect(() => {
    if (phase === 'idle') return undefined;

    let rafId = 0;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;

      const target = targetRef.current.length;
      const prev = lengthRef.current;

      if (
        typingStartedAtRef.current > 0
        && now - typingStartedAtRef.current >= TYPEWRITER_MAX_DURATION_MS
      ) {
        snapToFullTarget(true);
        return;
      }

      if (prev < target) {
        const lastAt = lastFrameAtRef.current;
        const dt = lastAt > 0 ? (now - lastAt) / 1000 : 0;
        lastFrameAtRef.current = now;

        const cps =
          phase === 'finishing' ? finishCpsRef.current : TYPING_CHARS_PER_SECOND;
        const step =
          dt > 0
            ? Math.min(MAX_CHARS_PER_FRAME, Math.max(1, Math.floor(cps * dt)))
            : 1;
        const next = Math.min(prev + step, target);
        lengthRef.current = next;
        setDisplayedLength(next);

        if (next >= target) {
          setPhase('idle');
          return;
        }
      } else {
        setPhase('idle');
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [phase, resetKey]);

  const text = targetText.slice(0, displayedLength);
  const isAnimating = phase !== 'idle' || displayedLength < targetText.length;

  return { text, isAnimating };
}
