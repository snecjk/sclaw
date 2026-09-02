import { StoSsoAuthError } from './errors';
import type {
  StoSsoAuthConfig,
  StoSsoDeployEnv,
  StoSsoEnvironment,
  StoSsoSiteAuthConfig,
} from './types';

declare global {
  interface Window {
    __STO_SSO_AUTH_CONFIG__?: unknown;
  }
}

const ROOT_FIELDS = new Set([
  'protocolVersion',
  'applicationId',
  'pageType',
  'runtimeMode',
  'deployEnv',
  'sso',
]);
const SSO_FIELDS = new Set([
  'environment',
  'systemCode',
  'loginOrigin',
  'apiOrigin',
]);
const DEPLOY_ENVIRONMENTS = new Set<StoSsoDeployEnv>(['daily', 'stage', 'online']);
const SSO_ENVIRONMENTS = new Set<StoSsoEnvironment>(['daily', 'pre', 'prod']);
const APPROVED_SSO_CONFIG: Record<StoSsoDeployEnv, {
  environment: StoSsoEnvironment;
  systemCode: 'STO_CLAW_APP';
  loginOrigin: string;
  apiOrigin: string;
}> = {
  daily: {
    environment: 'daily',
    systemCode: 'STO_CLAW_APP',
    loginOrigin: 'https://baseinfo-usercenterserviceapi-hq-test.sto.cn',
    apiOrigin: 'https://baseinfo-usercenterapi-test.sto.cn',
  },
  stage: {
    environment: 'pre',
    systemCode: 'STO_CLAW_APP',
    loginOrigin: 'https://pre-baseinfo-usercenterservice-api-hq.sto.cn',
    apiOrigin: 'https://pre-baseinfo-usercenterapi.sto.cn',
  },
  online: {
    environment: 'prod',
    systemCode: 'STO_CLAW_APP',
    loginOrigin: 'https://baseinfo-usercenterserviceapi.sto.cn',
    apiOrigin: 'https://baseinfo-usercenterapi.sto.cn',
  },
};

function invalid(message: string): never {
  throw new StoSsoAuthError('SSO_AUTH_CONFIG_INVALID', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertKnownFields(value: Record<string, unknown>, allowed: Set<string>): void {
  const unknownField = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownField) invalid(`SSO Auth 配置包含未知字段：${unknownField}`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid(`SSO Auth 配置字段 ${field} 不能为空`);
  }
  return value.trim();
}

function resolveInput(explicit?: unknown): unknown {
  if (explicit !== undefined) return explicit;
  if (typeof window === 'undefined') return undefined;
  if (window.__STO_SSO_AUTH_CONFIG__ !== undefined) return window.__STO_SSO_AUTH_CONFIG__;

  const hostname = window.location.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return undefined;
  }

  return {
    protocolVersion: 'sto-sso-auth/v1',
    pageType: 'site',
    runtimeMode: 'published',
    deployEnv: resolveStoSsoDeployEnv(hostname),
  };
}

export function resolveStoSsoDeployEnv(hostname?: string): StoSsoDeployEnv {
  const host = (hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '')).toLowerCase();
  if (host.includes('test') || host.includes('daily')) return 'daily';
  if (host.includes('pre')) return 'stage';
  return 'online';
}

export function readStoSsoAuthConfig(explicit?: unknown): StoSsoAuthConfig {
  const input = resolveInput(explicit);
  if (input === undefined) {
    throw new StoSsoAuthError('SSO_AUTH_CONFIG_MISSING', '缺少 SSO Auth 配置');
  }
  if (!isRecord(input)) invalid('SSO Auth 配置必须是对象');
  assertKnownFields(input, ROOT_FIELDS);

  if (input.protocolVersion !== 'sto-sso-auth/v1') invalid('不支持的 SSO Auth 协议版本');

  const applicationId = input.applicationId === undefined
    ? undefined
    : requiredString(input.applicationId, 'applicationId');
  if (input.runtimeMode !== 'local' && input.runtimeMode !== 'published') {
    invalid('runtimeMode 必须是 local 或 published');
  }
  const deployEnv = input.deployEnv === undefined || input.deployEnv === 'auto'
    ? resolveStoSsoDeployEnv()
    : input.deployEnv as StoSsoDeployEnv;
  if (!DEPLOY_ENVIRONMENTS.has(deployEnv)) {
    invalid('deployEnv 必须是 daily、stage 或 online');
  }

  const pageType = input.pageType === undefined ? 'site' : input.pageType;
  if (pageType !== 'site' && pageType !== 'assets') {
    throw new StoSsoAuthError('SSO_AUTH_PAGE_TYPE_UNSUPPORTED', 'SSO Auth 插件不支持当前应用类型');
  }
  if (pageType === 'assets') {
    if (!applicationId) invalid('Assets 本地开发必须提供 applicationId');
    if (input.runtimeMode !== 'local' || deployEnv !== 'daily' || input.sso !== undefined) {
      throw new StoSsoAuthError(
        'SSO_AUTH_PAGE_TYPE_UNSUPPORTED',
        'Assets 仅支持使用 SClaw 当前身份进行本地预览',
      );
    }
    return {
      protocolVersion: 'sto-sso-auth/v1',
      applicationId: applicationId!,
      pageType: 'assets',
      runtimeMode: 'local',
      deployEnv: 'daily',
    };
  }

  let sso: StoSsoSiteAuthConfig['sso'];
  if (input.sso !== undefined) {
    if (!isRecord(input.sso)) invalid('sso 必须是对象');
    assertKnownFields(input.sso, SSO_FIELDS);
    if (!SSO_ENVIRONMENTS.has(input.sso.environment as StoSsoEnvironment)) {
      invalid('sso.environment 必须是 daily、pre 或 prod');
    }
    const approved = APPROVED_SSO_CONFIG[deployEnv];
    if (
      input.sso.environment !== approved.environment
      || input.sso.systemCode !== approved.systemCode
      || input.sso.loginOrigin !== approved.loginOrigin
      || input.sso.apiOrigin !== approved.apiOrigin
    ) {
      invalid('SSO 配置不符合已批准的发布环境矩阵');
    }
    sso = { ...approved };
  } else if (input.runtimeMode === 'published') {
    sso = { ...APPROVED_SSO_CONFIG[deployEnv] };
  }

  return {
    protocolVersion: 'sto-sso-auth/v1',
    ...(applicationId ? { applicationId } : {}),
    pageType: 'site',
    runtimeMode: input.runtimeMode,
    deployEnv,
    ...(sso ? { sso } : {}),
  };
}
