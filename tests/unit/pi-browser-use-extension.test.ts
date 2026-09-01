import { describe, expect, it } from 'vitest';
import { resolvePiBrowserNodeRuntime } from '../../electron/agent-extensions/extensions/pi-browser-use/pi';

describe('Pi browser-use Node runtime selection', () => {
  it('prefers the packaged Windows Node runtime', () => {
    expect(resolvePiBrowserNodeRuntime({
      platform: 'win32',
      arch: 'x64',
      cwd: 'D:\\workspace',
      resourcesPath: 'C:\\Program Files\\SClaw\\resources',
      path: 'D:\\Program Files\\nodejs',
      exists: (path) => path === 'C:\\Program Files\\SClaw\\resources\\bin\\node.exe',
    })).toBe('C:\\Program Files\\SClaw\\resources\\bin\\node.exe');
  });

  it('uses a Node runtime from PATH during development', () => {
    expect(resolvePiBrowserNodeRuntime({
      platform: 'win32',
      arch: 'x64',
      cwd: 'D:\\workspace',
      resourcesPath: 'D:\\workspace\\node_modules\\electron\\dist\\resources',
      path: 'C:\\Windows;D:\\Program Files\\nodejs',
      exists: (path) => path === 'D:\\Program Files\\nodejs\\node.exe',
    })).toBe('D:\\Program Files\\nodejs\\node.exe');
  });

  it('leaves non-Windows platforms on the Electron fallback', () => {
    expect(resolvePiBrowserNodeRuntime({ platform: 'darwin' })).toBeUndefined();
  });
});
