/**
 * 轮次满意度反馈（T13）：localStorage 持久化 turnKey → 评分。
 */
const STORAGE_KEY = 'stoclaw:app-dev-turn-feedback-v1';

export type AppDevTurnRating = 'up' | 'down';

type FeedbackMap = Record<string, { rating: AppDevTurnRating; at: number }>;

function readAll(): FeedbackMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as FeedbackMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map: FeedbackMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

export function getAppDevTurnRating(workspaceId: string, turnKey: string): AppDevTurnRating | null {
  const key = `${workspaceId}::${turnKey}`;
  return readAll()[key]?.rating ?? null;
}

export function setAppDevTurnRating(
  workspaceId: string,
  turnKey: string,
  rating: AppDevTurnRating,
): void {
  const all = readAll();
  all[`${workspaceId}::${turnKey}`] = { rating, at: Date.now() };
  writeAll(all);
}

export function buildFollowUpQuestion(suggestionLabel?: string | null): string {
  if (suggestionLabel?.trim()) {
    return `还需要「${suggestionLabel.trim()}」吗？`;
  }
  return '还需要调整其他地方吗？';
}
