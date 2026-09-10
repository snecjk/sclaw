/**
 * P5 W2-1：一句话对话式创建——默认模板/目录，跳过表单五决策。
 */
import {
  createUserApp,
  getAppDevEnvironment,
  listAppTemplates,
  prepareAppDevEnvironment,
} from '@/lib/app-dev-api';
import { useAppDevCatalogStore } from '@/stores/app-dev-catalog';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';
import { useSessionCatalogStore } from '@/stores/session-catalog';

/** 从一句话需求派生短应用名（≤16 字）。 */
export function deriveAppNameFromPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/[「」『』【】\[\]（）()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return `应用-${Date.now().toString(36).slice(-4)}`;
  // 去掉常见动词前缀
  const stripped = cleaned
    .replace(/^(帮我|请|我想|我要|做一个|做个|创建|搭建|开发|写一个|写个)/, '')
    .trim();
  const base = (stripped || cleaned).slice(0, 16);
  return base || `应用-${Date.now().toString(36).slice(-4)}`;
}

export async function quickCreateAppFromPrompt(prompt: string): Promise<{
  workspaceId: string;
  appName: string;
  firstMessage: string;
}> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error('请先描述你想做的应用');

  void prepareAppDevEnvironment().catch(() => undefined);

  const [env, templates] = await Promise.all([
    getAppDevEnvironment(),
    listAppTemplates('site'),
  ]);
  const parentDir = env.defaultParentDir?.trim();
  if (!parentDir) throw new Error('无法确定存放位置，请用「高级选项」手动选择目录');

  const items = templates.items.filter((item) => item.pageType === 'site' && item.latestVersion);
  const preferred = items.find(
    (item) => item.templateId === 'site-minimal' && item.source === 'local-resource',
  ) ?? items.find((item) => item.templateId === 'site-minimal')
    ?? items[0];
  if (!preferred) throw new Error('暂无可用的站点模板');

  const appName = deriveAppNameFromPrompt(trimmed);
  const result = await createUserApp({
    name: appName,
    parentDir,
    projectType: 'frontend',
    pageType: 'site',
    templateId: preferred.templateId,
    templateVersion: preferred.latestVersion,
    templateSource: preferred.source ?? 'local-resource',
  });

  useAppDevCatalogStore.getState().registerWorkspaceId(result.workspaceId);
  await useSessionCatalogStore.getState().refreshWorkspaces().catch(() => undefined);
  await useAppDevCatalogStore.getState().refresh().catch(() => undefined);

  // pending 只存用户原文；发送时再包 Plan 闸门，避免气泡露出系统约束。
  useAppPlazaShellStore.getState().openOrFocusDevAppTab(
    result.workspaceId,
    appName,
    'app',
    { pendingPrompt: trimmed },
  );

  return { workspaceId: result.workspaceId, appName, firstMessage: trimmed };
}
