import { describe, expect, it } from 'vitest';

import {
  classifyTemplateImportPath,
  normalizeImportRelativePath,
} from '../../electron/services/app-template-import-rules';

describe('app template import rules', () => {
  it.each([
    '.git/config',
    '.sclaw/app-template.json',
    'manifest.json',
    'src/sclaw/bootstrap.ts',
    'scripts/external-services.mjs',
    'contracts/external-services.v1.json',
    'contracts/dev-proxy.v1.json',
    'vite.config.ts',
    'vite.config.sclaw.ts',
    'src/components/RuntimeBootstrapShell.tsx',
  ])('永久保护 %s', (path) => {
    expect(classifyTemplateImportPath(path)).toBe('protected');
  });

  it.each([
    '.env',
    '.env.daily',
    'node_modules/a.js',
    'dist/a.js',
    'coverage/a.json',
  ])('忽略 %s', (path) => {
    expect(classifyTemplateImportPath(path)).toBe('ignored');
  });

  it('允许 env 示例和普通业务文件', () => {
    expect(classifyTemplateImportPath('.env.example')).toBe('business');
    expect(classifyTemplateImportPath('src/App.tsx')).toBe('business');
  });

  it.each(['../secret', '/tmp/a', 'src/../../secret', String.raw`C:\secret`])(
    '拒绝越界路径 %s',
    (path) => {
      expect(() => normalizeImportRelativePath(path)).toThrow('非法导入路径');
    },
  );

  it('统一 Windows 分隔符', () => {
    expect(normalizeImportRelativePath(String.raw`src\pages\Home.tsx`)).toBe('src/pages/Home.tsx');
  });
});
