/**
 * AgentLoop / ARMS 多环境构建期配置解析。
 *
 * 职责：
 * - 按 Vite mode 读取 .env.<mode> 中声明的应用名，不在代码中维护重复映射；
 * - 区分敏感字段（License）与非敏感字段：非敏感字段通过 Vite define 注入主进程 bundle，
 *   License 只写入 dist-electron/main/agentloop.config.json，不参与代码生成与日志输出；
 * - 保持优先级：真实进程环境变量（CI 密钥） > Vite loadEnv 结果（.env.<mode>.local > .env.<mode>）。
 *
 * 该模块被 vite.config.ts 与 vitest 单测共同使用，保持无 Vite 运行时依赖。
 */

export type AgentLoopMode = 'development' | 'test' | 'staging' | 'production';

/** 注入 dist-electron/main/agentloop.config.json 的敏感配置（不进入 Vite define）。 */
export interface AgentLoopSecretsConfig {
  licenseKey?: string;
}

export interface AgentLoopBuildConfig {
  mode: AgentLoopMode;
  /** 当前 mode 配置文件声明的应用名。 */
  appName: string;
  /** 非敏感字段：写入 Vite define。 */
  define: Record<string, string>;
  /** 敏感字段：写入 agentloop.config.json；缺省时对应键缺省。 */
  secrets: AgentLoopSecretsConfig;
  /** 脱敏诊断信息（不含任何配置值），供构建日志输出。 */
  warnings: string[];
}

type EnvSource = Record<string, string | undefined>;

function readEnv(loadedEnv: EnvSource, processEnv: EnvSource, key: string): string {
  // loadEnv 已按 .env.<mode>.local > .env.<mode> 合并；真实进程环境（CI 密钥）优先级最高。
  return (processEnv[key] || loadedEnv[key] || '').trim();
}

function parseMode(mode: string): AgentLoopMode {
  if (mode === 'development' || mode === 'test' || mode === 'staging' || mode === 'production') {
    return mode;
  }
  // vite build 未显式指定 --mode 时按 production 处理，与现有 VITE_APP_ENV 回退逻辑一致。
  return 'production';
}

/**
 * 解析当前 mode 的 AgentLoop 构建配置。
 *
 * @param mode       Vite mode（development/test/staging/production）
 * @param loadedEnv  Vite loadEnv(mode, cwd, '') 的结果（已合并 .env.<mode>.local）
 * @param processEnv 真实进程环境变量（CI 密钥注入处）
 */
export function resolveAgentLoopBuildConfig(
  mode: string,
  loadedEnv: EnvSource,
  processEnv: EnvSource,
): AgentLoopBuildConfig {
  const resolvedMode = parseMode(mode);
  const warnings: string[] = [];

  const configuredAppName = readEnv(loadedEnv, processEnv, 'ARMS_APP_NAME');
  if (!configuredAppName) {
    warnings.push(`[ARMS] mode=${resolvedMode} 未配置 ARMS_APP_NAME，探针将在运行时跳过初始化（fail-open）。`);
  }

  // ARMS_LICENSE_KEY 为标准字段；ARMS_LICENSE 仅作历史兼容回退。
  const licenseKey =
    readEnv(loadedEnv, processEnv, 'ARMS_LICENSE_KEY') || readEnv(loadedEnv, processEnv, 'ARMS_LICENSE');
  if (licenseKey === 'auto') {
    warnings.push('[ARMS] ARMS_LICENSE_KEY=auto 对 @loongsuite/cms_node_sdk 无效，已从 AgentLoop 接入中心获取真实 License。');
  }

  const regionId = readEnv(loadedEnv, processEnv, 'ARMS_REGION_ID');
  const workspace = readEnv(loadedEnv, processEnv, 'ARMS_WORKSPACE');

  const define: Record<string, string> = {};
  if (configuredAppName) define.ARMS_APP_NAME = configuredAppName;
  if (regionId) define.ARMS_REGION_ID = regionId;
  if (workspace) define.ARMS_WORKSPACE = workspace;

  // 可选运行策略：仅透传当前环境显式配置的值，不设置跨环境默认开启项。
  const consoleExporter = readEnv(loadedEnv, processEnv, 'ARMS_ENABLE_CONSOLE_EXPORTER');
  if (consoleExporter) define.ARMS_ENABLE_CONSOLE_EXPORTER = consoleExporter;
  const otelLogLevel = readEnv(loadedEnv, processEnv, 'OTEL_LOG_LEVEL');
  if (otelLogLevel) define.OTEL_LOG_LEVEL = otelLogLevel;
  const genaiEmitEvent = readEnv(loadedEnv, processEnv, 'OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT');
  if (genaiEmitEvent) define.OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT = genaiEmitEvent;

  const secrets: AgentLoopSecretsConfig = {};
  if (licenseKey && licenseKey !== 'auto') secrets.licenseKey = licenseKey;

  if (!secrets.licenseKey) {
    warnings.push(
      `[ARMS] mode=${resolvedMode} 未提供有效 License，探针将在运行时跳过初始化（fail-open）。`
        + '本地请写入 .env.<mode>.local，CI 请通过密钥变量注入。',
    );
  }

  return { mode: resolvedMode, appName: configuredAppName, define, secrets, warnings };
}

/** 将 define 记录转为 Vite 的 process.env.* 注入形式（值已 JSON 序列化）。 */
export function toAgentLoopProcessEnvDefine(config: AgentLoopBuildConfig): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.define)) {
    result[`process.env.${key}`] = JSON.stringify(value);
  }
  return result;
}

/**
 * Make non-secret AgentLoop settings available to Electron processes spawned
 * during Vite development. vite-plugin-electron may start from either the main
 * or preload watcher, so relying only on one onstart callback's env is racy.
 * License credentials are intentionally excluded because they live in
 * agentloop.config.json.
 */
export function applyAgentLoopRuntimeEnv(
  config: AgentLoopBuildConfig,
  targetEnv: EnvSource,
): void {
  for (const [key, value] of Object.entries(config.define)) {
    targetEnv[key] = value;
  }
}

/** License 写入安装包前的脱敏序列化：绝不允许把 secrets 打进 Vite define 或构建日志。 */
export function serializeAgentLoopSecrets(secrets: AgentLoopSecretsConfig): string {
  return JSON.stringify(secrets, null, 2);
}
