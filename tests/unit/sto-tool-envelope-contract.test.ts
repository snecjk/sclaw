// @vitest-environment node
/**
 * 根 2 护栏：错误契约在每一跳都必须同形。
 *
 * OpenClaw 插件被拷进 ~/.stoclaw/openclaw/extensions 后无法 import 仓内 shared，
 * 因此 tool-envelope.ts / define-sto-tool.ts 在每个插件目录各有一份手抄件。
 * 曾经出现 sto-user-skill-tool 那份漏掉 isError —— 同一个失败在不同插件里
 * 一个是 isError:true、一个被包成 success:true。这里逐字节钉住。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  envelopeFromExecuteResult,
  toolResultFromEnvelope,
} from '../../sto-plugin/sto-toolkit/envelope';

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(here, '../../sto-plugin/openclaw');

const VENDORED_PLUGINS = [
  'sto-browser-bridge',
  'sto-browser-automation',
  'sto-user-skill-tool',
] as const;

function readVendored(pluginId: string, file: string): string {
  return readFileSync(resolve(PLUGIN_ROOT, pluginId, file), 'utf8');
}

describe('OpenClaw 插件手抄件逐字节一致', () => {
  it.each(['tool-envelope.ts', 'define-sto-tool.ts'])('%s 三份副本相同', (file) => {
    const [reference, ...others] = VENDORED_PLUGINS.map((id) => readVendored(id, file));
    for (const [index, content] of others.entries()) {
      expect(content, `${VENDORED_PLUGINS[index + 1]}/${file} 与 sto-browser-bridge 版本漂移`)
        .toBe(reference);
    }
  });

  it.each(VENDORED_PLUGINS)('%s 的信封把 success:false 标成 isError', (pluginId) => {
    const source = readVendored(pluginId, 'tool-envelope.ts');
    expect(source).toContain('isError: envelope.success === false');
    expect(source).toContain('envelopeFromExecuteResult');
    expect(readVendored(pluginId, 'define-sto-tool.ts')).toContain('envelopeFromExecuteResult');
  });
});

describe('envelopeFromExecuteResult', () => {
  it('把 success:false 的返回降级为失败信封并带上 isError', () => {
    const envelope = envelopeFromExecuteResult('browser_bridge_click', 'browser-bridge', {
      success: false,
      error: 'SESSION_STALE',
    });
    expect(envelope.success).toBe(false);
    expect(envelope.message).toBe('SESSION_STALE');
    expect(envelope.error?.message).toBe('SESSION_STALE');
    expect(toolResultFromEnvelope(envelope).isError).toBe(true);
  });

  it('没有 error 字段时退回 message，再退回兜底文案', () => {
    expect(envelopeFromExecuteResult('t', 'd', { success: false, message: '页面已关闭' }).message)
      .toBe('页面已关闭');
    expect(envelopeFromExecuteResult('t', 'd', { success: false }).message)
      .toBe('tool returned success:false');
  });

  it('成功返回保持 success:true 且不带 isError', () => {
    const envelope = envelopeFromExecuteResult('t', 'd', { success: true, url: 'https://a' });
    expect(envelope.success).toBe(true);
    expect(toolResultFromEnvelope(envelope).isError).toBe(false);
  });

  it('不把普通对象/数组误判为失败', () => {
    expect(envelopeFromExecuteResult('t', 'd', { elements: [] }).success).toBe(true);
    expect(envelopeFromExecuteResult('t', 'd', [1, 2, 3]).success).toBe(true);
    expect(envelopeFromExecuteResult('t', 'd', null).success).toBe(true);
  });
});
