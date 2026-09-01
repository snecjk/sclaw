import { describe, expect, it } from 'vitest';
import {
  buildPostPublishMenuSyncPrompt,
  buildSiteappMenuSyncParams,
} from '../../shared/siteapp-menu-sync';

describe('siteapp menu sync', () => {
  it('builds apply params with confirm and skip_preview', () => {
    expect(buildSiteappMenuSyncParams({
      appCode: 'app_test',
      menus: [{
        menu_code: 'home',
        parent_code: null,
        menu_name: '首页',
        menu_type: 'directory',
      }],
    })).toEqual({
      app_code: 'app_test',
      mode: 'apply',
      confirm: true,
      skip_preview: true,
      menus: [{
        menu_code: 'home',
        parent_code: null,
        menu_name: '首页',
        menu_type: 'directory',
      }],
    });
  });

  it('maps legacy menu_type menu to page and drops empty resource_path', () => {
    expect(buildSiteappMenuSyncParams({
      appCode: 'app_test',
      menus: [{
        menu_code: 'home',
        parent_code: null,
        menu_name: '首页',
        menu_type: 'menu',
        resource_path: null,
      }],
    }).menus).toEqual([{
      menu_code: 'home',
      parent_code: null,
      menu_name: '首页',
      menu_type: 'page',
    }]);
  });

  it('asks site apps for two-level menus and not to apply before confirm', () => {
    const prompt = buildPostPublishMenuSyncPrompt({
      appCode: 'app_site',
      appName: '站点A',
      pageType: 'site',
      env: 'daily',
    });
    expect(prompt).toContain('app_site');
    expect(prompt).toContain('一级 + 二级');
    expect(prompt).toContain('是否把以上菜单同步到云端');
    expect(prompt).toContain('sai-cli siteapp menu sync');
    expect(prompt).toContain('sai-cli siteapp menu list');
    expect(prompt).toContain('我同意之前，不要执行 apply');
    expect(prompt).toContain('运行时按权限隐藏的页面也要列入');
  });

  it('uses a manual opener when triggered from the publish-menu action', () => {
    const prompt = buildPostPublishMenuSyncPrompt({
      appCode: 'app_site',
      appName: '站点A',
      trigger: 'manual',
    });
    expect(prompt).toContain('请扫描「站点A」的项目路由');
    expect(prompt).not.toContain('已经发布到');
  });

  it('asks assets apps for a single first-level menu', () => {
    const prompt = buildPostPublishMenuSyncPrompt({
      appCode: 'app_assets',
      pageType: 'assets',
    });
    expect(prompt).toContain('一个一级菜单');
    expect(prompt).not.toContain('一级 + 二级');
  });
});
