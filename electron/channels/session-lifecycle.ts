import { getBaseAgentIdFromProjectAgentId } from '../../shared/project-agent';
import { buildChannelSessionKey, type PlatformChannelType } from './session-key';

const DEFAULT_CHANNEL_SESSION_IDLE_HOURS = 24;
const MIN_CHANNEL_SESSION_IDLE_HOURS = 1;
const MAX_CHANNEL_SESSION_IDLE_HOURS = 168; // 7 days
/** mobile：App 显式新建；无空闲自动拆会话（与对接文档一致，靠 sessionKey 空/有） */
const MOBILE_SESSION_IDLE_TTL_MS = Number.POSITIVE_INFINITY;

const NEW_SESSION_COMMANDS = new Set([
  '新对话',
  '新会话',
  '清空上下文',
  '/new',
  '/reset',
]);

/** 整句自然说法：开一个新会话 / 请新建对话 / 帮我清空上下文 等 */
const NEW_SESSION_NATURAL_RE = /^(?:请|帮我|麻烦)?(?:开|开启|创建|新建|换|开始)?(?:一)?(?:个)?新?(?:对话|会话)$/;
const CLEAR_CONTEXT_NATURAL_RE = /^(?:请|帮我|麻烦)?(?:清空|清除)(?:一下)?(?:上下文|会话|对话)$/;
const NEW_SESSION_SLASH_RE = /^\/(?:new|reset)$/;

export function clampChannelSessionIdleHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_CHANNEL_SESSION_IDLE_HOURS;
  return Math.min(
    MAX_CHANNEL_SESSION_IDLE_HOURS,
    Math.max(MIN_CHANNEL_SESSION_IDLE_HOURS, Math.floor(hours)),
  );
}

/**
 * 平台 Channel 空闲 TTL。
 * - mobile：永不因空闲拆分
 * - 关闭开关：永不因空闲拆分
 * - 开启：hours（默认 24）
 */
export function resolveChannelIdleTtlMs(input: {
  channelType: PlatformChannelType;
  idleEnabled?: boolean;
  idleHours?: number;
}): number {
  if (input.channelType === 'mobile') return MOBILE_SESSION_IDLE_TTL_MS;
  if (input.idleEnabled === false) return MOBILE_SESSION_IDLE_TTL_MS;
  const hours = clampChannelSessionIdleHours(
    input.idleHours ?? DEFAULT_CHANNEL_SESSION_IDLE_HOURS,
  );
  return hours * 60 * 60 * 1000;
}

export function buildNewChannelSessionKey(
  channelType: PlatformChannelType,
  agentId: string,
  peerId: string,
  startedAt = new Date(),
  nonce?: string,
): string {
  return buildChannelSessionKey(channelType, agentId, peerId, startedAt, nonce);
}

export function buildNewDingTalkSessionKey(
  agentId: string,
  peerId: string,
  startedAt = new Date(),
  nonce?: string,
): string {
  return buildNewChannelSessionKey('dingtalk', agentId, peerId, startedAt, nonce);
}

export function shouldStartNewChannelSession(input: {
  channelType: PlatformChannelType;
  nowMs: number;
  lastActivityAt?: string | null;
  forceNew?: boolean;
  /** 覆盖空闲 TTL；不传则用通道默认（钉钉 24h / mobile 永不） */
  idleTtlMs?: number;
}): boolean {
  if (input.forceNew) return true;
  if (!input.lastActivityAt) return true;
  const ttl = input.idleTtlMs ?? resolveChannelIdleTtlMs({ channelType: input.channelType });
  if (!Number.isFinite(ttl)) return false;
  const lastActivityMs = Date.parse(input.lastActivityAt);
  if (!Number.isFinite(lastActivityMs)) return true;
  return input.nowMs - lastActivityMs >= ttl;
}

export function shouldStartNewDingTalkSession(input: {
  nowMs: number;
  lastActivityAt?: string | null;
  forceNew?: boolean;
  idleTtlMs?: number;
}): boolean {
  return shouldStartNewChannelSession({
    channelType: 'dingtalk',
    ...input,
  });
}

/**
 * 策略 C：改选脑后不得复用旧 sessionKey，也不得用新引擎改写旧 registry。
 * 仅当 registry 已登记引擎且与当前 Binding 不一致时强制新建。
 */
export function shouldForceNewDingTalkSessionForEngine(input: {
  forceNew?: boolean;
  boundEngineType: 'claude' | 'openclaw' | 'pi';
  registeredEngineType?: 'claude' | 'openclaw' | 'pi' | null;
}): boolean {
  if (input.forceNew) return true;
  const registered = input.registeredEngineType;
  if (registered === 'claude' || registered === 'openclaw' || registered === 'pi') {
    return registered !== input.boundEngineType;
  }
  return false;
}

export function resolveChannelSessionKey(input: {
  channelType: PlatformChannelType;
  agentId: string;
  peerId: string;
  now?: Date;
  latestSession?: {
    sessionKey: string;
    lastActivityAt?: string | null;
  } | null;
  forceNew?: boolean;
  nonce?: string;
  idleTtlMs?: number;
}): string {
  const now = input.now ?? new Date();
  if (
    input.latestSession
    && !shouldStartNewChannelSession({
      channelType: input.channelType,
      nowMs: now.getTime(),
      lastActivityAt: input.latestSession.lastActivityAt,
      forceNew: input.forceNew,
      idleTtlMs: input.idleTtlMs,
    })
  ) {
    return input.latestSession.sessionKey;
  }
  return buildNewChannelSessionKey(
    input.channelType,
    input.agentId,
    input.peerId,
    now,
    input.nonce,
  );
}

export function resolveDingTalkSessionKey(input: {
  agentId: string;
  peerId: string;
  now?: Date;
  latestSession?: {
    sessionKey: string;
    lastActivityAt?: string | null;
  } | null;
  forceNew?: boolean;
  nonce?: string;
  idleTtlMs?: number;
}): string {
  return resolveChannelSessionKey({
    channelType: 'dingtalk',
    ...input,
  });
}

export function isDingTalkNewSessionCommand(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[!！.。？?]+$/u, '');
  if (!normalized) return false;
  if (NEW_SESSION_COMMANDS.has(normalized)) return true;
  if (NEW_SESSION_SLASH_RE.test(normalized)) return true;
  // 中文指令不做 toLowerCase 语义变化，但仍用 normalized（去首尾标点）
  return NEW_SESSION_NATURAL_RE.test(normalized)
    || CLEAR_CONTEXT_NATURAL_RE.test(normalized);
}

/**
 * Channel 会话只用 base agentId，避免 sessionKey 带上 proj-… 后
 * 切会话时 currentAgentId 命中输入框「· 项目名」规则。
 */
export function resolveChannelBaseAgentId(rawAgentId: string | null | undefined): string {
  const trimmed = (rawAgentId || 'main').trim().toLowerCase() || 'main';
  return getBaseAgentIdFromProjectAgentId(trimmed) ?? trimmed;
}
