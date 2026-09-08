import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  matchAppDevRoute,
  resolveAppDevRouteUrl,
} from '@/lib/app-dev-preview-routes';
import { listAppRoutes } from '../../electron/services/app-dev-service';

describe('resolveAppDevRouteUrl', () => {
  it('joins hash routes onto the current preview URL', () => {
    expect(resolveAppDevRouteUrl('http://127.0.0.1:58967/', '#/home'))
      .toBe('http://127.0.0.1:58967/#/home');
    // A2UI 页面 id 形式（不带斜杠）
    expect(resolveAppDevRouteUrl('http://127.0.0.1:58967/#/home', '#customer-list'))
      .toBe('http://127.0.0.1:58967/#customer-list');
  });

  it('joins path routes and clears stale hash/search', () => {
    expect(resolveAppDevRouteUrl('http://127.0.0.1:58967/#/home?x=1', '/detail'))
      .toBe('http://127.0.0.1:58967/detail');
  });

  it('returns null for unusable input', () => {
    expect(resolveAppDevRouteUrl('not a url', '#/home')).toBeNull();
    expect(resolveAppDevRouteUrl('', '#/home')).toBeNull();
    expect(resolveAppDevRouteUrl('http://a/', '')).toBeNull();
  });
});

describe('matchAppDevRoute', () => {
  const routes = [
    { path: '#/home', label: '/home', source: 'router' as const },
    { path: '#/example', label: '/example', source: 'router' as const },
  ];

  it('matches the current hash route', () => {
    expect(matchAppDevRoute('http://127.0.0.1:58967/#/example', routes)?.label)
      .toBe('/example');
  });

  it('treats #home and #/home as the same page', () => {
    const a2ui = [{ path: '#home', label: 'home', source: 'a2ui' as const }];
    expect(matchAppDevRoute('http://127.0.0.1:58967/#/home', a2ui)?.label).toBe('home');
    expect(matchAppDevRoute('http://127.0.0.1:58967/#home', routes)?.label).toBe('/home');
  });

  it('matches path routes with trailing-slash tolerance', () => {
    const pathRoutes = [{ path: '/detail', label: '/detail', source: 'router' as const }];
    expect(matchAppDevRoute('http://a/detail/', pathRoutes)?.label).toBe('/detail');
  });

  it('returns null when nothing matches or URL invalid', () => {
    expect(matchAppDevRoute('http://a/#/unknown', routes)).toBeNull();
    expect(matchAppDevRoute('nope', routes)).toBeNull();
    expect(matchAppDevRoute('http://a/#/home', [])).toBeNull();
  });
});

describe('listAppRoutes（electron 路由发现）', () => {
  it('discovers <Route path> declarations and rewrites them for HashRouter apps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sclaw-app-routes-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src', 'App.tsx'),
      `import { HashRouter, Route, Routes } from 'react-router-dom';
       export default function App() {
         return <HashRouter><Routes>
           <Route index element={<div/>} />
           <Route path="home" element={<div/>} />
           <Route path="customer/list" element={<div/>} />
           <Route path="detail/:id" element={<div/>} />
           <Route path="*" element={<div/>} />
         </Routes></HashRouter>;
       }`,
      'utf8',
    );

    const routes = await listAppRoutes(root);
    // home 优先；参数路由与通配符不可直接跳转，被过滤
    expect(routes).toEqual([
      { path: '#/home', label: '/home', source: 'router' },
      { path: '#/customer/list', label: '/customer/list', source: 'router' },
    ]);
  });

  it('keeps plain paths for BrowserRouter apps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sclaw-app-routes-'));
    await mkdir(join(root, 'frontend', 'src'), { recursive: true });
    await writeFile(
      join(root, 'frontend', 'src', 'App.tsx'),
      `import { BrowserRouter, Route, Routes } from 'react-router-dom';
       export default function App() {
         return <BrowserRouter><Routes><Route path="/home" element={<div/>} /></Routes></BrowserRouter>;
       }`,
      'utf8',
    );

    const routes = await listAppRoutes(root);
    expect(routes).toEqual([{ path: '/home', label: '/home', source: 'router' }]);
  });

  it('falls back to A2UI page.json assets when no router routes exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sclaw-app-routes-'));
    await mkdir(join(root, 'src', 'pages'), { recursive: true });
    await writeFile(join(root, 'src', 'pages', 'customer-list.page.json'), '[]', 'utf8');
    await writeFile(join(root, 'src', 'pages', 'home.page.json'), '[]', 'utf8');

    const routes = await listAppRoutes(root);
    expect(routes).toEqual([
      { path: '#home', label: 'home', source: 'a2ui' },
      { path: '#customer-list', label: 'customer-list', source: 'a2ui' },
    ]);
  });

  it('returns an empty list for apps without routes or pages (渲染侧兜底当前地址)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sclaw-app-routes-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'main.ts'), 'console.log(1)', 'utf8');

    await expect(listAppRoutes(root)).resolves.toEqual([]);
    await expect(listAppRoutes(join(root, 'missing'))).resolves.toEqual([]);
  });
});
