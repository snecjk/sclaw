import { describe, expect, it } from 'vitest';
import { scanSiteappMenusFromNavSource, scanSiteappMenusFromProjectSources } from '../../shared/siteapp-menu-from-nav';

describe('scanSiteappMenusFromNavSource', () => {
  it('keeps SIDE_NAV nested children as a two-level tree', () => {
    const source = `
export const SIDE_NAV = [
  { key: 'home', label: '首页', path: 'home' },
  {
    key: 'test-menu',
    label: '测试一级菜单',
    children: [
      { key: 'hello', label: '测试二级菜单', path: 'hello' },
    ],
  },
  { key: 'example', label: '开发示例', path: 'example', developerOnly: true },
];
`;
    const result = scanSiteappMenusFromNavSource(source, { pageType: 'site' });
    expect(result.source).toBe('side-nav');
    expect(result.skipped).toEqual([{ label: '开发示例', reason: 'developerOnly', path: 'example' }]);
    expect(result.menus).toEqual([
      { menu_code: 'home', parent_code: null, menu_name: '首页', menu_type: 'page', resource_path: '/home' },
      { menu_code: 'test-menu', parent_code: null, menu_name: '测试一级菜单', menu_type: 'directory', resource_path: null },
      { menu_code: 'hello', parent_code: 'test-menu', menu_name: '测试二级菜单', menu_type: 'page', resource_path: '/hello' },
    ]);
  });

  it('does not steal a child path onto a SIDE_NAV directory', () => {
    const source = `
export const SIDE_NAV = [
  { key: 'test-menu', label: '测试一级菜单', children: [{ key: 'hello', label: '测试二级菜单', path: 'hello' }] },
];
`;
    const result = scanSiteappMenusFromNavSource(source, { pageType: 'site' });
    expect(result.menus[0]).toMatchObject({
      menu_code: 'test-menu',
      menu_type: 'directory',
      resource_path: null,
    });
  });

  it('still groups TOP_NAV into directories plus pages', () => {
    const source = `
export const TOP_NAV = [
  { key: 'workspace', label: '工作台', children: [{ key: 'home', label: '首页概览', path: 'home' }] },
];
`;
    const result = scanSiteappMenusFromNavSource(source, { pageType: 'site' });
    expect(result.menus).toEqual([
      { menu_code: 'workspace', parent_code: null, menu_name: '工作台', menu_type: 'directory', resource_path: null },
      { menu_code: 'home', parent_code: 'workspace', menu_name: '首页概览', menu_type: 'page', resource_path: '/home' },
    ]);
  });
});

describe('scanSiteappMenusFromProjectSources', () => {
  it('picks up Route pages missing from SIDE_NAV and still skips developerOnly', () => {
    const nav = `
export const SIDE_NAV = [
  { key: 'home', label: '首页', path: 'home' },
  { key: 'example', label: '开发示例', path: 'example', developerOnly: true },
];
`;
    const app = `
export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="site-loss" element={<SiteLossAnalysisPage />} />
        <Route path="example" element={<DemoPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
`;
    const result = scanSiteappMenusFromProjectSources([nav, app], { pageType: 'site' });
    expect(result.source).toBe('mixed');
    expect(result.skipped).toEqual([{ label: '开发示例', reason: 'developerOnly', path: 'example' }]);
    expect(result.menus).toEqual([
      { menu_code: 'home', parent_code: null, menu_name: '首页', menu_type: 'page', resource_path: '/home' },
      {
        menu_code: 'site-loss',
        parent_code: null,
        menu_name: 'Site Loss Analysis',
        menu_type: 'page',
        resource_path: '/site-loss',
      },
    ]);
  });

  it('keeps permission-gated routes even when they are hidden at runtime', () => {
    const source = `
const MENU_ROUTES = [
  { path: 'home', label: '首页', permission: 'menu:home', element: HomePage },
  { path: 'site-loss', label: '网点损益分析', permission: 'menu:site-loss', element: SiteLossAnalysisPage },
];

export default function App() {
  const allowed = useMenuPermissions();
  return (
    <Routes>
      {MENU_ROUTES.filter((item) => allowed.includes(item.permission)).map((item) => (
        <Route key={item.path} path={item.path} element={<item.element />} />
      ))}
      {canAccess('report') ? <Route path="report" element={<ReportPage />} /> : null}
    </Routes>
  );
}
`;
    const result = scanSiteappMenusFromProjectSources([source], { pageType: 'site' });
    expect(result.menus).toEqual(expect.arrayContaining([
      { menu_code: 'home', parent_code: null, menu_name: '首页', menu_type: 'page', resource_path: '/home' },
      {
        menu_code: 'site-loss',
        parent_code: null,
        menu_name: '网点损益分析',
        menu_type: 'page',
        resource_path: '/site-loss',
      },
      {
        menu_code: 'report',
        parent_code: null,
        menu_name: 'Report',
        menu_type: 'page',
        resource_path: '/report',
      },
    ]));
  });
});
