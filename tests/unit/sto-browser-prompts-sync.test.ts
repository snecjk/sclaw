// @vitest-environment node
/**
 * 全程 · T9 提示词/注册表同步（计划 §六 R9 / §七 sto-browser-prompts-sync.test.ts）：
 * BA_SYSTEM_PROMPT 是 before_prompt_build 注入的静态字符串，与 registerTool 的
 * TypeBox schema 需手工对齐——本测试断言"提示词提及的 ba_* 工具名 ⊆ 注册表"，
 * 并反向断言注册表内工具均在提示词中有分工说明（防双向漂移）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BA_SYSTEM_PROMPT } from '../../sto-plugin/openclaw/sto-browser-automation/prompts';
import {
  BRIDGE_SYSTEM_PROMPT as OPENCLAW_BRIDGE_PROMPT,
  WEB_BRIDGE_ORDINARY_CHAT_PROMPT as OPENCLAW_WEB_BRIDGE_PROMPT,
} from '../../sto-plugin/openclaw/sto-browser-bridge/prompts';
import {
  BRIDGE_SYSTEM_PROMPT as SHARED_BRIDGE_PROMPT,
  WEB_BRIDGE_ORDINARY_CHAT_PROMPT as SHARED_WEB_BRIDGE_PROMPT,
} from '../../shared/browser-bridge/prompts';
import { WEB_BRIDGE_ORDINARY_CHAT_ENABLED } from '../../shared/browser-bridge/ship-gate';

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_INDEX = resolve(here, '../../sto-plugin/openclaw/sto-browser-automation/index.ts');

function registeredToolIds(): Set<string> {
  const source = readFileSync(PLUGIN_INDEX, 'utf8');
  return new Set(
    Array.from(source.matchAll(/id:\s*"(ba_[a-z_]+)"/g)).map((match) => match[1]),
  );
}

function mentionedToolIds(): Set<string> {
  return new Set(
    Array.from(BA_SYSTEM_PROMPT.matchAll(/ba_[a-z_]+/g)).map((match) => match[0]),
  );
}

describe('T9 BA_SYSTEM_PROMPT ↔ 工具注册表同步', () => {
  it('提示词提及的 ba_* 工具名 ⊆ 注册表', () => {
    const registered = registeredToolIds();
    expect(registered.size).toBeGreaterThan(0);
    for (const mentioned of mentionedToolIds()) {
      expect(registered.has(mentioned), `提示词提及的 ${mentioned} 未注册`).toBe(true);
    }
  });

  it('注册表内的 ba_* 工具均在提示词中有分工说明（反向防漂移）', () => {
    const mentioned = mentionedToolIds();
    for (const id of registeredToolIds()) {
      expect(mentioned.has(id), `已注册的 ${id} 未在 BA_SYSTEM_PROMPT 中说明`).toBe(true);
    }
  });

  it('波次 2 产物/检索工具已注册：ba_find / ba_read_page / ba_screenshot / ba_print_pdf / ba_network_capture / ba_cdp', () => {
    const registered = registeredToolIds();
    expect(registered.has('ba_find')).toBe(true);
    expect(registered.has('ba_read_page')).toBe(true);
    expect(registered.has('ba_screenshot')).toBe(true);
    expect(registered.has('ba_print_pdf')).toBe(true);
    expect(registered.has('ba_network_capture')).toBe(true);
    expect(registered.has('ba_cdp')).toBe(true);
  });

  it('提示词包含代际/stale 语义（STALE_REF 后必须重新 ba_observe）', () => {
    expect(BA_SYSTEM_PROMPT).toContain('STALE_REF');
    expect(BA_SYSTEM_PROMPT).toContain('documentGeneration');
  });
});

describe('T9 BRIDGE_SYSTEM_PROMPT 单源', () => {
  it('OpenClaw 插件提示词与 shared 逐字相等', () => {
    expect(OPENCLAW_BRIDGE_PROMPT).toBe(SHARED_BRIDGE_PROMPT);
    expect(OPENCLAW_WEB_BRIDGE_PROMPT).toBe(SHARED_WEB_BRIDGE_PROMPT);
  });

  it('上线提示不把主聊天路由到未完成的 Web Bridge', () => {
    expect(WEB_BRIDGE_ORDINARY_CHAT_ENABLED).toBe(false);
    expect(SHARED_BRIDGE_PROMPT).not.toContain('SClaw Web Bridge');
    expect(BA_SYSTEM_PROMPT).not.toContain('本机 Chrome Bridge');
  });

  // TODO(web-bridge): 恢复 BRIDGE_SYSTEM_PROMPT = WEB_BRIDGE_ORDINARY_CHAT_PROMPT 后改回启用。
  it('Web Bridge 待启用提示词仍限制 list_sessions 空转并声明 SESSION_STALE 自愈', () => {
    expect(SHARED_WEB_BRIDGE_PROMPT).toContain('SESSION_STALE');
    expect(SHARED_WEB_BRIDGE_PROMPT).toContain('禁止再 list_sessions');
  });

  it('提示词提及的 bridge_* 工具名 ⊆ OpenClaw 注册表', () => {
    const index = readFileSync(resolve(here, '../../sto-plugin/openclaw/sto-browser-bridge/index.ts'), 'utf8');
    const registered = new Set(Array.from(index.matchAll(/id:\s*"(bridge_[a-z_]+)"/g)).map((match) => match[1]));
    const mentioned = new Set(Array.from(SHARED_BRIDGE_PROMPT.matchAll(/bridge_[a-z_]+/g)).map((match) => match[0]));
    for (const id of mentioned) {
      expect(registered.has(id), `提示词提及的 ${id} 未注册`).toBe(true);
    }
  });
});
