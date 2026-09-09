import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 探针 fail-open 集成验证（task 3.2）。
 *
 * 把真实构建产物（dist-electron/main/index.js + 业务入口 chunk + agentloop.config.json）
 * 复制到无法解析 @loongsuite/cms_node_sdk 的隔离临时目录，用纯 node 运行：
 *
 * - 探针因「缺失模块」注册失败时必须 fail-open：输出脱敏告警且不抛出；
 * - 引导流程必须继续尝试加载业务入口（SClaw 主进程继续启动的证据；
 *   业务入口自身在纯 node 下因缺少 electron 失败属预期，与探针无关）；
 * - 全程输出不得包含 License 值（脱敏要求）。
 *
 * 依赖 dist-electron 构建产物；产物缺失时跳过（未构建主进程的 CI 环境不会误失败）。
 */

const BUNDLE_DIR = resolve(__dirname, '../../dist-electron/main');
const BOOTSTRAP = join(BUNDLE_DIR, 'index.js');

function runNode(
  entry: string,
  env: NodeJS.ProcessEnv,
): { status: number | null; output: string } {
  try {
    const stdout = execFileSync('node', [entry], {
      env,
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status?: number | null; stdout?: string; stderr?: string };
    return { status: e.status ?? null, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}` };
  }
}

/** 构造剔除 AgentLoop 相关变量的干净环境（模拟无 ARMS 配置的运行时）。 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ARMS_') || key.startsWith('OTEL_')) delete env[key];
  }
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

describe('探针 fail-open（真实缺失模块，task 3.2）', () => {
  it.skipIf(!existsSync(BOOTSTRAP))(
    '探针模块缺失时降级告警并继续加载业务入口，输出不含 License',
    () => {
      const workDir = mkdtempSync(join(tmpdir(), 'agentloop-failopen-'));
      try {
        // 复制引导入口与其引用的业务入口 chunk 到隔离目录（无 node_modules 祖先）。
        const bootstrapSrc = readFileSync(BOOTSTRAP, 'utf8');
        const chunkMatch = bootstrapSrc.match(/require\("\.\/(main-[^"]+\.js)"\)/);
        expect(chunkMatch, '引导入口应以懒加载方式引用业务入口 chunk').toBeTruthy();
        const mainChunk = chunkMatch![1];

        copyFileSync(BOOTSTRAP, join(workDir, 'index.js'));
        copyFileSync(join(BUNDLE_DIR, mainChunk), join(workDir, mainChunk));
        const secretsPath = join(BUNDLE_DIR, 'agentloop.config.json');
        let licenseKey = '';
        if (existsSync(secretsPath)) {
          copyFileSync(secretsPath, join(workDir, 'agentloop.config.json'));
          licenseKey = (
            JSON.parse(readFileSync(secretsPath, 'utf8')) as { licenseKey?: string }
          ).licenseKey || '';
        }

        const { output } = runNode(join(workDir, 'index.js'), cleanEnv());

        // 1) 探针缺失模块 → fail-open 脱敏告警（不抛出、不退出）。
        const failOpenMark = '[AgentLoop] 探针注册失败，已降级继续启动';
        expect(output).toContain(failOpenMark);

        // 2) 引导继续：尝试加载业务入口（纯 node 缺少 electron 属预期失败，
        //    该失败发生在探针降级之后，证明主进程启动流程未被探针阻断）。
        const mainEntryMark = '[AgentLoop] 主进程业务入口加载失败';
        expect(output).toContain(mainEntryMark);
        expect(output.indexOf(failOpenMark)).toBeLessThan(output.indexOf(mainEntryMark));

        // 3) 脱敏：任何输出都不得包含 License 值。
        if (licenseKey) {
          expect(output).not.toContain(licenseKey);
        }
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
  );
});
