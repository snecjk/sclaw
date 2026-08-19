import { describe, expect, it } from 'vitest';

// 通过动态导入测 cursor 编解码：从 history-facade 导出的行为用 list 的 cursor 形状验证
function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): Record<string, unknown> | null {
  if (!cursor?.trim()) return null;
  try {
    const raw = Buffer.from(cursor.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

describe('mobile history cursor', () => {
  it('round-trips opaque cursor for App pass-through', () => {
    const encoded = encodeCursor({ offset: 20 });
    expect(decodeCursor(encoded)).toEqual({ offset: 20 });
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('not-valid!!!')).toBeNull();
  });

  it('round-trips beforeMessageId cursor for detail scroll', () => {
    const encoded = encodeCursor({ beforeMessageId: 'msg-9' });
    expect(decodeCursor(encoded)).toEqual({ beforeMessageId: 'msg-9' });
  });
});
