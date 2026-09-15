import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuthState } = vi.hoisted(() => ({
  getAuthState: vi.fn(),
}));

vi.mock('../../electron/utils/auth-store', () => ({
  getAuthState,
}));

import {
  formatAgentCurrentUserContext,
  getAgentCurrentUserContextPrompt,
} from '../../electron/services/agent-current-user-context';

describe('agent current user context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats the shared Claude and Pi login context from allowlisted fields', () => {
    const prompt = formatAgentCurrentUserContext({
      userName: ' zhangsan ',
      code: ' 00123456 ',
      realName: ' 张三 ',
      companyCode: ' 310001 ',
      companyName: ' 上海转运中心 ',
      departmentCode: ' 10086 ',
      departmentName: ' 运营管理部 ',
    });

    expect(prompt).toContain('当前登录用户信息（已认证）');
    expect(prompt).toContain('- 用户名：zhangsan');
    expect(prompt).toContain('- 用户工号（code）：00123456');
    expect(prompt).toContain('- 真实姓名：张三');
    expect(prompt).toContain('- 网点编码（companyCode）：310001');
    expect(prompt).toContain('- 组织编码（departmentCode）：10086');
  });

  it('omits empty optional fields and rejects an empty username', () => {
    expect(formatAgentCurrentUserContext({
      userName: 'zhangsan',
      code: ' ',
      realName: ' ',
      companyCode: '',
      companyName: '',
      departmentCode: '',
      departmentName: '',
    })).toBe(
      '当前登录用户信息（已认证）：\n- 用户名：zhangsan\n\n'
      + '⚠️ 重要：当调用任何技能、工具或工作流时，如果参数要求提供网点编码（companyCode）或组织编码（departmentCode），而用户没有明确指定其他网点/组织，必须直接使用上述当前登录用户的网点编码和组织编码，禁止向用户询问。不要在对话中要求用户提供这些信息。',
    );
    expect(formatAgentCurrentUserContext({ userName: '   ' })).toBeUndefined();
  });

  it('reads the current authenticated user for every call', async () => {
    getAuthState
      .mockResolvedValueOnce({ isAuthenticated: true, user: { userName: 'user-a' } })
      .mockResolvedValueOnce({ isAuthenticated: true, user: { userName: 'user-b' } });

    expect(await getAgentCurrentUserContextPrompt()).toContain('用户名：user-a');
    expect(await getAgentCurrentUserContextPrompt()).toContain('用户名：user-b');
    expect(getAuthState).toHaveBeenCalledTimes(2);
  });

  it('skips anonymous and failed auth reads without exposing sensitive fields', async () => {
    getAuthState.mockResolvedValueOnce({ isAuthenticated: false, user: null });
    expect(await getAgentCurrentUserContextPrompt()).toBeUndefined();

    getAuthState.mockRejectedValueOnce(new Error('auth unavailable'));
    expect(await getAgentCurrentUserContextPrompt()).toBeUndefined();

    const prompt = formatAgentCurrentUserContext({ userName: 'safe-user' });
    expect(prompt).not.toContain('stoToken');
    expect(prompt).not.toContain('roles');
    expect(prompt).not.toContain('isAdministrator');
  });
});
