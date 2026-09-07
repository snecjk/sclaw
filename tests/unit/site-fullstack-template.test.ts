import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'resources', 'app-templates', 'site-fullstack');

describe('site-fullstack template contract', () => {
  it('has manifest, server routes, drizzle schema, and backend-dev skill', () => {
    expect(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))).toMatchObject({
      templateId: 'site-fullstack',
      pageType: 'site',
    });
    expect(existsSync(join(root, 'server', 'index.ts'))).toBe(true);
    expect(existsSync(join(root, 'server', 'routes', 'health.ts'))).toBe(true);
    expect(existsSync(join(root, 'server', 'routes', 'auth.ts'))).toBe(true);
    expect(existsSync(join(root, 'server', 'routes', 'todos.ts'))).toBe(true);
    expect(existsSync(join(root, 'drizzle', 'schema.ts'))).toBe(true);
    expect(existsSync(join(root, 'openspec', 'skill-catalog', 'backend-dev', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'contracts', 'secrets.v1.json'))).toBe(true);
  });

  it('declares appBackend managed proxy and .data gitignore', () => {
    const proxy = JSON.parse(readFileSync(join(root, 'contracts', 'dev-proxy.v1.json'), 'utf8')) as {
      proxies: Array<{ key: string; managedBy?: string }>;
    };
    expect(proxy.proxies.some((p) => p.key === 'appBackend' && p.managedBy === 'app-runtime')).toBe(true);
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.data/');
  });

  it('package scripts include server and migrate', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['dev:server']).toBeTruthy();
    expect(pkg.scripts['db:migrate']).toBeTruthy();
    expect(pkg.scripts.smoke).toBeTruthy();
  });
});

/**
 * 手工冒烟清单（不自动跑）：
 * 1. 创建应用 → 工程形态选「全栈应用」→ template site-fullstack
 * 2. 工作台等待 ready，预览打开首页显示「后端已连接」
 * 3. 注册 / 登录 → 添加/勾选/删除 todo
 * 4. 溢出菜单「运行时」：看 backend URL、日志、停止后再启动
 * 5. 密钥页保存 SESSION_SECRET，重启后端后仍可登录
 * 6. 确认 .data/ 不在源码同步 / checkpoint 打包内
 */
