import { describe, expect, it } from 'vitest';
import { formatUserWatermarkText } from '@/lib/user-watermark-text';

describe('formatUserWatermarkText', () => {
  it('returns null without user or name', () => {
    expect(formatUserWatermarkText(null)).toBeNull();
    expect(formatUserWatermarkText({
      realName: '',
      userName: '',
      empCode: '',
      code: '',
    })).toBeNull();
  });

  it('uses realName and code as 工号', () => {
    expect(formatUserWatermarkText({
      realName: '张三',
      userName: '10001',
      empCode: 'E2',
      code: 'W3',
    })).toBe('张三 W3');
  });

  it('does not duplicate when realName equals code', () => {
    expect(formatUserWatermarkText({
      realName: '10001',
      userName: '',
      empCode: '',
      code: '10001',
    })).toBe('10001');
  });

  it('falls back to userName for name when realName is empty', () => {
    expect(formatUserWatermarkText({
      realName: '',
      userName: '登录名',
      empCode: 'E2',
      code: 'C3',
    })).toBe('登录名 C3');
  });

  it('omits 工号 when code is empty', () => {
    expect(formatUserWatermarkText({
      realName: '李四',
      userName: '10001',
      empCode: 'E2',
      code: '',
    })).toBe('李四');
  });
});
