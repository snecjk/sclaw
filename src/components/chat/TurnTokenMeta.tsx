import { formatTurnTokenCount, type TurnTokenUsage } from '../../../shared/turn-token';

export function TurnTokenMeta({ usage }: { usage: TurnTokenUsage }) {
  return (
    <span className="text-xs text-muted-foreground">
      {`输入 ${formatTurnTokenCount(usage.promptTokens)} / 输出 ${formatTurnTokenCount(usage.completionTokens)} tokens`}
    </span>
  );
}
