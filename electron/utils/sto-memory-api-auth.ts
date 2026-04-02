/**
 * AI Memory Center HTTP 鉴权头，与拉取模型列表（/agent/v1/models）一致：
 * stotoken + Authorization: Bearer，供 memory-center 校验 stoToken。
 */
export function buildStoMemoryCenterAuthHeaders(token: string): Record<string, string> {
  return {
    stotoken: token,
    Authorization: `Bearer ${token}`,
  };
}
