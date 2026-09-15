/**
 * 网关模型列表查询（不区分总部/网点）。
 *
 * 调用 memory-center 代理接口 GET /agent/v1/gateway-models，
 * 返回完整模型元数据（含 inputContent、maxContextWindow、priceConfig 等）。
 */

import { logger } from '../utils/logger';
import {
  memoryCenterFetchForAi,
  StoMemoryApiError,
} from './sto-memory-api-fetch';

const GATEWAY_MODELS_PATH = '/agent/v1/gateway-models';

/** 网关返回的单条模型详情 */
export interface GatewayModelDetail {
  model: string;
  category?: string;
  inputTokenPrice?: string;
  outputTokenPrice?: string;
  ability?: string;
  inputContent?: string;
  outPutContent?: string;
  maxContextWindow?: string;
  maxOutputToken?: string;
  priceConfig?: Record<string, unknown>;
}

/**
 * 调用 /agent/v1/gateway-models 获取完整模型列表。
 * 失败时返回空数组，不抛异常。
 */
export async function fetchGatewayModels(): Promise<GatewayModelDetail[]> {
  logger.info('[GatewayModels] fetch gateway models list');

  try {
    const json = await memoryCenterFetchForAi(
      GATEWAY_MODELS_PATH,
      { method: 'GET' },
      StoMemoryApiError,
    );

    if (typeof json !== 'object' || json === null) {
      logger.warn('[GatewayModels] invalid response');
      return [];
    }

    const data = (json as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      logger.warn('[GatewayModels] data is not an array');
      return [];
    }

    return data as GatewayModelDetail[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[GatewayModels] fetch failed: ${message}`);
    return [];
  }
}

/** 将 inputContent 字符串按分隔符拆分为数组（支持 "文本"、"文本,图片" 等格式） */
export function parseInputContent(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
