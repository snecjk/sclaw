/**
 * Build Agent-facing connector-index (catalog summary ⊕ local state).
 * Detail skills are lazy-loaded via Skill(slug) when connected — not inlined here.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { CONNECTOR_AGENT_CONTEXT_MARKER } from '../../shared/connectors/agent-context-marker';
import { connectorStatusLabel } from '../../shared/connectors/connector-status-label';
import { SKILL_PLAZA_CONNECTORS_HREF } from '../../shared/connectors/deep-link';
import {
  connectorSkillSlug,
  resolveConnectorAgentSkill,
} from '../../shared/connectors/resolve-agent-skill';
import { resolveEffectiveConnector } from '../../shared/connectors/resolve-effective-runtime';
import type { ConnectorDescriptor, ConnectorStatus } from '../../shared/connectors/types';
import { getConnectorService } from './connector-service';
import { listConnectedConnectorIds, readConnectorState } from './state-store';

export { CONNECTOR_AGENT_CONTEXT_MARKER };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function connectorsDir(): string {
  const override = process.env.STOCLAW_CONNECTORS_DIR?.trim();
  if (override) return override;
  return join(homedir(), '.stoclaw', 'connectors');
}

export function getConnectedConnectorsAgentContextPath(): string {
  return join(connectorsDir(), 'agent-context.txt');
}

function hostnameFromServerUrl(serverUrl: string): string {
  try {
    const u = new URL(serverUrl.includes('://') ? serverUrl : `https://${serverUrl}`);
    return u.hostname;
  } catch {
    return serverUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  }
}

/** Hostname of the connected GitLab connector, if any. */
export function resolveConnectedGitlabHostname(): string | null {
  const state = readConnectorState();
  for (const [id, item] of Object.entries(state.items)) {
    if (item.status !== 'connected') continue;
    const serverUrl = item.serverUrl?.trim();
    if (!serverUrl) continue;
    if (!id.toLowerCase().includes('gitlab') && !/gitlab/i.test(serverUrl)) continue;
    const host = hostnameFromServerUrl(serverUrl);
    if (host) return host;
  }
  for (const item of Object.values(state.items)) {
    if (item.status !== 'connected' || !item.serverUrl?.trim()) continue;
    const host = hostnameFromServerUrl(item.serverUrl);
    if (host) return host;
  }
  return null;
}

function resolveLocalStatus(descriptor: ConnectorDescriptor): ConnectorStatus {
  const state = readConnectorState();
  return state.items[descriptor.id]?.status ?? 'available';
}

function resolveBinaryLabel(descriptor: ConnectorDescriptor): string {
  const effective = resolveEffectiveConnector(descriptor);
  const runtime = asRecord(effective.descriptor.runtime);
  const binary = text(runtime.binary).toLowerCase().replace(/\.exe$/i, '');
  if (binary) return binary;
  if (effective.isGlab || descriptor.id.toLowerCase().includes('gitlab')) return 'glab';
  return descriptor.id;
}

function buildIndexLine(descriptor: ConnectorDescriptor): string {
  const name = descriptor.name || descriptor.id;
  const binary = resolveBinaryLabel(descriptor);
  const status = resolveLocalStatus(descriptor);
  const statusLabel = connectorStatusLabel(status);
  const agent = descriptor.agent ?? {};
  const summary = text(agent.summary) || text(descriptor.description) || '（无摘要）';
  const skillSlug = connectorSkillSlug(descriptor);
  const examples = Array.isArray(agent.examples)
    ? agent.examples.filter((item): item is string => typeof item === 'string' && item.trim())
    : [];

  let line = `- ${name}（${binary}）· ${statusLabel} · ${summary}`;
  if (examples.length > 0) {
    line += `；示例：${examples.slice(0, 2).join('、')}`;
  }
  if (status === 'connected' && skillSlug) {
    line += `；已连接时可 Skill("${skillSlug}") 或 Bash 调用细节`;
  }
  return line;
}

function buildConnectedExtraLines(descriptor: ConnectorDescriptor): string[] {
  const state = readConnectorState();
  const local = state.items[descriptor.id];
  const effective = resolveEffectiveConnector(descriptor);
  const runtime = asRecord(effective.descriptor.runtime);
  const binary = text(runtime.binary).toLowerCase().replace(/\.exe$/i, '') || (
    effective.isGlab ? 'glab' : ''
  );
  const name = descriptor.name || descriptor.id;
  const serverUrl = local?.serverUrl?.trim();
  const skillSlug = connectorSkillSlug(descriptor);
  const summary = text(descriptor.agent?.summary);

  // Prefer server-driven summary for connected hint (new connectors / QPath).
  if (summary && binary !== 'glab' && binary !== 'dws') {
    return [
      `  ↳ ${name} 已连接：${summary}` +
        (skillSlug ? `；细节 Skill("${skillSlug}")` : '') +
        '；勿让用户手装 CLI。',
    ];
  }

  if (binary === 'glab') {
    const host = serverUrl ? hostnameFromServerUrl(serverUrl) : '';
    return [
      `  ↳ ${name} 已连接${serverUrl ? `（${serverUrl}）` : ''}：` +
        '直接用 `glab`/`git`，勿问域名或 Token，勿访问 gitlab.com。' +
        (host ? `环境已指向 ${host}。` : ''),
    ];
  }
  if (binary === 'dws') {
    return [`  ↳ ${name} 已连接：可用 dws 查通讯录、发消息等；细节 Skill("dws")`];
  }
  if (skillSlug) {
    return [
      `  ↳ ${name} 已连接：可用 ${binary || 'CLI'}；细节 Skill("${skillSlug}")；勿让用户手装 CLI。`,
    ];
  }
  return [];
}

function buildConnectGuidanceLines(): string[] {
  return [
    '连接器操作指引（重要）：',
    '- 上表「未连接 / 已安装未连接」的连接器：**禁止**自行安装 CLI、执行 login/auth、索要 Token/密码。',
    '- 用户请求钉钉/通讯录/发消息、GitLab、qpath 等能力且对应项未连接时：**禁止调用 exec/bash/shell 或任何工具**（含 which、find、openclaw --help 等探测）；**直接回复用户**一句话说明需先连接，并提供链接；勿多轮试错。',
    `- 必须引导用户连接：[打开「技能 → 连接器」](${SKILL_PLAZA_CONNECTORS_HREF})`,
    '- 用户连接完成后，再继续原任务；已连接项可用 Skill(slug) 加载 detail skill，勿声称未配置。',
  ];
}

/** @deprecated alias — builds connector-index prompt */
export function buildConnectedConnectorsAgentPrompt(): string {
  return buildConnectorIndexAgentPrompt();
}

export function buildConnectorIndexAgentPrompt(): string {
  const catalog = getConnectorService().getCachedCatalog();
  const connectedIds = new Set(listConnectedConnectorIds());
  const lines: string[] = [
    CONNECTOR_AGENT_CONTEXT_MARKER,
    '连接器清单（服务端目录 + 本机状态；非完整 skill，细节按需 Skill(slug) 加载）：',
  ];

  if (catalog.length === 0) {
    lines.push('- （暂无可见连接器，请打开「技能 → 连接器」查看）');
  } else {
    for (const descriptor of catalog) {
      lines.push(buildIndexLine(descriptor));
      if (connectedIds.has(descriptor.id)) {
        lines.push(...buildConnectedExtraLines(descriptor));
      }
    }
  }

  const disconnectedWithSkill = catalog.filter((d) => {
    const status = resolveLocalStatus(d);
    return status !== 'connected' && resolveConnectorAgentSkill(d.agent)?.slug;
  });
  if (disconnectedWithSkill.length > 0) {
    const names = disconnectedWithSkill.map((d) => d.name || d.id).join('、');
    lines.push(`当前未连接（不可调用 detail skill / CLI）：${names}。`);
  }

  lines.push(...buildConnectGuidanceLines());
  return lines.join('\n');
}

/** Persist connector-index for OpenClaw gateway plugin dynamic appendSystemContext. */
export function persistConnectedConnectorsAgentPrompt(): void {
  const prompt = buildConnectorIndexAgentPrompt();
  const dir = connectorsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getConnectedConnectorsAgentContextPath(), prompt ? `${prompt}\n` : '', 'utf8');
}
