/**
 * T04 轮次版本辅助纯函数：checkpoint subject 生成 + 映射缺失时的最近邻降级。
 */
import type { AppCheckpoint } from '@/lib/app-dev-api';
import type { AppDevTurnVersion } from '@/stores/app-dev-versions';

/** 用户消息摘要：压缩空白后截断（subject 用前 20 字，存档保留 40 字）。 */
export function excerptUserText(text: string, max = 40): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** checkpoint subject：`对话修改 · <用户消息前 20 字>`（无摘要时退化为固定文案）。 */
export function buildTurnCheckpointSubject(excerpt?: string | null): string {
  const trimmed = (excerpt ?? '').trim();
  return trimmed ? `对话修改 · ${trimmed.slice(0, 20)}` : '对话修改';
}

/** 最近邻对齐窗口：轮结束时间与 checkpoint 时间差超过该值则不认账。 */
const FALLBACK_WINDOW_MS = 10 * 60 * 1000;

/**
 * 解析某轮次对应的 checkpoint：
 * 优先 turnKey 映射；缺失时（旧会话/持久化丢失）按时间戳最近邻降级对齐。
 */
export function resolveTurnCheckpoint(input: {
  mapped?: AppDevTurnVersion | null;
  checkpoints: readonly AppCheckpoint[];
  turnEndedAt: number | null;
}): { hash: string; subject: string } | null {
  if (input.mapped?.hash) {
    return { hash: input.mapped.hash, subject: input.mapped.subject };
  }
  if (input.turnEndedAt == null) return null;
  let best: AppCheckpoint | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const checkpoint of input.checkpoints) {
    if (typeof checkpoint.timestamp !== 'number') continue;
    const delta = Math.abs(checkpoint.timestamp - input.turnEndedAt);
    if (delta < bestDelta) {
      best = checkpoint;
      bestDelta = delta;
    }
  }
  if (!best || bestDelta > FALLBACK_WINDOW_MS) return null;
  return { hash: best.hash, subject: best.subject };
}
