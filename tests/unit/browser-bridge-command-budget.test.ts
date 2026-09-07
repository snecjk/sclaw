// @vitest-environment node
/**
 * 步 1（D）：超时预算契约。
 *
 * 语义是"按动作的预算生效，config 的 commandTimeoutMs 只是天花板"。
 * 之前是 `cfg.commandTimeoutMs ?? 按动作预算`，注入的 30s 盖过 snapshot 的 45s，
 * 慢页面上快照必然假超时；而所有预算又必须严格小于流关闭窗口，否则模型看到的
 * 是"流断了"而不是"工具超时了"——前者没有可归因的错误。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_TIMEOUT_CEILING_MS,
  STREAM_CLOSE_TIMEOUT_MS,
  resolveCommandTimeoutMs,
} from '../../shared/browser-bridge/command-budget';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../..');

function read(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('resolveCommandTimeoutMs', () => {
  it('按动作给预算', () => {
    expect(resolveCommandTimeoutMs('snapshot')).toBe(45_000);
    expect(resolveCommandTimeoutMs('read_page')).toBe(45_000);
    expect(resolveCommandTimeoutMs('screenshot')).toBe(45_000);
    expect(resolveCommandTimeoutMs('click')).toBe(25_000);
  });

  it('config 值只当天花板：能压低，不能抬高', () => {
    expect(resolveCommandTimeoutMs('snapshot', 10_000)).toBe(10_000);
    expect(resolveCommandTimeoutMs('click', 120_000)).toBe(25_000);
  });

  it('无效值退回硬上限而不是 0 或 NaN', () => {
    expect(resolveCommandTimeoutMs('click', 0)).toBe(25_000);
    expect(resolveCommandTimeoutMs('click', Number.NaN)).toBe(25_000);
    expect(resolveCommandTimeoutMs('click', -1)).toBe(25_000);
  });

  it('硬上限严格小于流关闭窗口', () => {
    expect(COMMAND_TIMEOUT_CEILING_MS).toBeLessThan(STREAM_CLOSE_TIMEOUT_MS);
    expect(resolveCommandTimeoutMs('snapshot', Number.MAX_SAFE_INTEGER))
      .toBeLessThanOrEqual(COMMAND_TIMEOUT_CEILING_MS);
  });

  it('与 claude-sdk-runtime 注入的 CLAUDE_CODE_STREAM_CLOSE_TIMEOUT 对齐', () => {
    const runtime = read('electron/engines/claude-sdk-runtime.ts');
    const match = /CLAUDE_CODE_STREAM_CLOSE_TIMEOUT[^\n]*?'(\d+)'/.exec(runtime);
    expect(match, 'claude-sdk-runtime.ts 未注入 CLAUDE_CODE_STREAM_CLOSE_TIMEOUT').toBeTruthy();
    expect(Number(match![1])).toBe(STREAM_CLOSE_TIMEOUT_MS);
  });
});

describe('手抄副本不漂移', () => {
  // openclaw 插件是 vendored 的（零 import，函数全部内联），只能靠测试守住。
  const VENDORED = [
    'sto-plugin/openclaw/sto-browser-bridge/bridge-client.ts',
    'sto-plugin/openclaw/sto-browser-automation/bridge-client.ts',
  ];

  it('两份 vendored 副本的预算实现逐字节一致', () => {
    const bodies = VENDORED.map((path) => {
      const source = read(path);
      const start = source.indexOf('const COMMAND_TIMEOUT_CEILING_MS');
      const end = source.indexOf('}', source.indexOf('function resolveCommandTimeoutMs'));
      expect(start, `${path} 缺少内联预算实现`).toBeGreaterThan(-1);
      return source.slice(start, source.indexOf('}', end + 1) + 1);
    });
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('vendored 副本的常量与 shared 一致', () => {
    for (const path of VENDORED) {
      const source = read(path);
      expect(source).toContain(`const COMMAND_TIMEOUT_CEILING_MS = ${COMMAND_TIMEOUT_CEILING_MS / 1000}_000;`);
      expect(source).toContain('read_page: 45_000');
      expect(source).toContain('const DEFAULT_ACTION_BUDGET_MS = 25_000;');
    }
  });

  it('没有任何客户端还在用 `cfg.commandTimeoutMs ??` 直接兜底', () => {
    const clients = [
      ...VENDORED,
    ];
    for (const path of clients) {
      expect(read(path)).not.toMatch(/cfg\.commandTimeoutMs\s*\n?\s*\?\?/);
    }
  });
});
