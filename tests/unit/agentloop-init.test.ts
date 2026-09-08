import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENTLOOP_EXPECTED_APP_NAMES,
  __resetAgentLoopForTest,
  initAgentLoop,
  type AgentLoopInitDeps,
} from '../../electron/main/agentloop-init';

type Env = Record<string, string | undefined>;

function makeDeps(overrides: Partial<AgentLoopInitDeps> & { env?: Env } = {}) {
  const logs: { level: string; message: string }[] = [];
  const loadProbe = overrides.loadProbe ?? vi.fn(() => ({}));
  const deps: AgentLoopInitDeps = {
    env: overrides.env ?? {},
    mainDir: overrides.mainDir ?? '/fake/dist-electron/main',
    readSecretsFile: overrides.readSecretsFile ?? (() => null),
    loadProbe,
    log: (level, message) => logs.push({ level, message }),
  };
  return { deps, logs, loadProbe: loadProbe as ReturnType<typeof vi.fn> };
}

const SECRETS_WITH_LICENSE = JSON.stringify({ licenseKey: 'lic-valid' });

describe('AgentLoop 主进程初始化（task 2.1）', () => {
  beforeEach(() => {
    __resetAgentLoopForTest();
  });

  describe('完整配置', () => {
    it('应用名 + License 完整时注册探针并透传非敏感字段', () => {
      const env: Env = {
        ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-test',
        ARMS_REGION_ID: 'cn-shanghai',
        ARMS_WORKSPACE: 'ws-1',
        ARMS_ENABLE_CONSOLE_EXPORTER: 'true',
      };
      const { deps, loadProbe } = makeDeps({
        env,
        readSecretsFile: () => SECRETS_WITH_LICENSE,
      });
      const result = initAgentLoop(deps);
      expect(result.initialized).toBe(true);
      expect(result.status).toBe('registered');
      expect(loadProbe).toHaveBeenCalledTimes(1);
      // License 与应用名写入运行时 env，供探针读取
      expect(env.ARMS_LICENSE_KEY).toBe('lic-valid');
      expect(env.ARMS_APP_NAME).toBe('SClaw-Claude_Agent_SDK-test');
      expect(env.ARMS_REGION_ID).toBe('cn-shanghai');
      expect(env.ARMS_WORKSPACE).toBe('ws-1');
    });

    it('四种环境应用名均可初始化', () => {
      for (const appName of Object.values(AGENTLOOP_EXPECTED_APP_NAMES)) {
        __resetAgentLoopForTest();
        const { deps } = makeDeps({
          env: { ARMS_APP_NAME: appName },
          readSecretsFile: () => SECRETS_WITH_LICENSE,
        });
        expect(initAgentLoop(deps).initialized).toBe(true);
      }
    });
  });

  describe('缺失 License', () => {
    it('无 agentloop.config.json 时跳过初始化并告警（不加载探针）', () => {
      const { deps, logs, loadProbe } = makeDeps({
        env: { ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-online' },
        readSecretsFile: () => null,
      });
      const result = initAgentLoop(deps);
      expect(result.initialized).toBe(false);
      expect(result.status).toBe('skip');
      expect(result.reason).toBe('missing-license');
      expect(loadProbe).not.toHaveBeenCalled();
      expect(logs.some((l) => l.level === 'warn' && l.message.includes('License'))).toBe(true);
    });

    it('License 为占位值 auto 时跳过初始化', () => {
      const { deps, loadProbe } = makeDeps({
        env: { ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-test' },
        readSecretsFile: () => JSON.stringify({ licenseKey: 'auto' }),
      });
      const result = initAgentLoop(deps);
      expect(result.initialized).toBe(false);
      expect(result.reason).toBe('license-auto');
      expect(loadProbe).not.toHaveBeenCalled();
    });

    it('agentloop.config.json 非法 JSON 时 fail-open 跳过', () => {
      const { deps, loadProbe } = makeDeps({
        env: { ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-test' },
        readSecretsFile: () => '{ not json',
      });
      const result = initAgentLoop(deps);
      expect(result.initialized).toBe(false);
      expect(result.reason).toBe('secrets-parse-error');
      expect(loadProbe).not.toHaveBeenCalled();
    });
  });

  describe('应用名不匹配（环境串流防护）', () => {
    it('应用名不在固定映射内时拒绝初始化', () => {
      const { deps, logs, loadProbe } = makeDeps({
        env: { ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-online-copy' },
        readSecretsFile: () => SECRETS_WITH_LICENSE,
      });
      const result = initAgentLoop(deps);
      expect(result.initialized).toBe(false);
      expect(result.reason).toBe('app-name-mismatch');
      expect(loadProbe).not.toHaveBeenCalled();
      expect(logs.some((l) => l.level === 'warn' && l.message.includes('环境串流'))).toBe(true);
    });

    it('缺失应用名时跳过初始化', () => {
      const { deps, loadProbe } = makeDeps({
        env: {},
        readSecretsFile: () => SECRETS_WITH_LICENSE,
      });
      const result = initAgentLoop(deps);
      expect(result.initialized).toBe(false);
      expect(result.reason).toBe('missing-app-name');
      expect(loadProbe).not.toHaveBeenCalled();
    });
  });

  describe('探针加载异常 fail-open', () => {
    it('loadProbe 抛错时不阻断，记录脱敏告警并返回 failed', () => {
      const { deps, logs } = makeDeps({
        env: { ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-test' },
        readSecretsFile: () => SECRETS_WITH_LICENSE,
        loadProbe: () => {
          throw new Error('Cannot find module @loongsuite/cms_node_sdk/register');
        },
      });
      const result = initAgentLoop(deps);
      expect(result.initialized).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.reason).toBe('probe-load-error');
      expect(logs.some((l) => l.level === 'warn' && l.message.includes('降级'))).toBe(true);
    });
  });

  describe('进程内幂等', () => {
    it('重复初始化只注册一次探针，第二次返回 already-initialized', () => {
      const { deps, loadProbe } = makeDeps({
        env: { ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-test' },
        readSecretsFile: () => SECRETS_WITH_LICENSE,
      });
      const first = initAgentLoop(deps);
      const second = initAgentLoop(deps);
      expect(first.status).toBe('registered');
      expect(second.status).toBe('already-initialized');
      expect(loadProbe).toHaveBeenCalledTimes(1);
    });
  });

  describe('构建期 define 注入（打包应用配置来源）', () => {
    it('env 缺省时从真实 process.env（define 注入点同源）解析配置并注册', () => {
      // 打包应用中 define 把 process.env.ARMS_APP_NAME 等字面量访问替换为构建期值；
      // 此处以 stubEnv 模拟该同源取值路径（未注入隔离 env，deps.env 缺省 = process.env）。
      vi.stubEnv('ARMS_APP_NAME', 'SClaw-Claude_Agent_SDK-test');
      vi.stubEnv('ARMS_REGION_ID', 'cn-shanghai');
      const loadProbe = vi.fn(() => ({}));
      try {
        const result = initAgentLoop({
          readSecretsFile: () => SECRETS_WITH_LICENSE,
          loadProbe,
          log: () => {},
        });
        expect(result.initialized).toBe(true);
        expect(result.status).toBe('registered');
        expect(loadProbe).toHaveBeenCalledTimes(1);
        expect(process.env.ARMS_LICENSE_KEY).toBe('lic-valid');
      } finally {
        delete process.env.ARMS_LICENSE_KEY;
        vi.unstubAllEnvs();
      }
    });

    it('注入隔离 env 时不回退到真实 process.env（测试隔离不被环境污染）', () => {
      vi.stubEnv('ARMS_APP_NAME', 'SClaw-Claude_Agent_SDK-online');
      try {
        const { deps, loadProbe } = makeDeps({
          env: {}, // 注入隔离 env 且缺失应用名
          readSecretsFile: () => SECRETS_WITH_LICENSE,
        });
        const result = initAgentLoop(deps);
        expect(result.initialized).toBe(false);
        expect(result.reason).toBe('missing-app-name');
        expect(loadProbe).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('可选运行策略透传（task 3.1）', () => {
    const TOGGLE_KEYS = [
      'ARMS_ENABLE_CONSOLE_EXPORTER',
      'OTEL_LOG_LEVEL',
      'OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT',
    ] as const;

    it('显式配置的开关在探针加载前写入 env', () => {
      const env: Env = {
        ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-test',
        ARMS_ENABLE_CONSOLE_EXPORTER: 'true',
        OTEL_LOG_LEVEL: 'debug',
        OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT: 'true',
      };
      let snapshot: Env = {};
      const { deps } = makeDeps({
        env,
        readSecretsFile: () => SECRETS_WITH_LICENSE,
        loadProbe: () => {
          snapshot = { ...env };
        },
      });
      const result = initAgentLoop(deps);
      expect(result.status).toBe('registered');
      expect(snapshot.ARMS_ENABLE_CONSOLE_EXPORTER).toBe('true');
      expect(snapshot.OTEL_LOG_LEVEL).toBe('debug');
      expect(snapshot.OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT).toBe('true');
    });

    it('未配置开关时不写入任何默认值（production 未配置不自动启用）', () => {
      const env: Env = { ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-online' };
      let snapshot: Env = {};
      const { deps } = makeDeps({
        env,
        readSecretsFile: () => SECRETS_WITH_LICENSE,
        loadProbe: () => {
          snapshot = { ...env };
        },
      });
      const result = initAgentLoop(deps);
      expect(result.status).toBe('registered');
      for (const key of TOGGLE_KEYS) {
        expect(key in snapshot).toBe(false);
      }
    });

    it('注入隔离 env 缺失开关时不回退真实 process.env（不跨环境污染）', () => {
      // 真实进程环境显式开启开关（模拟其他环境的本机环境变量）；
      // 注入的隔离 env 未配置开关时，探针加载前也不得出现这些键。
      vi.stubEnv('ARMS_ENABLE_CONSOLE_EXPORTER', 'true');
      vi.stubEnv('OTEL_LOG_LEVEL', 'debug');
      vi.stubEnv('OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT', 'true');
      try {
        const env: Env = { ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-online' };
        let snapshot: Env = {};
        const { deps } = makeDeps({
          env,
          readSecretsFile: () => SECRETS_WITH_LICENSE,
          loadProbe: () => {
            snapshot = { ...env };
          },
        });
        const result = initAgentLoop(deps);
        expect(result.status).toBe('registered');
        for (const key of TOGGLE_KEYS) {
          expect(key in snapshot).toBe(false);
        }
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('日志脱敏', () => {
    it('所有日志均不包含 License 值', () => {
      const license = 'lic-super-secret-value';
      const { deps, logs } = makeDeps({
        env: { ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-test' },
        readSecretsFile: () => JSON.stringify({ licenseKey: license }),
      });
      initAgentLoop(deps);
      const allLogs = logs.map((l) => l.message).join('\n');
      expect(allLogs).not.toContain(license);
    });
  });
});
