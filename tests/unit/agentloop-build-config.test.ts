import { describe, expect, it } from 'vitest';
import {
  applyAgentLoopRuntimeEnv,
  resolveAgentLoopBuildConfig,
  serializeAgentLoopSecrets,
  toAgentLoopProcessEnvDefine,
} from '../../scripts/agentloop-env';

describe('AgentLoop 构建期配置解析（task 1.2）', () => {
  describe('四种 mode 的环境文件应用名', () => {
    it.each([
      ['development', 'SClaw-Claude_Agent_SDK-Dev'],
      ['test', 'SClaw-Claude_Agent_SDK-Test'],
      ['staging', 'SClaw-Claude_Agent_SDK-Test'],
      ['production', 'SClaw-Claude_Agent_SDK-Online'],
    ] as const)('mode=%s 注入 %s', (mode, expected) => {
      const config = resolveAgentLoopBuildConfig(
        mode,
        { ARMS_APP_NAME: expected, ARMS_LICENSE_KEY: 'lic-from-file', ARMS_REGION_ID: 'cn-shanghai', ARMS_WORKSPACE: 'ws-1' },
        {},
      );
      expect(config.mode).toBe(mode);
      expect(config.appName).toBe(expected);
      expect(config.define.ARMS_APP_NAME).toBe(expected);
      expect(config.secrets.licenseKey).toBe('lic-from-file');
      expect(config.warnings.filter((w) => w.includes('License'))).toHaveLength(0);
    });
  });

  describe('ARMS_APP_NAME 配置来源', () => {
    it('原样使用当前环境配置，不按 mode 改写', () => {
      const config = resolveAgentLoopBuildConfig(
        'test',
        { ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-online', ARMS_LICENSE_KEY: 'lic' },
        {},
      );
      expect(config.appName).toBe('SClaw-Claude_Agent_SDK-online');
      expect(config.define.ARMS_APP_NAME).toBe('SClaw-Claude_Agent_SDK-online');
      expect(config.warnings.some((w) => w.includes('ARMS_APP_NAME'))).toBe(false);
    });

    it('未配置 ARMS_APP_NAME 时不生成默认值并告警', () => {
      const config = resolveAgentLoopBuildConfig('staging', {}, {});
      expect(config.appName).toBe('');
      expect(config.define.ARMS_APP_NAME).toBeUndefined();
      expect(config.warnings.some((w) => w.includes('ARMS_APP_NAME'))).toBe(true);
    });
  });

  describe('development local override 与 CI 密钥优先级', () => {
    it('development 接受 env 合并结果并保留配置的应用名', () => {
      // 模拟 loadEnv 已合并 .env.development + .env.development.local 的结果：
      // local 提供 License/Region/Workspace 与本地调试开关。
      const config = resolveAgentLoopBuildConfig(
        'development',
        {
          ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-Dev',
          ARMS_LICENSE_KEY: 'lic-local',
          ARMS_REGION_ID: 'cn-shanghai',
          ARMS_WORKSPACE: 'ws-local',
          ARMS_ENABLE_CONSOLE_EXPORTER: 'true',
          OTEL_LOG_LEVEL: 'debug',
          OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT: 'true',
        },
        {},
      );
      expect(config.appName).toBe('SClaw-Claude_Agent_SDK-Dev');
      expect(config.appName).not.toBe('SClaw-Claude_Agent_SDK-local');
      expect(config.secrets.licenseKey).toBe('lic-local');
      expect(config.define.ARMS_ENABLE_CONSOLE_EXPORTER).toBe('true');
      expect(config.define.OTEL_LOG_LEVEL).toBe('debug');
      expect(config.define.OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT).toBe('true');
    });

    it('CI 进程环境变量优先级高于 env 文件（License/Region/Workspace）', () => {
      const config = resolveAgentLoopBuildConfig(
        'production',
        { ARMS_LICENSE_KEY: 'lic-from-file', ARMS_REGION_ID: 'cn-hangzhou', ARMS_WORKSPACE: 'ws-file' },
        { ARMS_LICENSE_KEY: 'lic-from-ci', ARMS_REGION_ID: 'cn-shanghai', ARMS_WORKSPACE: 'ws-ci' },
      );
      expect(config.secrets.licenseKey).toBe('lic-from-ci');
      expect(config.define.ARMS_REGION_ID).toBe('cn-shanghai');
      expect(config.define.ARMS_WORKSPACE).toBe('ws-ci');
    });

    it('CI 仅覆盖 License 时，Region/Workspace 仍取 env 文件值', () => {
      const config = resolveAgentLoopBuildConfig(
        'test',
        { ARMS_REGION_ID: 'cn-shanghai', ARMS_WORKSPACE: 'ws-file' },
        { ARMS_LICENSE_KEY: 'lic-from-ci' },
      );
      expect(config.secrets.licenseKey).toBe('lic-from-ci');
      expect(config.define.ARMS_REGION_ID).toBe('cn-shanghai');
      expect(config.define.ARMS_WORKSPACE).toBe('ws-file');
    });
  });

  describe('License 安全处理', () => {
    it('缺失 License 时 secrets 为空并输出脱敏告警（不抛错、不含配置值）', () => {
      const config = resolveAgentLoopBuildConfig('production', {}, {});
      expect(config.secrets.licenseKey).toBeUndefined();
      expect(serializeAgentLoopSecrets(config.secrets)).not.toContain('licenseKey');
      const warning = config.warnings.find((w) => w.includes('License'));
      expect(warning).toBeDefined();
      expect(warning).toContain('mode=production');
    });

    it('ARMS_LICENSE_KEY=auto 视为无效并告警', () => {
      const config = resolveAgentLoopBuildConfig('development', { ARMS_LICENSE_KEY: 'auto' }, {});
      expect(config.secrets.licenseKey).toBeUndefined();
      expect(config.warnings.some((w) => w.includes('auto'))).toBe(true);
    });

    it('历史字段 ARMS_LICENSE 作为回退被接受', () => {
      const config = resolveAgentLoopBuildConfig('test', { ARMS_LICENSE: 'lic-legacy' }, {});
      expect(config.secrets.licenseKey).toBe('lic-legacy');
    });

    it('License 不进入 Vite define（仅写入 agentloop.config.json）', () => {
      const config = resolveAgentLoopBuildConfig('staging', { ARMS_APP_NAME: 'configured-name', ARMS_LICENSE_KEY: 'lic-secret' }, {});
      const define = toAgentLoopProcessEnvDefine(config);
      expect(define['process.env.ARMS_APP_NAME']).toBe(JSON.stringify('configured-name'));
      expect(JSON.stringify(define)).not.toContain('lic-secret');
      expect(JSON.stringify(define)).not.toContain('ARMS_LICENSE');
    });
  });

  describe('可选运行策略透传', () => {
    it('production 未显式配置时不注入 Console exporter / 调试日志 / 会话内容开关', () => {
      const config = resolveAgentLoopBuildConfig(
        'production',
        { ARMS_LICENSE_KEY: 'lic', ARMS_REGION_ID: 'cn-shanghai' },
        {},
      );
      expect(config.define.ARMS_ENABLE_CONSOLE_EXPORTER).toBeUndefined();
      expect(config.define.OTEL_LOG_LEVEL).toBeUndefined();
      expect(config.define.OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT).toBeUndefined();
    });

    it('空白字符串视为未配置', () => {
      const config = resolveAgentLoopBuildConfig(
        'test',
        { ARMS_LICENSE_KEY: 'lic', ARMS_REGION_ID: '  ', ARMS_ENABLE_CONSOLE_EXPORTER: '' },
        {},
      );
      expect(config.define.ARMS_REGION_ID).toBeUndefined();
      expect(config.define.ARMS_ENABLE_CONSOLE_EXPORTER).toBeUndefined();
      // License 去空白后仍有效
      expect(config.secrets.licenseKey).toBe('lic');
    });
  });

  describe('development Electron 启动环境', () => {
    it('只同步非敏感配置，不把 License 写入进程环境', () => {
      const config = resolveAgentLoopBuildConfig('development', {
        ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-Dev',
        ARMS_LICENSE_KEY: 'lic-secret',
        ARMS_REGION_ID: 'cn-shanghai',
      }, {});
      const targetEnv: Record<string, string | undefined> = {};

      applyAgentLoopRuntimeEnv(config, targetEnv);

      expect(targetEnv).toEqual({
        ARMS_APP_NAME: 'SClaw-Claude_Agent_SDK-Dev',
        ARMS_REGION_ID: 'cn-shanghai',
      });
      expect(targetEnv.ARMS_LICENSE_KEY).toBeUndefined();
      expect(targetEnv.ARMS_LICENSE).toBeUndefined();
    });
  });

  describe('mode 解析回退', () => {
    it('未知 mode 仅回退 mode 标识，不改写应用名', () => {
      const config = resolveAgentLoopBuildConfig('some-custom-mode', { ARMS_APP_NAME: 'custom-app' }, {});
      expect(config.mode).toBe('production');
      expect(config.appName).toBe('custom-app');
    });
  });
});
