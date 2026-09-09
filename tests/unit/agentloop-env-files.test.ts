import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..');

function readEnvFileValue(fileName: string, key: string): string | undefined {
  const content = readFileSync(join(repoRoot, fileName), 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    if (line.slice(0, eq).trim() === key) {
      return line.slice(eq + 1).trim();
    }
  }
  return undefined;
}

describe('AgentLoop 环境文件应用名配置（task 1.1）', () => {
  it.each([
    '.env.development',
    '.env.test',
    '.env.staging',
    '.env.production',
  ])('%s 显式配置 AgentLoop 应用名', (fileName) => {
    expect(readEnvFileValue(fileName, 'ARMS_APP_NAME')).toBeTruthy();
  });

  it('四个 mode 文件共用相同的 AgentLoop 接入参数与运行策略', () => {
    const fileNames = ['.env.development', '.env.test', '.env.staging', '.env.production'];
    const sharedKeys = [
      'ARMS_LICENSE_KEY',
      'ARMS_REGION_ID',
      'ARMS_WORKSPACE',
      'ARMS_ENABLE_CONSOLE_EXPORTER',
      'OTEL_LOG_LEVEL',
      'OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT',
    ];
    const expected = Object.fromEntries(
      sharedKeys.map((key) => [key, readEnvFileValue(fileNames[0], key)]),
    );

    expect(expected.ARMS_LICENSE_KEY).toBeTruthy();
    expect(expected.ARMS_LICENSE_KEY).not.toBe('auto');
    expect(expected.ARMS_REGION_ID).toBe('cn-shanghai');
    expect(expected.ARMS_WORKSPACE).toBeTruthy();
    expect(expected.ARMS_ENABLE_CONSOLE_EXPORTER).toBe('true');
    expect(expected.OTEL_LOG_LEVEL).toBe('debug');
    expect(expected.OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT).toBe('true');

    for (const fileName of fileNames.slice(1)) {
      for (const key of sharedKeys) {
        expect(readEnvFileValue(fileName, key)).toBe(expected[key]);
      }
    }
  });
});
