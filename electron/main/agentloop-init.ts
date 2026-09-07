/**
 * AgentLoop / ARMS 主进程统一初始化。
 *
 * 职责：
 * - 从构建期注入的 define（应用名 / Region / Workspace / 可选开关）与
 *   agentloop.config.json（License，未进 define）解析运行时配置；
 * - 校验固定应用名映射，防止环境串流；
 * - 通过 CommonJS require() 注册 @loongsuite/cms_node_sdk/register 探针；
 * - 进程内幂等（只注册一次）；所有日志脱敏，不输出 License 或完整配置值。
 *
 * 该模块在 Electron 主进程引导入口（index.ts）中最先执行，
 * 保证探针注册早于 Claude Agent SDK 的首次运行时加载。
 * 任何配置缺失或探针异常均 fail-open：记录脱敏告警并返回，不抛出。
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export type AgentLoopAppEnv = 'development' | 'test' | 'staging' | 'production';

export const AGENTLOOP_EXPECTED_APP_NAMES: Readonly<Record<AgentLoopAppEnv, string>> = {
  development: 'sto-claw-development',
  test: 'sto-claw-test',
  staging: 'sto-claw-staging',
  production: 'sto-claw-production',
};

export interface AgentLoopInitResult {
  initialized: boolean;
  /** skip / registered / already-initialized / failed */
  status: 'skip' | 'registered' | 'already-initialized' | 'failed';
  reason?: string;
}

export interface AgentLoopInitDeps {
  /** 读取 agentloop.config.json（License）。默认从 dist-electron/main 目录读取。 */
  readSecretsFile?: (path: string) => string | null;
  /** 注入探针模块加载器（测试替身）。默认 require('@loongsuite/cms_node_sdk/register')。 */
  loadProbe?: () => unknown;
  /** 当前 __dirname（dist-electron/main）。 */
  mainDir?: string;
  /** 环境变量来源（默认 process.env）。测试注入隔离的 env 以避免污染。 */
  env?: Record<string, string | undefined>;
  log?: (level: 'info' | 'warn', message: string) => void;
}

// 进程内幂等状态
let initialized = false;
let initResult: AgentLoopInitResult | null = null;

function defaultLog(level: 'info' | 'warn', message: string): void {
  // 仅输出脱敏后的固定文案，绝不包含配置值。
  if (level === 'warn') {
    console.warn(message);
  } else {
    console.info(message);
  }
}

function readSecretsFileDefault(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function loadProbeDefault(): unknown {
  // 用 createRequire 显式以 CJS 方式加载探针 register，使其能在运行时
  // 通过 import-in-the-middle 钩住后续 claude-agent-sdk 的 require/import。
  // 该模块在 Rollup external 列表中，bundler 不会内联它。
  const nodeRequire = createRequire(__filename);
  return nodeRequire('@loongsuite/cms_node_sdk/register');
}

/** 从注入的 env（或 process.env）读取非敏感字段（去空白）。 */
function readNonSecret(env: Record<string, string | undefined>, key: string): string {
  return (env[key] || '').trim();
}

// ─── 构建期 define 注入点 ───────────────────────────────────────────
// 以下字面量 process.env.* 访问会被 Vite define 静态替换为当前 mode 的配置值
// （见 scripts/agentloop-env.ts toAgentLoopProcessEnvDefine），打包应用运行时
// 不再依赖 .env 文件或外部环境变量。未执行替换时（vitest / 直接 node 运行），
// 读取真实进程环境（development 由 vite.config.ts onstart 注入，取值一致）。
const DEFINED_APP_NAME = (process.env.ARMS_APP_NAME || '').trim();
const DEFINED_REGION_ID = (process.env.ARMS_REGION_ID || '').trim();
const DEFINED_WORKSPACE = (process.env.ARMS_WORKSPACE || '').trim();
// 可选运行策略：仅在当前环境显式配置时才有 define 注入值（未配置则无 define 条目，
// 此处回退为真实环境读取或空串），绝不在此处设置跨环境默认开启值。
const DEFINED_CONSOLE_EXPORTER = (process.env.ARMS_ENABLE_CONSOLE_EXPORTER || '').trim();
const DEFINED_OTEL_LOG_LEVEL = (process.env.OTEL_LOG_LEVEL || '').trim();
const DEFINED_GENAI_EMIT_EVENT = (process.env.OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT || '').trim();

/** 可被构建期 define 注入的非敏感字段。 */
type AgentLoopNonSecretKey =
  | 'ARMS_APP_NAME'
  | 'ARMS_REGION_ID'
  | 'ARMS_WORKSPACE'
  | 'ARMS_ENABLE_CONSOLE_EXPORTER'
  | 'OTEL_LOG_LEVEL'
  | 'OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT';

/**
 * 读取构建期注入的非敏感字段。
 * 显式注入的 env（测试替身 / dev onstart 环境）优先；仅当 env 就是 process.env
 * （真实运行时）时才回退到构建期 define 值，保证测试注入的隔离 env 不被真实
 * 进程环境污染。
 */
function readBuildTimeNonSecret(
  env: Record<string, string | undefined>,
  key: AgentLoopNonSecretKey,
  definedValue: string,
): string {
  return readNonSecret(env, key) || (env === process.env ? definedValue : '');
}

function resolveAppEnv(appName: string): AgentLoopAppEnv | null {
  for (const [env, name] of Object.entries(AGENTLOOP_EXPECTED_APP_NAMES)) {
    if (name === appName) return env as AgentLoopAppEnv;
  }
  return null;
}

/**
 * 初始化 AgentLoop 探针。进程内幂等：重复调用直接返回首次结果。
 *
 * 配置来源：
 * - 非敏感（ARMS_APP_NAME / REGION / WORKSPACE / 可选开关）：由 Vite define 静态注入 process.env.*；
 * - License：构建期写入 agentloop.config.json（与主进程 bundle 同目录）。
 */
export function initAgentLoop(deps: AgentLoopInitDeps = {}): AgentLoopInitResult {
  if (initialized && initResult) {
    deps.log?.('info', '[AgentLoop] 探针已初始化，跳过重复注册。');
    return { ...initResult, status: 'already-initialized' };
  }

  const log = deps.log ?? defaultLog;
  const mainDir = deps.mainDir ?? __dirname;
  const readSecrets = deps.readSecretsFile ?? readSecretsFileDefault;
  const loadProbe = deps.loadProbe ?? loadProbeDefault;
  const env = deps.env ?? process.env;

  const result = doInit({ log, mainDir, readSecrets, loadProbe, env });
  initialized = true;
  initResult = result;
  return result;
}

function doInit(ctx: {
  log: (level: 'info' | 'warn', message: string) => void;
  mainDir: string;
  readSecrets: (path: string) => string | null;
  loadProbe: () => unknown;
  env: Record<string, string | undefined>;
}): AgentLoopInitResult {
  const { log, mainDir, readSecrets, loadProbe, env } = ctx;

  try {
    // 1) 应用名：来自 define 固定映射（dev 由 onstart 环境注入，取值一致）。缺失则无法定位应用，跳过初始化。
    const appName = readBuildTimeNonSecret(env, 'ARMS_APP_NAME', DEFINED_APP_NAME);
    if (!appName) {
      log('warn', '[AgentLoop] 未配置 ARMS_APP_NAME（构建期固定映射缺失），跳过探针初始化。');
      return { initialized: false, status: 'skip', reason: 'missing-app-name' };
    }

    // 2) 固定应用名映射校验：不在已知环境枚举内 = 环境串流，拒绝初始化。
    const appEnv = resolveAppEnv(appName);
    if (!appEnv) {
      log('warn', `[AgentLoop] 应用名不属于固定映射（development/test/staging/production），疑似环境串流，跳过探针初始化。`);
      return { initialized: false, status: 'skip', reason: 'app-name-mismatch' };
    }

    // 3) License：来自 agentloop.config.json（敏感，不进 define）。
    const secretsRaw = readSecrets(join(mainDir, 'agentloop.config.json'));
    let licenseKey = '';
    if (secretsRaw) {
      try {
        const parsed = JSON.parse(secretsRaw) as { licenseKey?: string };
        licenseKey = (parsed.licenseKey || '').trim();
      } catch {
        log('warn', '[AgentLoop] agentloop.config.json 解析失败，跳过探针初始化。');
        return { initialized: false, status: 'skip', reason: 'secrets-parse-error' };
      }
    }
    if (!licenseKey) {
      log('warn', '[AgentLoop] 缺少有效 License（agentloop.config.json），跳过探针初始化。');
      return { initialized: false, status: 'skip', reason: 'missing-license' };
    }
    if (licenseKey === 'auto') {
      log('warn', '[AgentLoop] License 为占位值 auto（无效），跳过探针初始化。');
      return { initialized: false, status: 'skip', reason: 'license-auto' };
    }

    // 4) 注入运行时环境变量，供 cms_node_sdk register 读取。
    //    应用名与 License 始终来自可信源（define 固定映射 + secrets 文件），写入 process.env；
    //    可选非敏感字段仅当当前环境显式提供时才透传（不默认开启调试项）。
    const targetEnv = env === process.env ? process.env : env;
    targetEnv.ARMS_APP_NAME = appName;
    targetEnv.ARMS_LICENSE_KEY = licenseKey;
    const regionId = readBuildTimeNonSecret(env, 'ARMS_REGION_ID', DEFINED_REGION_ID);
    if (regionId) targetEnv.ARMS_REGION_ID = regionId;
    const workspace = readBuildTimeNonSecret(env, 'ARMS_WORKSPACE', DEFINED_WORKSPACE);
    if (workspace) targetEnv.ARMS_WORKSPACE = workspace;

    // 可选运行策略（task 3.1）：仅当当前环境显式配置时透传，未配置则不写入
    // 任何默认值——production 未配置时不会自动启用 Console exporter、调试日志
    // 或会话内容事件上报。
    const consoleExporter = readBuildTimeNonSecret(env, 'ARMS_ENABLE_CONSOLE_EXPORTER', DEFINED_CONSOLE_EXPORTER);
    if (consoleExporter) targetEnv.ARMS_ENABLE_CONSOLE_EXPORTER = consoleExporter;
    const otelLogLevel = readBuildTimeNonSecret(env, 'OTEL_LOG_LEVEL', DEFINED_OTEL_LOG_LEVEL);
    if (otelLogLevel) targetEnv.OTEL_LOG_LEVEL = otelLogLevel;
    const genaiEmitEvent = readBuildTimeNonSecret(env, 'OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT', DEFINED_GENAI_EMIT_EVENT);
    if (genaiEmitEvent) targetEnv.OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT = genaiEmitEvent;

    // 5) 注册探针（同步 require，保证在 Claude SDK 首次加载前完成）。
    loadProbe();
    log('info', `[AgentLoop] 探针已注册（应用环境=${appEnv}）。`);
    return { initialized: true, status: 'registered' };
  } catch (error) {
    // fail-open：探针加载或初始化异常不阻断主进程。
    const message = error instanceof Error ? error.message : String(error);
    log('warn', `[AgentLoop] 探针注册失败，已降级继续启动：${message}`);
    return { initialized: false, status: 'failed', reason: 'probe-load-error' };
  }
}

/** 测试辅助：重置进程内幂等状态。 */
export function __resetAgentLoopForTest(): void {
  initialized = false;
  initResult = null;
}

// ─── 引导编排（任务 2.2）─────────────────────────────────────────
// 探针注册与业务入口加载拆成两个可注入的步骤，由引导入口 index.ts 顺序编排。
// 拆分的意义：顺序可由单元测试通过依赖注入验证，且不依赖 ESM 静态导入提升排序。

/**
 * 第一步：注册 CMS 探针（幂等）。必须在加载业务入口之前调用。
 * 返回是否注册成功（fail-open 时返回 false，但仍应继续加载业务入口）。
 */
export function registerAgentLoopProbe(deps: AgentLoopInitDeps = {}): AgentLoopInitResult {
  return initAgentLoop(deps);
}

/**
 * 第二步：加载业务入口（现有 electron/main/main.ts）。
 *
 * 用动态 import('./main')：Rollup 会识别为代码分割点并发出独立 main chunk，
 * 同时保证业务入口的模块顶层副作用在本调用（即探针注册）之后才求值。
 * 单独抽出以便测试注入替身。
 */
export function loadMainModule(loader?: () => Promise<unknown>): Promise<unknown> {
  if (loader) return loader();
  return import('./main');
}

/**
 * 引导编排：先同步注册探针，再异步加载业务入口。
 * 顺序由本函数体强制：registerAgentLoopProbe 同步完成后才 import('./main')。
 * 探针 fail-open（内部已捕获降级），因此不阻断业务入口加载；
 * 业务入口自身加载失败属致命错误，进程将异常退出（与既有行为一致）。
 */
export async function bootstrap(
  deps: AgentLoopInitDeps & { loader?: () => Promise<unknown> } = {},
): Promise<void> {
  const { loader, ...initDeps } = deps;
  registerAgentLoopProbe(initDeps);
  await loadMainModule(loader);
}
