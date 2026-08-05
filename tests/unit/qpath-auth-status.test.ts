import { describe, expect, it } from 'vitest';

import {
  extractQpathLoginUrl,
  extractQpathSkillRevisionFromFilename,
  isQpathAuthExpiredMessage,
  parseQpathStatusLoggedIn,
  shouldUpdateQpathSkill,
} from '../../electron/connectors/adapters/qpath-auth-status';

describe('qpath-auth-status', () => {
  it('extracts DingTalk login URL from login output', () => {
    const output = `
备用登录链接:
https://login.dingtalk.com/oauth2/auth?client_id=abc&response_type=code&scope=openid
[4/4] 等待扫码结果...
`;
    expect(extractQpathLoginUrl(output)).toContain('login.dingtalk.com/oauth2/auth?client_id=abc');
  });

  it('parses status logged-in text', () => {
    expect(parseQpathStatusLoggedIn('登录状态: 已登录\ntokenId: 已配置')).toBe(true);
    expect(parseQpathStatusLoggedIn('登录状态: 未登录')).toBe(false);
  });

  it('detects auth expired messages', () => {
    expect(isQpathAuthExpiredMessage('错误: 未登录，请先运行 qpath login')).toBe(true);
    expect(isQpathAuthExpiredMessage('project list ok')).toBe(false);
  });

  it('compares skill revisions', () => {
    expect(shouldUpdateQpathSkill(null, 'abc')).toBe(true);
    expect(shouldUpdateQpathSkill('abc', 'abc')).toBe(false);
    expect(shouldUpdateQpathSkill('abc', 'def')).toBe(true);
  });

  it('extracts revision from archive filename', () => {
    expect(
      extractQpathSkillRevisionFromFilename(
        'qpath-cli-skill-main-f59cd60e141961f1485f8cbd58a8cf1ea19a092c.tar.gz',
      ),
    ).toBe('f59cd60e141961f1485f8cbd58a8cf1ea19a092c');
  });
});
