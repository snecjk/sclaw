// @vitest-environment node
/**
 * 根 3 护栏：注入 openclaw.json 的插件 config 必须与插件自带 configSchema 一致。
 *
 * 所有 STO 插件 schema 都是 additionalProperties:false —— 注入一个未声明的键
 * 会让 OpenClaw 拒绝整份插件配置（曾导致 sto-browser-automation 的 authToken
 * 打不进去、ba_* 全线 401 / gateway 反复重启）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildStoOpenClawPluginConfigs, sanitizeStoBrowserAutomationPluginConfig } from '../../shared/openclaw-plugin-config';

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(here, '../../sto-plugin/openclaw');

function readConfigSchema(pluginId: string): {
  additionalProperties?: boolean;
  properties?: Record<string, unknown>;
} {
  const manifest = JSON.parse(
    readFileSync(resolve(PLUGIN_ROOT, pluginId, 'openclaw.plugin.json'), 'utf8'),
  ) as { configSchema?: { additionalProperties?: boolean; properties?: Record<string, unknown> } };
  return manifest.configSchema ?? {};
}

const injected = buildStoOpenClawPluginConfigs({
  stoBaseUrl: 'https://sto.example',
  hostApiPort: 3210,
  localHostApiBaseUrl: 'http://127.0.0.1:3210',
  authToken: 'token-abc',
});

describe('OpenClaw 插件 config ↔ configSchema 一致性', () => {
  it.each(Object.keys(injected))('%s 注入的键都在 schema 中声明', (pluginId) => {
    const schema = readConfigSchema(pluginId);
    const declared = new Set(Object.keys(schema.properties ?? {}));
    for (const key of Object.keys(injected[pluginId])) {
      expect(
        declared.has(key),
        `${pluginId} 注入了 ${key}，但 openclaw.plugin.json configSchema 未声明`
          + `（additionalProperties=${schema.additionalProperties}）`,
      ).toBe(true);
    }
  });

  it('sto-browser-automation 的 authToken 可以被注入（回归：gateway 拒配置）', () => {
    expect(injected['sto-browser-automation'].authToken).toBe('token-abc');
    expect(Object.keys(readConfigSchema('sto-browser-automation').properties ?? {}))
      .toContain('authToken');
  });

  it('取不到 token 时省略该键，而不是写 undefined', () => {
    const withoutToken = buildStoOpenClawPluginConfigs({
      stoBaseUrl: 'https://sto.example',
      hostApiPort: 3210,
      localHostApiBaseUrl: 'http://127.0.0.1:3210',
      authToken: null,
    });
    expect('authToken' in withoutToken['sto-browser-automation']).toBe(false);
  });

  it('strips undeclared sto-browser-automation keys that would fail Gateway', () => {
    const sanitized = sanitizeStoBrowserAutomationPluginConfig(
      {
        hostApiHost: '127.0.0.1',
        hostApiPort: 3210,
        authToken: 'token-abc',
        extraLegacyKey: true,
        commandTimeoutMs: 45_000,
      },
      { hostApiPort: 3210, authToken: 'token-abc' },
    );
    expect(sanitized).toEqual({
      hostApiHost: '127.0.0.1',
      hostApiPort: 3210,
      commandTimeoutMs: 45_000,
      authToken: 'token-abc',
    });
    expect('extraLegacyKey' in sanitized).toBe(false);
  });
});
