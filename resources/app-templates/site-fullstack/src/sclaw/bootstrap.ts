import { activateInstalledPlugins } from './plugin-host';
import { installedPlugins } from './plugins.generated';

export async function bootstrapInstalledPlugins() {
  return activateInstalledPlugins(installedPlugins, 'site');
}
