import { describe, expect, it } from 'vitest';
import { configurePiBrowserUseRuntime } from '../../electron/agent-extensions/extensions/pi-browser-use/pi';

describe('Pi browser-use runtime configuration', () => {
  it('uses Electron in Node mode by default', () => {
    const env: NodeJS.ProcessEnv = {};
    const inheritedEnvVars = ['PATH'];

    configurePiBrowserUseRuntime(
      env,
      'C:\\Program Files\\S Claw\\SClaw\\SClaw.exe',
      inheritedEnvVars,
    );

    expect(env.PI_BROWSER_USE_NODE).toBe('C:\\Program Files\\S Claw\\SClaw\\SClaw.exe');
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(inheritedEnvVars).toContain('ELECTRON_RUN_AS_NODE');
  });

  it('preserves an explicitly configured Node runtime', () => {
    const env: NodeJS.ProcessEnv = {
      PI_BROWSER_USE_NODE: 'D:\\Program Files\\nodejs\\node.exe',
    };

    configurePiBrowserUseRuntime(
      env,
      'C:\\Program Files\\S Claw\\SClaw\\SClaw.exe',
    );

    expect(env.PI_BROWSER_USE_NODE).toBe('D:\\Program Files\\nodejs\\node.exe');
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it('does not duplicate the MCP inherited environment entry', () => {
    const env: NodeJS.ProcessEnv = {};
    const inheritedEnvVars = ['PATH', 'ELECTRON_RUN_AS_NODE'];

    configurePiBrowserUseRuntime(env, 'C:\\SClaw.exe', inheritedEnvVars);

    expect(inheritedEnvVars.filter((name) => name === 'ELECTRON_RUN_AS_NODE')).toHaveLength(1);
  });
});
