/**
 * Token 额度档位查询（queryTokenQuotaTier）共享类型
 * 非网点网关 API 响应结构
 */

export interface TokenQuotaTierItem {
  quotaAmount: number | null;
  tierName: string | null;
  needApproval: boolean;
  level: number;
  approverDesc: string | null;
  isDefault: boolean;
  applied: boolean;
  children: TokenQuotaTierItem[] | null;
}

export interface TokenQuotaTierQueryResult {
  tierList: TokenQuotaTierItem[];
  currentTier: string | null;
  currentQuota: number;
  totalExpandedQuota: number;
}
