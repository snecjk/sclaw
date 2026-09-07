import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..');

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf-8');
}

describe('AgentLoop 探针打包配置（task 2.3）', () => {
  const viteConfig = read('vite.config.ts');
  const pkg = JSON.parse(read('package.json')) as {
    dependencies?: Record<string, string>;
    main?: string;
  };

  it('@loongsuite/cms_node_sdk 声明为运行时 dependency（打进安装包 asar）', () => {
    expect(pkg.dependencies).toHaveProperty('@loongsuite/cms_node_sdk');
  });

  it('主进程 Rollup external 包含 @loongsuite/cms_node_sdk（保持真实模块文件，支持运行时插桩）', () => {
    expect(viteConfig).toContain("'@loongsuite/cms_node_sdk/register'");
    expect(viteConfig).toMatch(/\/\^@loongsuite\\\/cms_node_sdk\//);
  });

  it('主进程 Rollup external 保留 @anthropic-ai/claude-agent-sdk（被插桩目标）', () => {
    expect(viteConfig).toContain("'@anthropic-ai/claude-agent-sdk'");
  });

  it('electron-builder asarUnpack 覆盖 claude-agent-sdk（含平台二进制，探针 hook 的真实文件）', () => {
    const builderYml = read('electron-builder.yml');
    expect(builderYml).toContain('node_modules/@anthropic-ai/claude-agent-sdk-*/**');
  });

  it('探针依赖的 import-in-the-middle 可解析（纯 JS hook，无原生模块）', () => {
    const sdkPkg = JSON.parse(read('node_modules/@loongsuite/cms_node_sdk/package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(sdkPkg.dependencies).toHaveProperty('import-in-the-middle');
    // register 入口存在
    const registerPath = join(
      repoRoot,
      'node_modules/@loongsuite/cms_node_sdk/dist/cjs/register.js',
    );
    expect(() => readFileSync(registerPath)).not.toThrow();
  });

  it('主进程为多 chunk 输出（不再强制 inlineDynamicImports 单文件）', () => {
    // inlineDynamicImports:true 会把引导入口 require 业务入口拆出的 main chunk 静默丢弃。
    // 现已改为多 chunk：index.js（引导，先注册探针）+ main-*.js（业务）。
    expect(viteConfig).toContain('inlineDynamicImports: false');
    expect(viteConfig).not.toContain('inlineDynamicImports: true');
  });

  it('主进程入口为 dist-electron/main/index.js（引导入口产物）', () => {
    expect(pkg.main).toBe('dist-electron/main/index.js');
  });
});

describe('探针作用域与 NODE_OPTIONS 注入移除（task 2.4）', () => {
  const viteConfig = read('vite.config.ts');

  it('vite.config.ts 不再向 NODE_OPTIONS 注入 cms_node_sdk/register', () => {
    expect(viteConfig).not.toContain('-r @loongsuite/cms_node_sdk/register');
    expect(viteConfig).not.toMatch(/NODE_OPTIONS.*cms_node_sdk/);
  });

  it('onstart 保留 Electron 启动环境处理（清除 ELECTRON_RUN_AS_NODE）', () => {
    expect(viteConfig).toContain('delete electronEnv.ELECTRON_RUN_AS_NODE');
    expect(viteConfig).toContain('options.startup');
  });

  it('探针统一由主进程引导入口注册（electron/main/index.ts 调用 bootstrap）', () => {
    const bootstrap = read('electron/main/index.ts');
    expect(bootstrap).toContain("from './agentloop-init'");
    expect(bootstrap).toContain('bootstrap()');
  });

  it('开发/构建前置脚本未注入探针（package.json scripts 无 NODE_OPTIONS -r）', () => {
    const pkgRaw = read('package.json');
    expect(pkgRaw).not.toContain('-r @loongsuite/cms_node_sdk/register');
    expect(pkgRaw).not.toContain('--require @loongsuite/cms_node_sdk');
  });
});
