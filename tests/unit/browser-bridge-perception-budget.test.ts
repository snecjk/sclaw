// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EMBED_SNAPSHOT_MAX_NODES,
  EXTENSION_INTERACTIVE_MAX_NODES,
  PERCEPTION_CHAR_BUDGET,
} from '../../shared/browser-bridge/perception-budget';
import { BROWSER_AUTOMATION_AX_NODE_BUDGET } from '../../shared/browser-automation/types';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

describe('perception budget SSOT', () => {
  it('AX 字符预算与历史常量同值', () => {
    expect(BROWSER_AUTOMATION_AX_NODE_BUDGET).toBe(PERCEPTION_CHAR_BUDGET);
    expect(PERCEPTION_CHAR_BUDGET).toBe(60_000);
  });

  it('embed 注入脚本的节点上限与 SSOT 一致', () => {
    const inject = readFileSync(resolve(root, 'shared/sclaw-embed-bridge-inject.ts'), 'utf8');
    expect(inject).toContain(`var MAX_SNAPSHOT_NODES = ${EMBED_SNAPSHOT_MAX_NODES};`);
  });

  it('扩展 page-agent 与 AX 扁平化的可交互上限与 SSOT 一致', () => {
    const agent = readFileSync(resolve(root, 'browser-extension/page-agent.js'), 'utf8');
    expect(agent).toContain(`var ELEMENT_LIMIT = ${EXTENSION_INTERACTIVE_MAX_NODES};`);
    expect(agent).toContain('truncated');
    const background = readFileSync(resolve(root, 'browser-extension/background.js'), 'utf8');
    expect(background).toContain(`const AX_ELEMENT_LIMIT = ${EXTENSION_INTERACTIVE_MAX_NODES};`);
  });
});
