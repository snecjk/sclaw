// @vitest-environment node
/**
 * ax-observer.ts 与扩展 background.js 三张 role 表必须逐字一致（手抄维护）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AX_CLICKABLE_ROLES,
  AX_EDITABLE_ROLES,
  AX_INTERACTIVE_ROLES,
} from '../../electron/services/browser-automation/ax-observer';
import { STALE_REF_RETRY_HINT } from '../../shared/browser-bridge/page-observation';

const here = dirname(fileURLToPath(import.meta.url));
const background = readFileSync(resolve(here, '../../browser-extension/background.js'), 'utf8');

function parseJsRoleTable(source: string, name: string): string[] {
  const match = source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`));
  expect(match, `background.js 缺少 ${name}`).toBeTruthy();
  return Array.from(match![1].matchAll(/([a-z]+): true/g)).map((item) => item[1]).sort();
}

describe('AX role 表两侧同步', () => {
  it('INTERACTIVE / CLICKABLE / EDITABLE 与 background.js 逐字一致', () => {
    expect(parseJsRoleTable(background, 'AX_INTERACTIVE_ROLES')).toEqual([...AX_INTERACTIVE_ROLES].sort());
    expect(parseJsRoleTable(background, 'AX_CLICKABLE_ROLES')).toEqual([...AX_CLICKABLE_ROLES].sort());
    expect(parseJsRoleTable(background, 'AX_EDITABLE_ROLES')).toEqual([...AX_EDITABLE_ROLES].sort());
  });

  it('扩展消费 AX editable 属性并在失败时附最新观测', () => {
    expect(background).toContain('function axEditableKind');
    expect(background).toContain('editableKind');
    expect(background).toContain('function failWithFreshObservation');
    expect(background).toContain(STALE_REF_RETRY_HINT);
  });
});
