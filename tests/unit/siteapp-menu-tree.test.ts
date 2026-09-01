import { describe, expect, it } from 'vitest';
import {
  applyMenuTreeDrag,
  flattenMenuTree,
  menusToTree,
  renameMenuTreeNode,
  treeToMenus,
} from '../../shared/siteapp-menu-tree';

const grouped = [
  { menu_code: 'workspace', parent_code: null, menu_name: '工作台', menu_type: 'directory' },
  { menu_code: 'home', parent_code: 'workspace', menu_name: '首页', menu_type: 'page', resource_path: '/home' },
  { menu_code: 'list', parent_code: 'workspace', menu_name: '客户列表', menu_type: 'page', resource_path: '/customer-list' },
  { menu_code: 'ops', parent_code: null, menu_name: '业务办理', menu_type: 'directory' },
  { menu_code: 'orders', parent_code: 'ops', menu_name: '业务列表', menu_type: 'page', resource_path: '/orders' },
];

describe('siteapp menu tree', () => {
  it('builds a two-level tree without a synthetic root', () => {
    const tree = menusToTree(grouped);
    expect(tree.map((node) => node.menu_code)).toEqual(['workspace', 'ops']);
    expect(tree[0]?.children.map((node) => node.menu_name)).toEqual(['首页', '客户列表']);
    expect(treeToMenus(tree)).toEqual([
      { menu_code: 'workspace', parent_code: null, menu_name: '工作台', menu_type: 'directory', resource_path: null },
      { menu_code: 'home', parent_code: 'workspace', menu_name: '首页', menu_type: 'page', resource_path: '/home' },
      { menu_code: 'list', parent_code: 'workspace', menu_name: '客户列表', menu_type: 'page', resource_path: '/customer-list' },
      { menu_code: 'ops', parent_code: null, menu_name: '业务办理', menu_type: 'directory', resource_path: null },
      { menu_code: 'orders', parent_code: 'ops', menu_name: '业务列表', menu_type: 'page', resource_path: '/orders' },
    ]);
  });

  it('renames a nested page', () => {
    const tree = renameMenuTreeNode(menusToTree(grouped), 'list', '客户名录');
    expect(tree[0]?.children[1]?.menu_name).toBe('客户名录');
  });

  it('reorders sibling pages', () => {
    const tree = applyMenuTreeDrag(menusToTree(grouped), 'list', 'home');
    expect(tree[0]?.children.map((node) => node.menu_code)).toEqual(['list', 'home']);
  });

  it('does not reparent or move across levels', () => {
    const original = menusToTree(grouped);
    expect(applyMenuTreeDrag(original, 'list', 'ops')).toEqual(original);
    expect(applyMenuTreeDrag(original, 'list', 'orders')).toEqual(original);
    expect(applyMenuTreeDrag(original, 'home', 'workspace')).toEqual(original);
  });

  it('reorders top-level directories with their children', () => {
    const tree = applyMenuTreeDrag(menusToTree(grouped), 'ops', 'workspace');
    expect(tree.map((node) => node.menu_code)).toEqual(['ops', 'workspace']);
    expect(tree[0]?.children.map((node) => node.menu_code)).toEqual(['orders']);
  });

  it('flattens tree rows for a sortable list', () => {
    expect(flattenMenuTree(menusToTree(grouped)).map((row) => `${row.depth}:${row.node.menu_code}`)).toEqual([
      '0:workspace',
      '1:home',
      '1:list',
      '0:ops',
      '1:orders',
    ]);
  });
});
