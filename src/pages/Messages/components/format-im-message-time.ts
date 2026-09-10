/** 展示 IM 消息时间：统一为 YYYY-MM-DD HH:mm:ss */
export function formatImMessageTime(time: string): string {
  if (!time) return '';

  const full = time.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
  if (full) return time;

  const minute = time.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
  if (minute) return `${minute[1]} ${minute[2]}:00`;

  const clock = time.match(/^(\d{2}):(\d{2})$/);
  if (clock) return `2026-03-07 ${clock[1]}:${clock[2]}:00`;

  return time;
}

/** 消息元信息行：17:43 */
export function formatImMessageClock(time: string): string {
  const formatted = formatImMessageTime(time);
  const match = formatted.match(/\d{2}:\d{2}:\d{2}$/);
  if (match) return match[0].slice(0, 5);
  const short = time.match(/^(\d{2}:\d{2})$/);
  if (short) return short[1];
  return formatted;
}
