import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadAuthorizedSiteMenus,
  normalizeAuthorizedMenus,
  resolveSiteApplicationId,
  resolveSiteMenuOrigin,
} from '../../resources/app-templates/site-minimal/src/sclaw/site-menu';
import {
  findSideNavByPath,
  flattenPageNavItems,
} from '../../resources/app-templates/site-minimal/src/layouts/nav-config';
import { toAntdMenuItems } from '../../resources/app-templates/site-minimal/src/layouts/AppSider';

const successResponse = {
  success: true,
  errCode: '200',
  errMessage: 'OK',
  data: [
    {
      id: 33,
      parent_id: null,
      menu_code: 'home',
      menu_name: '首页',
      menu_type: 'page',
      resource_path: '/home',
      icon: 'setting',
      sort_order: 1,
      is_public: true,
      is_visible: true,
      status: 'active',
      children: [],
    },
  ],
  extend: null,
  total: null,
};

const localSiteConfig = {
  protocolVersion: 'sto-sso-auth/v1',
  applicationId: 'app-a1b2c3d4',
  pageType: 'site',
  runtimeMode: 'local',
  deployEnv: 'daily',
} as const;

describe('site-minimal authorized menu client', () => {
  const requestMock = vi.fn();

  beforeEach(() => {
    requestMock.mockReset().mockResolvedValue(successResponse);
  });

  it.each([
    ['page-test.sto.cn', 'https://baseinfo-aimemory-test.sto.cn'],
    ['page-daily.sto.cn', 'https://baseinfo-aimemory-test.sto.cn'],
    ['page-pre.sto.cn', 'https://pre-baseinfo-aimemory.sto.cn'],
    ['page.sto.cn', 'https://baseinfo-aimemory.sto.cn'],
    ['unknown.example.com', 'https://baseinfo-aimemory.sto.cn'],
  ])('根据页面域名 %s 选择菜单服务', (hostname, expected) => {
    expect(resolveSiteMenuOrigin(hostname)).toBe(expected);
  });

  it('本地使用测试代理并从 SSO 配置读取 applicationId', async () => {
    const menus = await loadAuthorizedSiteMenus({
      isDev: true,
      config: localSiteConfig,
      request: requestMock,
    });

    expect(menus).toEqual([{ key: 'home', label: '首页', path: 'home' }]);
    expect(requestMock).toHaveBeenCalledWith(
      '/proxy/siteapp-menu/api/v1/site-apps/app-a1b2c3d4/auth/menu',
      { method: 'GET' },
    );
  });

  it('发布后仅根据当前页面域名选择预发服务', async () => {
    await loadAuthorizedSiteMenus({
      isDev: false,
      hostname: 'page-pre.sto.cn',
      pathname: '/ai-apps-pre/app_8588c1af5d2c7c9d/index.html',
      request: requestMock,
    });

    expect(requestMock).toHaveBeenCalledWith(
      'https://pre-baseinfo-aimemory.sto.cn/api/v1/site-apps/app_8588c1af5d2c7c9d/auth/menu',
      { method: 'GET' },
    );
  });

  it.each([
    ['/ai-apps-test/app_8588c1af5d2c7c9d/index.html', 'app_8588c1af5d2c7c9d'],
    ['/ai-apps-pre/app_1234abcd/page/index.html', 'app_1234abcd'],
    ['/ai-apps/app_online123/index.html', 'app_online123'],
  ])('发布环境从路径 %s 解析 applicationId', (pathname, expected) => {
    expect(resolveSiteApplicationId({
      isDev: false,
      pathname,
    })).toBe(expected);
  });

  it('本地开发从 Vite 注入的原始 SSO 配置读取 applicationId', () => {
    expect(resolveSiteApplicationId({
      isDev: true,
      pathname: '/',
      config: localSiteConfig,
    })).toBe('app-a1b2c3d4');
  });

  it.each([
    '/app_8588c1af5d2c7c9d/index.html',
    '/ai-apps-test/not-an-app/index.html',
    '/ai-apps-test/app_%2Fescape/index.html',
  ])('发布环境拒绝不符合发布目录约定的路径 %s', (pathname) => {
    expect(() => resolveSiteApplicationId({
      isDev: false,
      pathname,
    })).toThrow('无法从发布地址解析应用编码');
  });

  it('缺少 applicationId 时拒绝请求菜单', async () => {
    await expect(loadAuthorizedSiteMenus({
      isDev: true,
      config: {
        protocolVersion: 'sto-sso-auth/v1',
        pageType: 'site',
        runtimeMode: 'local',
        deployEnv: 'daily',
      },
      request: requestMock,
    })).rejects.toThrow('缺少应用编码，无法加载菜单');
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('site-minimal authorized menu normalization', () => {
  it('只保留 active 且 visible 的节点并递归排序', () => {
    const result = normalizeAuthorizedMenus({
      success: true,
      errCode: '200',
      errMessage: 'OK',
      data: [
        {
          id: 10,
          parent_id: null,
          menu_code: 'system',
          menu_name: '系统管理',
          menu_type: 'directory',
          resource_path: null,
          icon: 'setting',
          sort_order: 2,
          is_public: false,
          is_visible: true,
          status: 'active',
          children: [
            {
              id: 12,
              parent_id: 10,
              menu_code: 'hidden',
              menu_name: '隐藏页面',
              menu_type: 'page',
              resource_path: '/hidden',
              icon: null,
              sort_order: 1,
              is_public: false,
              is_visible: false,
              status: 'active',
              children: [],
            },
            {
              id: 11,
              parent_id: 10,
              menu_code: 'users',
              menu_name: '用户管理',
              menu_type: 'page',
              resource_path: '/users',
              icon: null,
              sort_order: 2,
              is_public: false,
              is_visible: true,
              status: 'active',
              children: [],
            },
          ],
        },
        successResponse.data[0],
        {
          ...successResponse.data[0],
          id: 40,
          menu_code: 'disabled',
          menu_name: '已停用',
          resource_path: '/disabled',
          sort_order: 0,
          status: 'disabled',
        },
      ],
    });

    expect(result).toEqual([
      { key: 'home', label: '首页', path: 'home' },
      {
        key: 'system',
        label: '系统管理',
        children: [{ key: 'users', label: '用户管理', path: 'users' }],
      },
    ]);
    expect(flattenPageNavItems(result)).toEqual([
      { key: 'home', label: '首页', path: 'home' },
      { key: 'users', label: '用户管理', path: 'users' },
    ]);
    expect(findSideNavByPath(result, '/users')).toEqual({
      key: 'users',
      label: '用户管理',
      path: 'users',
    });
  });

  it('父目录不可见时不泄漏其可见子页面', () => {
    const result = normalizeAuthorizedMenus({
      success: true,
      data: [{
        id: 20,
        parent_id: null,
        menu_code: 'private',
        menu_name: '不可见目录',
        menu_type: 'directory',
        resource_path: null,
        icon: null,
        sort_order: 1,
        is_public: false,
        is_visible: false,
        status: 'active',
        children: [{ ...successResponse.data[0], parent_id: 20 }],
      }],
    });

    expect(result).toEqual([]);
  });

  it('侧栏菜单转换保留任意深度的目录结构', () => {
    expect(toAntdMenuItems([{
      key: 'root',
      label: '根目录',
      children: [{
        key: 'system',
        label: '系统管理',
        children: [{ key: 'users', label: '用户管理', path: 'users' }],
      }],
    }])).toEqual([{
      key: 'root',
      label: '根目录',
      children: [{
        key: 'system',
        label: '系统管理',
        children: [{ key: 'users', label: '用户管理' }],
      }],
    }]);
  });

  it.each([
    { success: false, data: [] },
    { success: true, data: null },
  ])('拒绝失败或结构错误的响应 %#', (payload) => {
    expect(() => normalizeAuthorizedMenus(payload)).toThrow('菜单接口响应不合法');
  });

  it.each([
    [null, '缺少'],
    ['', '缺少'],
    ['https://evil.example/page', '站内路径'],
    ['//evil.example/page', '站内路径'],
  ])('拒绝可见页面的非法 resource_path：%s', (resourcePath, message) => {
    expect(() => normalizeAuthorizedMenus({
      success: true,
      data: [{ ...successResponse.data[0], resource_path: resourcePath }],
    })).toThrow(message);
  });
});
