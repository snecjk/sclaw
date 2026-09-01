import { describe, expect, it } from 'vitest';

import {
  createAuthorizedMenuReadyState,
  createAuthorizedMenuResolvedState,
  createAuthorizedMenuErrorState,
} from '../../resources/app-templates/site-minimal/src/layouts/authorized-menu-state';

describe('site-minimal authorized menu strict state', () => {
  it('空菜单进入 empty 且没有可渲染页面', () => {
    expect(createAuthorizedMenuResolvedState([])).toEqual({
      status: 'empty',
      items: [],
      pages: [],
      error: null,
    });
  });

  it('错误状态不保留旧菜单并暴露可读错误', () => {
    expect(createAuthorizedMenuErrorState(new Error('服务暂不可用'))).toEqual({
      status: 'error',
      items: [],
      pages: [],
      error: '服务暂不可用',
    });
    expect(createAuthorizedMenuErrorState('unknown')).toEqual({
      status: 'error',
      items: [],
      pages: [],
      error: '应用菜单加载失败',
    });
  });

  it('当前路径未授权时要求跳转至第一个授权页面', () => {
    const state = createAuthorizedMenuReadyState([
      { key: 'reports', label: '报表', path: 'reports' },
      { key: 'home', label: '首页', path: 'home' },
    ], 'forbidden');

    expect(state.redirectPath).toBe('reports');
    expect(state.selectedItem).toEqual({ key: 'reports', label: '报表', path: 'reports' });
  });

  it('当前路径已授权时保持该页面', () => {
    const state = createAuthorizedMenuReadyState([
      { key: 'reports', label: '报表', path: 'reports' },
      { key: 'home', label: '首页', path: 'home' },
    ], '/home');

    expect(state.redirectPath).toBeNull();
    expect(state.selectedItem).toEqual({ key: 'home', label: '首页', path: 'home' });
  });
});
