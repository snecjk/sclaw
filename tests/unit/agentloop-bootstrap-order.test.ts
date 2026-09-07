import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetAgentLoopForTest,
  bootstrap,
} from '../../electron/main/agentloop-init';

/**
 * 验证主进程引导编排（task 2.2）：
 * bootstrap() 必须先同步注册 CMS 探针，再加载业务入口（./main）；
 * 业务入口加载过程中首次触碰 Claude Agent SDK 必须发生在探针注册之后，
 * 以保证 @loongsuite/cms_node_sdk 能自动插桩。
 */
describe('主进程引导编排加载顺序（task 2.2）', () => {
  beforeEach(() => {
    __resetAgentLoopForTest();
  });

  it('先注册探针，再加载业务入口；Claude SDK 加载在探针注册之后', async () => {
    const events: string[] = [];
    const loadProbe = vi.fn(() => {
      events.push('register-probe');
      return {};
    });
    // 模拟业务入口被加载：其模块初始化阶段会首次加载 Claude SDK（经 loader）。
    const loader = vi.fn(async () => {
      events.push('load-main-module');
      events.push('load-claude-sdk');
      return {};
    });

    await bootstrap({
      env: { ARMS_APP_NAME: 'sto-claw-development' },
      readSecretsFile: () => JSON.stringify({ licenseKey: 'lic-x' }),
      loadProbe,
      loader,
      log: () => {},
    });

    expect(loadProbe).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledTimes(1);

    const probeIdx = events.indexOf('register-probe');
    const mainIdx = events.indexOf('load-main-module');
    const sdkIdx = events.indexOf('load-claude-sdk');

    expect(probeIdx).toBe(0);
    expect(mainIdx).toBeGreaterThan(probeIdx);
    expect(sdkIdx).toBeGreaterThan(probeIdx);
  });

  it('探针注册失败时 fail-open：仍加载业务入口', async () => {
    const loader = vi.fn(async () => ({}));
    await bootstrap({
      env: { ARMS_APP_NAME: 'sto-claw-test' },
      readSecretsFile: () => JSON.stringify({ licenseKey: 'lic-x' }),
      loadProbe: () => {
        throw new Error('probe load failed');
      },
      loader,
      log: () => {},
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('缺失 License 时 fail-open：仍加载业务入口（探针不注册）', async () => {
    const loadProbe = vi.fn();
    const loader = vi.fn(async () => ({}));
    await bootstrap({
      env: { ARMS_APP_NAME: 'sto-claw-test' },
      readSecretsFile: () => null,
      loadProbe,
      loader,
      log: () => {},
    });
    expect(loadProbe).not.toHaveBeenCalled();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
