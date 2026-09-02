import type { StoSsoAuth } from '@sto/sclaw-plugin-sso-auth';

type PageType = 'site' | 'assets';

export interface InstalledFrontendPlugin {
  id: string;
  pageTypes: readonly PageType[];
  activate(context: {
    pageType: PageType;
    provide(key: 'auth.sto-token', value: StoSsoAuth): void;
  }): Promise<void> | void;
}

export async function activateInstalledPlugins(
  plugins: readonly InstalledFrontendPlugin[],
  pageType: PageType,
): Promise<{ auth: StoSsoAuth }> {
  const capabilities = new Map<string, unknown>();
  for (const plugin of plugins) {
    if (!plugin.pageTypes.includes(pageType)) {
      throw new Error(`插件 ${plugin.id} 不支持 ${pageType} 应用`);
    }
    await plugin.activate({
      pageType,
      provide(key, value) {
        if (capabilities.has(key)) throw new Error(`插件能力重复注册：${key}`);
        capabilities.set(key, value);
      },
    });
  }

  const auth = capabilities.get('auth.sto-token');
  if (!auth) throw new Error('缺少 auth.sto-token 插件能力');
  return { auth: auth as StoSsoAuth };
}
