import { describe, expect, it } from 'vitest';
import { BROWSER_NODE_TEMPLATES } from '../../src/pages/WorkflowDesigner/constants';
import { defaultNodeConfig } from '../../src/pages/WorkflowDesigner/utils';

describe('workflow designer browser nodes', () => {
  it('registers browser node templates in designer catalog', () => {
    expect(BROWSER_NODE_TEMPLATES.map((template) => template.type)).toEqual([
      'browser_task',
      'browser_validate',
      'browser_human_gate',
    ]);
  });

  it('creates default config for browser_task', () => {
    const config = defaultNodeConfig('browser_task', 0);
    expect(config.goal).toBeTruthy();
    expect(config.maxSteps).toBe(20);
  });

  it('creates default config for browser_validate', () => {
    const config = defaultNodeConfig('browser_validate', 0);
    expect(config.onFail).toBe('fail');
    expect(Array.isArray(config.validators)).toBe(true);
  });

  it('creates default config for browser_human_gate', () => {
    const config = defaultNodeConfig('browser_human_gate', 0);
    expect(config.reason).toBeTruthy();
    expect(config.sessionFrom).toBe('browser');
  });
});
