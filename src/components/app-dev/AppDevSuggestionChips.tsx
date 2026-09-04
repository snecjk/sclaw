/**
 * 情境建议 chips（T09）：点击填入 composer，不自动发送。
 */
import { cn } from '@/lib/utils';

export interface AppDevSuggestionChip {
  label: string;
  prompt: string;
}

interface AppDevSuggestionChipsProps {
  suggestions: AppDevSuggestionChip[];
  onPick: (prompt: string) => void;
  className?: string;
}

export function AppDevSuggestionChips({
  suggestions,
  onPick,
  className,
}: AppDevSuggestionChipsProps) {
  if (suggestions.length === 0) return null;
  return (
    <div className={cn('mt-2 flex flex-wrap gap-1.5', className)}>
      {suggestions.slice(0, 3).map((item, index) => (
        <button
          key={`${item.label}-${index}`}
          type="button"
          className="h-7 rounded-full border border-border px-3 text-xs text-foreground transition-colors hover:bg-[var(--sto-control-hover-bg)] animate-in fade-in duration-150"
          style={{ animationDelay: `${index * 60}ms` }}
          onClick={() => onPick(item.prompt)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** 从助手文本提取 ```sclaw_suggestions fenced JSON。 */
export function extractSclawSuggestions(text: string): AppDevSuggestionChip[] {
  const match = text.match(/```sclaw_suggestions\s*([\s\S]*?)```/i);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1].trim()) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const label = typeof (item as { label?: unknown }).label === 'string'
          ? (item as { label: string }).label.trim()
          : '';
        const prompt = typeof (item as { prompt?: unknown }).prompt === 'string'
          ? (item as { prompt: string }).prompt.trim()
          : '';
        if (!label || !prompt) return null;
        return { label, prompt };
      })
      .filter((x): x is AppDevSuggestionChip => Boolean(x))
      .slice(0, 3);
  } catch {
    return [];
  }
}

/** Agent 未输出时的降级建议。 */
export function buildFallbackSuggestions(input: {
  changedStyles?: boolean;
  changedData?: boolean;
}): AppDevSuggestionChip[] {
  if (input.changedStyles) {
    return [
      { label: '检查移动端效果', prompt: '请检查一下移动端效果，修复横向溢出或过窄布局。' },
      { label: '再优化配色', prompt: '请在现有主题 token 上再优化一下配色对比与层次。' },
    ];
  }
  if (input.changedData) {
    return [
      { label: '加个空态展示', prompt: '请为空数据状态加一个友好的空态展示。' },
      { label: '处理加载失败', prompt: '请补充加载失败时的错误提示与重试入口。' },
    ];
  }
  return [
    { label: '继续完善页面', prompt: '请基于当前页面继续完善交互与视觉细节。' },
    { label: '检查移动端效果', prompt: '请切换到移动端视角检查布局并修复问题。' },
  ];
}
