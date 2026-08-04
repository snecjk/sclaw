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

  it('uses realName and userName as 工号', () => {
    expect(formatUserWatermarkText({
      realName: '张三',
      userName: '10001',
      empCode: '',
      code: '',
    })).toBe('张三 10001');
  });

  it('does not duplicate when name equals 工号', () => {
    expect(formatUserWatermarkText({
      realName: '',
      userName: '10001',
      empCode: '',
      code: '',
    })).toBe('10001');
  });

  it('falls back to empCode then code for 工号', () => {
    expect(formatUserWatermarkText({
      realName: '李四',
      userName: '',
      empCode: 'E2',
      code: 'C3',
    })).toBe('李四 E2');
    expect(formatUserWatermarkText({
      realName: '李四',
      userName: '',
      empCode: '',
      code: 'C3',
    })).toBe('李四 C3');
  });
});
