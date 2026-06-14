import { join } from 'node:path';

export type EngineExtensionSupport = {
  openclaw?: {
    pluginId: string;
    sourceDir: string;
  };
  claudeSdk?: {
    runtimeAdapterId: string;
  };
  claudePlugin?: {
    pluginId: string;
    sourceDir: string;
  };
};

export type EngineExtensionDefinition = {
  id: string;
  title: string;
  description: string;
  supports: EngineExtensionSupport;
};

const ROOT = join(__dirname, '../..');

export const ENGINE_EXTENSIONS: EngineExtensionDefinition[] = [
  {
    id: 'sto-dingtalk-send-guard',
    title: 'DingTalk Send Guard',
    description: 'DingTalk recipient injection, anti-batch send rules, and post-success rate limiting.',
    supports: {
      openclaw: {
        pluginId: 'sto-dingtalk-send-guard',
        sourceDir: join(ROOT, 'sto-plugin', 'openclaw', 'sto-dingtalk-send-guard'),
      },
      claudeSdk: {
        runtimeAdapterId: 'sto-dingtalk-send-guard',
      },
      claudePlugin: {
        pluginId: 'sto-dingtalk-send-guard',
        sourceDir: join(ROOT, 'sto-plugin', 'claude', 'sto-dingtalk-send-guard', 'plugin'),
      },
    },
  },
];

export function listEngineExtensions(): EngineExtensionDefinition[] {
  return ENGINE_EXTENSIONS;
}

export function getEngineExtension(id: string): EngineExtensionDefinition | undefined {
  return ENGINE_EXTENSIONS.find((entry) => entry.id === id);
}

export function listClaudePluginExtensions(): EngineExtensionDefinition[] {
  return ENGINE_EXTENSIONS.filter((entry) => Boolean(entry.supports.claudePlugin));
}

export function listOpenClawPluginExtensions(): EngineExtensionDefinition[] {
  return ENGINE_EXTENSIONS.filter((entry) => Boolean(entry.supports.openclaw));
}
