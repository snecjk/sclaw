function resultText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['stdout', 'output', 'text', 'aggregated', 'content', 'result', 'body']) {
    const nested = record[key];
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function isSuccessfulDingTalkSend(isError: boolean, result: unknown): boolean {
  if (isError) return false;
  const text = resultText(result);
  if (!text || /"ok"\s*:\s*false/i.test(text) || /\bok\s*[:=]\s*false/i.test(text)) return false;
  if (/error|failed|失败|错误/i.test(text) && !/"ok"\s*:\s*true/i.test(text)) return false;
  return /"ok"\s*:\s*true/i.test(text)
    || /\bsuccess(?:ful)?\b/i.test(text)
    || /发送成功|已发送|openTaskId|processQueryKey/i.test(text);
}
