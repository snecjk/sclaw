/**
 * STO OpenClaw 插件 config 的单一事实源。
 *
 * 主进程写 openclaw.json 时注入的每一份插件 config 都必须来自这里，
 * 且键必须在对应 openclaw.plugin.json 的 configSchema 里声明过
 * （schema 全部是 additionalProperties:false —— 多一个未声明的键就会让
 * OpenClaw 拒绝整份插件配置）。
 * 一致性由 tests/unit/openclaw-plugin-config-schema.test.ts 守住。
 *
 * 键顺序即写入 openclaw.json 的顺序：writeOpenClawJson 靠"内容不变就不写"
 * 避免触发 OpenClaw 文件监听硬重启，改动顺序会多出一次无谓重启。
 */

export const OPENCLAW_SSO_AUTH_PATH = '~/.stoclaw/openclaw/sso-auth.json';

export interface StoLocalPluginConfigInput {
  hostApiPort: number;
  hostApiHost?: string;
}

export interface StoBrowserAutomationConfigInput extends StoLocalPluginConfigInput {
  /** BAP loopback 鉴权 token；取不到时省略该键（双端保持 warn-only 灰度）。 */
  authToken?: string | null;
}

export interface StoOpenClawPluginConfigInput extends StoBrowserAutomationConfigInput {
  /** STO 后端基址（遥测/技能上报等远端地址）。 */
  stoBaseUrl: string;
  /** 本机 Host API 基址（含协议与端口）。 */
  localHostApiBaseUrl: string;
}

export function buildStoBrowserBridgePluginConfig(
  input: StoLocalPluginConfigInput,
): Record<string, unknown> {
  return {
    hostApiHost: input.hostApiHost ?? '127.0.0.1',
    hostApiPort: input.hostApiPort,
    commandTimeoutMs: 30_000,
  };
}

export function buildStoBrowserAutomationPluginConfig(
  input: StoBrowserAutomationConfigInput,
): Record<string, unknown> {
  return {
    hostApiHost: input.hostApiHost ?? '127.0.0.1',
    hostApiPort: input.hostApiPort,
    commandTimeoutMs: 120_000,
    ...(input.authToken ? { authToken: input.authToken } : {}),
  };
}

export function buildStoOpenClawPluginConfigs(
  input: StoOpenClawPluginConfigInput,
): Record<string, Record<string, unknown>> {
  const hostApiHost = input.hostApiHost ?? '127.0.0.1';

  return {
    'sto-dynamic-agent-route': {},
    'sto-agent-telemetry': {
      enabled: true,
      ingestUrl: `${input.stoBaseUrl}/agent/v1/agent-telemetry/events`,
      timeoutMs: 5000,
      ssoAuthPath: OPENCLAW_SSO_AUTH_PATH,
      conversationSyncEnabled: false,
      hooks: {
        beforeToolCall: true,
        afterToolCall: true,
        modelCallStarted: true,
        modelCallEnded: true,
        agentEnd: true,
      },
    },
    'sto-scheduled-task-tool': {
      hostApiHost,
      hostApiPort: input.hostApiPort,
      timeoutMs: 60_000,
    },
    'sto-workflow-tool': {
      baseUrl: input.localHostApiBaseUrl,
      ssoAuthPath: OPENCLAW_SSO_AUTH_PATH,
      timeoutMs: 30000,
    },
    'sto-user-skill-tool': {
      hostApiHost,
      hostApiPort: input.hostApiPort,
      timeoutMs: 60_000,
    },
    'sto-skill-call-monitor': {
      reportApiUrl: `${input.stoBaseUrl}/agent/v1/skills/usage-report`,
      ssoAuthPath: OPENCLAW_SSO_AUTH_PATH,
      timeoutMs: 5000,
    },
    'sto-media-understanding': {},
    'sto-dingtalk-send-guard': {},
    'sto-browser-bridge': buildStoBrowserBridgePluginConfig(input),
    'sto-browser-automation': buildStoBrowserAutomationPluginConfig(input),
  };
}
