/**
 * 用户个人 SK 管理服务
 * 登录后从申通内部接口动态获取，作为 STO AI provider 的调用密钥
 * 支持"查无则创"：查询无 SK 时自动调用创建接口
 */

import { getStoToken, getSsoEnvironment } from '../utils/auth-store';
import { storeApiKey, getApiKey, deleteApiKey } from '../utils/secure-storage';
import { logger } from '../utils/logger';
import crypto from 'crypto';

const SK_PROVIDER_ID = 'sto';

// SK 查询/创建接口域名（带 api 前缀）
const SK_API_DOMAINS: Record<string, string> = {
  prod: 'https://devops-llmgatewayapi.sto.cn',
  test: 'https://devops-llmgatewayapi-test.sto.cn',
};

function isTestEnvironment(env?: string | null): boolean {
  const normalized = env?.trim().toLowerCase() || '';
  return ['test', 'pre-release', 'daily', 'daily-external'].some(
    (e) => normalized.includes(e)
  );
}

async function resolveSkApiDomain(): Promise<string> {
  const env = await getSsoEnvironment();
  return isTestEnvironment(env) ? SK_API_DOMAINS.test : SK_API_DOMAINS.prod;
}

interface SkDetailResponse {
  code: string;
  msg: string;
  detailMsg?: string;
  data?: Array<{
    tokenId: string;
    keyAlias: string;
    userCode: string;
    userName: string;
    models: string[];
    status: string;
    encryptedKey: string;
    spend?: number;
    maxBudget?: number;
    expires?: string | null;
    createdAt?: string;
  }>;
  ext?: unknown;
}

async function fetchSkFromApi(
  type: 'query' | 'create',
  token: string,
  userCode: string,
): Promise<string | null> {
  const domain = await resolveSkApiDomain();
  const path = type === 'create' ? '/openapi/key/create' : '/openapi/key/detail';
  const url = `${domain}${path}`;

  const secretHeader = crypto.createHash('md5').update(userCode).digest('hex');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        secret: secretHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userCode }),
    });

    if (!response.ok) {
      logger.warn(`[user-sk] ${type} HTTP failed: ${response.status}`);
      return null;
    }

    const json = await response.json() as SkDetailResponse;

    if (json.code !== '0') {
      if (type === 'query') {
        logger.info(`[user-sk] ${type} biz code=${json.code}, msg=${json.msg}`);
        return null;
      }
      logger.warn(`[user-sk] ${type} biz failed: ${json.code} ${json.msg}`);
      return null;
    }

    const sk = json.data?.[0]?.encryptedKey;
    if (!sk) {
      logger.warn(`[user-sk] ${type} response missing encryptedKey`);
      return null;
    }

    return sk;
  } catch (err) {
    logger.warn(`[user-sk] ${type} error:`, err);
    return null;
  }
}

/**
 * 获取用户个人 SK（优先读缓存 → 查询 → 查无则创建）
 */
export async function getUserSk(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh) {
    const cached = await getApiKey(SK_PROVIDER_ID);
    if (cached) return cached;
  }

  // 从 auth store 读取用户信息
  const { getAuthState } = await import('../utils/auth-store');
  const authState = await getAuthState();
  const userCode = authState.user?.code || '';
  if (!userCode) {
    logger.warn('[user-sk] No userCode available');
    return null;
  }

  const token = await getStoToken();
  if (!token) return null;

  // Step 1: 查询
  let sk = await fetchSkFromApi('query', token, userCode);

  // Step 2: 没有则创建
  if (!sk) {
    logger.info('[user-sk] SK not found, creating...');
    sk = await fetchSkFromApi('create', token, userCode);
    if (sk) {
      logger.info('[user-sk] SK created successfully');
    }
  }

  if (sk) {
    await storeApiKey(SK_PROVIDER_ID, sk);
    logger.info('[user-sk] User SK fetched and stored');
  }

  return sk;
}

/**
 * 登出时清理用户 SK
 */
export async function clearUserSk(): Promise<void> {
  await deleteApiKey(SK_PROVIDER_ID);
  logger.info('[user-sk] User SK cleared');
}
