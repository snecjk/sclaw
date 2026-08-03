/**
 * AI Memory Center HTTP 鉴权头，与拉取模型列表（/agent/v1/models）一致：
 * stotoken + Authorization: Bearer，供 memory-center 校验 stoToken。
 * X-SAI-Client-Id 用于技能分端（全端 + 本端可见）。
 */
import { SAI_CLIENT_ID_VALUE } from './sai-client-id';

export function buildStoMemoryCenterAuthHeaders(token: string): Record<string, string> {
  return {
    stotoken: token,
    Authorization: `Bearer ${token}`,
    'X-SAI-Client-Id': SAI_CLIENT_ID_VALUE,
  };
}
