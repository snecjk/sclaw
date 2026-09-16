export interface StoBuiltinToolsManifestPlugin {
  id: string;
  localDir: string;
  enabled: boolean;
}

export function parseStoBuiltinToolsManifest(raw: string): StoBuiltinToolsManifestPlugin[] | null {
  try {
    const parsed = JSON.parse(raw) as {
      plugins?: Array<{ id?: unknown; localDir?: unknown; enabled?: unknown }>;
    };
    if (!Array.isArray(parsed.plugins)) return null;
    const plugins: StoBuiltinToolsManifestPlugin[] = [];
    for (const plugin of parsed.plugins) {
      if (typeof plugin.id !== 'string' || typeof plugin.localDir !== 'string') continue;
      plugins.push({
        id: plugin.id,
        localDir: plugin.localDir,
        enabled: plugin.enabled !== false,
      });
    }
    return plugins;
  } catch {
    return null;
  }
}

/**
 * H1：manifest 只覆盖其中登记的插件。
 * - 未出现在 manifest 的插件保持硬编码 fallback 列表，读失败也不丢。
 * - manifest.enabled === false 的从安装列表剔除。
 */
export function filterPluginSpecsByManifest<T extends { dirName: string }>(
  fallback: readonly T[],
  manifest: StoBuiltinToolsManifestPlugin[] | null,
): T[] {
  if (!manifest || manifest.length === 0) return [...fallback];
  const byDir = new Map(manifest.map((plugin) => [plugin.localDir, plugin]));
  return fallback.filter((spec) => {
    const entry = byDir.get(spec.dirName);
    if (!entry) return true;
    return entry.enabled;
  });
}
