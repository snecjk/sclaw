/**
 * Portal 层：监听飞入目标事件，把 `children` 从事件起点矩形
 * 动画到 `targetRef`（外层管 Y、内层管 X、视觉层管缩放）。
 *
 * 与聊天 / 快捷输入解耦：调用方自行传入终点 ref 与飞球内容。
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  FLY_TO_TARGET_ARRIVE_DOWN_MS,
  FLY_TO_TARGET_ARRIVE_POP_SCALE,
  FLY_TO_TARGET_ARRIVE_UP_MS,
  FLY_TO_TARGET_DURATION_MS,
  FLY_TO_TARGET_EVENT,
  FLY_TO_TARGET_MAX_BALLS,
  FLY_TO_TARGET_SCALE_EASING,
  FLY_TO_TARGET_X_EASING,
  FLY_TO_TARGET_Y_EASING,
} from './constants';
import { popScaleThenRestore } from './motion';
import type { FlyBallState, FlyToTargetDetail, FlyToTargetRect } from './types';

/** 是否开启系统「减少动态效果」 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 把 live DOMRect 拷成纯对象，避免后续被改写 */
function snapshotRect(rect: DOMRect): FlyToTargetRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** 取矩形边长（用于缩放比计算） */
function rectSize(rect: FlyToTargetRect): number {
  return Math.max(rect.width, rect.height, 1);
}

/**
 * 单颗飞球：三层 DOM 分别驱动 Y / X / scale，合成抛物线落点。
 * - outer：纵向位移
 * - mid：横向位移
 * - visual：缩放
 */
function FlyBall({
  startRect,
  endRect,
  targetRef,
  children,
  onDone,
}: {
  startRect: FlyToTargetRect;
  endRect: FlyToTargetRect;
  targetRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  onDone: () => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const mid = midRef.current;
    const visual = visualRef.current;
    if (!outer || !mid || !visual) return;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;

      // 立刻隐藏飞球，露出真实目标上的缩放反馈
      // （否则飞球盖住目标，卸载时会像闪一下）
      outer.style.opacity = '0';

      const target = targetRef.current;
      if (target && !prefersReducedMotion()) {
        void popScaleThenRestore(target, {
          scale: FLY_TO_TARGET_ARRIVE_POP_SCALE,
          upMs: FLY_TO_TARGET_ARRIVE_UP_MS,
          downMs: FLY_TO_TARGET_ARRIVE_DOWN_MS,
        }).finally(() => onDoneRef.current());
        return;
      }

      onDoneRef.current();
    };

    const endSize = rectSize(endRect);
    const startSize = rectSize(startRect);
    const startScale = startSize / endSize;

    // 以终点中心为锚点，起点相对终点的偏移量
    const endCX = endRect.left + endRect.width / 2;
    const endCY = endRect.top + endRect.height / 2;
    const startCX = startRect.left + startRect.width / 2;
    const startCY = startRect.top + startRect.height / 2;
    const dx = startCX - endCX;
    const dy = startCY - endCY;

    // 外层固定在终点位置；位移/缩放从「起点姿态」过渡到 identity
    outer.style.left = `${endCX - endSize / 2}px`;
    outer.style.top = `${endCY - endSize / 2}px`;
    outer.style.width = `${endSize}px`;
    outer.style.height = `${endSize}px`;

    outer.style.transition = 'none';
    mid.style.transition = 'none';
    visual.style.transition = 'none';
    outer.style.transform = `translate3d(0, ${dy}px, 0)`;
    mid.style.transform = `translate3d(${dx}px, 0, 0)`;
    visual.style.transform = `scale(${startScale})`;

    // 强制 layout，确保浏览器先提交起点姿态再开 transition
    void outer.offsetHeight;

    outer.style.transition = `transform ${FLY_TO_TARGET_DURATION_MS}ms ${FLY_TO_TARGET_Y_EASING}`;
    mid.style.transition = `transform ${FLY_TO_TARGET_DURATION_MS}ms ${FLY_TO_TARGET_X_EASING}`;
    visual.style.transition = `transform ${FLY_TO_TARGET_DURATION_MS}ms ${FLY_TO_TARGET_SCALE_EASING}`;
    outer.style.transform = 'translate3d(0, 0, 0)';
    mid.style.transform = 'translate3d(0, 0, 0)';
    visual.style.transform = 'scale(1)';

    const handleEnd = (event: TransitionEvent) => {
      // 只认外层 transitionend，避免内层冒泡误触发 finish
      if (event.target !== outer) return;
      finish();
    };

    outer.addEventListener('transitionend', handleEnd);
    // transitionend 偶发丢失时的兜底
    const fallback = window.setTimeout(finish, FLY_TO_TARGET_DURATION_MS + 80);

    return () => {
      outer.removeEventListener('transitionend', handleEnd);
      window.clearTimeout(fallback);
    };
  }, [startRect, endRect, targetRef]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={outerRef}
      className="pointer-events-none fixed z-[9999] will-change-transform"
      aria-hidden
    >
      <div ref={midRef} className="h-full w-full will-change-transform">
        <div
          ref={visualRef}
          className="flex h-full w-full origin-center items-center justify-center will-change-transform [&>svg]:h-full [&>svg]:w-full"
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface FlyToTargetLayerProps {
  /** 动画终点锚点（如工具栏按钮） */
  targetRef: RefObject<HTMLElement | null>;
  /** 飞向目标的视觉内容（图标 / 节点），建议用 `h-full w-full` 撑满 */
  children: ReactNode;
}

/** 挂载后监听飞行事件，按需渲染多颗 FlyBall */
export function FlyToTargetLayer({ targetRef, children }: FlyToTargetLayerProps) {
  const [balls, setBalls] = useState<FlyBallState[]>([]);
  const seqRef = useRef(0);

  useEffect(() => {
    const handleFly = (event: Event) => {
      if (prefersReducedMotion()) return;

      const target = targetRef.current;
      if (!target) return;

      const detail = (event as CustomEvent<FlyToTargetDetail>).detail;
      const startRect = detail?.startRect;
      if (!startRect) return;

      const endRect = snapshotRect(target.getBoundingClientRect());

      setBalls((prev) => {
        if (prev.length >= FLY_TO_TARGET_MAX_BALLS) return prev;
        seqRef.current += 1;
        return [
          ...prev,
          {
            id: seqRef.current,
            startRect: { ...startRect },
            endRect,
          },
        ];
      });
    };

    window.addEventListener(FLY_TO_TARGET_EVENT, handleFly);
    return () => window.removeEventListener(FLY_TO_TARGET_EVENT, handleFly);
  }, [targetRef]);

  if (balls.length === 0) return null;

  return (
    <>
      {balls.map((ball) => (
        <FlyBall
          key={ball.id}
          startRect={ball.startRect}
          endRect={ball.endRect}
          targetRef={targetRef}
          onDone={() => {
            setBalls((prev) => prev.filter((item) => item.id !== ball.id));
          }}
        >
          {children}
        </FlyBall>
      ))}
    </>
  );
}
