import { describe, expect, it } from 'vitest';
import { scanSiteappMenusFromNavSource } from '../../shared/siteapp-menu-from-nav';

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
    expect(result.skipped).toEqual([{ label: '开发示例', reason: 'developerOnly' }]);
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
