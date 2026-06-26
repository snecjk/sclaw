import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { trackUiEvent } from '@/lib/telemetry';
import { hostApiFetch } from '@/lib/host-api';
import type { TokenQuotaTierItem, TokenQuotaTierQueryResult } from '../../../shared/sto-token-quota-tier';
import { FeedbackState } from '@/components/common/FeedbackState';

interface TokenQuotaDialogProps {
  open: boolean;
  onClose: () => void;
  tokenId: string;
  spend: number;
  maxBudget: number;
  onQuotaChanged?: () => void;
}

type TierFetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; data: TokenQuotaTierQueryResult }
  | { status: 'error' };

function partitionTierLayout(tierList: TokenQuotaTierItem[]): {
  flatTiers: TokenQuotaTierItem[];
  childGroups: TokenQuotaTierItem[][];
} {
  const flatTiers: TokenQuotaTierItem[] = [];
  const childGroups: TokenQuotaTierItem[][] = [];
  for (const tier of tierList) {
    if (tier.children && tier.children.length > 0) {
      childGroups.push(tier.children);
    } else {
      flatTiers.push(tier);
    }
  }
  return { flatTiers, childGroups };
}

function flattenDisplayTiers(tierList: TokenQuotaTierItem[]): TokenQuotaTierItem[] {
  const result: TokenQuotaTierItem[] = [];
  for (const tier of tierList) {
    if (tier.children && tier.children.length > 0) {
      result.push(...tier.children);
    } else {
      result.push(tier);
    }
  }
  return result;
}

function findAvailableQuotaAmount(tiers: TokenQuotaTierItem[]): number | null {
  for (const tier of tiers) {
    if (!tier.applied && tier.quotaAmount != null) {
      return tier.quotaAmount;
    }
  }
  return null;
}

function countAppliedExpansions(tierList: TokenQuotaTierItem[]): number {
  return flattenDisplayTiers(tierList).filter((tier) => tier.applied && !tier.isDefault).length;
}

function tierKey(tier: TokenQuotaTierItem): string {
  return `${tier.level}-${tier.quotaAmount ?? 'default'}`;
}

export function TokenQuotaDialog({
  open,
  onClose,
  tokenId,
  spend,
  maxBudget,
  onQuotaChanged,
}: TokenQuotaDialogProps) {
  const { t } = useTranslation('dashboard');
  const [applying, setApplying] = useState<number | null>(null);
  const [fetchState, setFetchState] = useState<TierFetchState>({ status: 'idle' });

  const loadTiers = useCallback(async () => {
    if (!tokenId) {
      setFetchState({ status: 'error' });
      return;
    }
    setFetchState({ status: 'loading' });
    try {
      const data = await hostApiFetch<TokenQuotaTierQueryResult | null>(
        `/api/token-quota/tiers?tokenId=${encodeURIComponent(tokenId)}`,
      );
      if (!data?.tierList?.length) {
        setFetchState({ status: 'error' });
        return;
      }
      setFetchState({ status: 'done', data });
    } catch {
      setFetchState({ status: 'error' });
    }
  }, [tokenId]);

  useEffect(() => {
    if (!open) {
      setFetchState({ status: 'idle' });
      setApplying(null);
      return;
    }
    void loadTiers();
  }, [open, loadTiers]);

  const tierData = fetchState.status === 'done' ? fetchState.data : null;
  const tierList = tierData?.tierList ?? [];

  const displayTiers = useMemo(() => flattenDisplayTiers(tierList), [tierList]);
  const availableAmount = useMemo(() => findAvailableQuotaAmount(displayTiers), [displayTiers]);
  const { flatTiers, childGroups } = useMemo(() => partitionTierLayout(tierList), [tierList]);

  const totalQuota = tierData?.currentQuota ?? maxBudget;
  const available = Math.max(0, totalQuota - spend);
  const totalExpanded = tierData?.totalExpandedQuota ?? 0;
  const expansionCount = tierList.length > 0 ? countAppliedExpansions(tierList) : 0;

  const handleApply = async (tier: TokenQuotaTierItem) => {
    if (!tokenId || applying !== null || tier.quotaAmount == null || fetchState.status !== 'done') return;
    setApplying(tier.quotaAmount);
    trackUiEvent('models.token_quota_apply', { amount: tier.quotaAmount });
    try {
      await hostApiFetch('/api/token-quota/expansion', {
        method: 'POST',
        body: JSON.stringify({
          tokenId,
          quotaAmount: tier.quotaAmount,
          clientEventId: `models_token_quota_apply_${Date.now()}`,
          tier,
          tierContext: fetchState.data,
        }),
      });
      trackUiEvent('models.token_quota_apply_success', { amount: tier.quotaAmount });
      toast.success(t('tokenQuotaDialog.applySuccess', '申请成功'));
      onQuotaChanged?.();
      await loadTiers();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
      trackUiEvent('models.token_quota_apply_failed', {
        amount: tier.quotaAmount,
        error: message,
      });
    } finally {
      setApplying(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm dark:bg-black/60"
      role="dialog"
      aria-modal="true"
      onKeyDown={handleKeyDown}
    >
      <div className="mx-auto w-full max-w-3xl rounded-xl border border-glass-border bg-white shadow-2xl dark:bg-[hsl(var(--glass-bg))]">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t('tokenQuotaDialog.title', '申请扩容')}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-md"
            onClick={onClose}
            aria-label={t('tokenQuotaDialog.close', '关闭')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4 bg-muted/40 px-6 py-4 text-sm">
          <div>
            <p className="text-muted-foreground">{t('tokenQuotaDialog.totalQuota', '总额度')}</p>
            <p className="font-semibold text-foreground">¥{totalQuota.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t('tokenQuotaDialog.used', '已使用')}</p>
            <p className="font-semibold text-foreground">¥{spend.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t('tokenQuotaDialog.remaining', '剩余')}</p>
            <p className="font-semibold text-foreground">¥{available.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t('tokenQuotaDialog.expansionCount', '已扩容次数')}</p>
            <p className="font-semibold text-foreground">{expansionCount}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t('tokenQuotaDialog.totalExpanded', '累计扩容额度')}</p>
            <p className="font-semibold text-foreground">¥{totalExpanded.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t('tokenQuotaDialog.currentTier', '当前档位')}</p>
            <p className="font-semibold text-foreground">{tierData?.currentTier || '--'}</p>
          </div>
        </div>

        <div className="px-6 py-5">
          {fetchState.status === 'loading' && (
            <div className="flex items-center justify-center py-12">
              <FeedbackState state="loading" title={t('tokenQuotaDialog.loading', '正在加载档位信息...')} />
            </div>
          )}
          {fetchState.status === 'error' && (
            <div className="flex items-center justify-center py-12">
              <FeedbackState state="empty" title={t('tokenQuotaDialog.noTiers', '暂无档位信息')} />
            </div>
          )}
          {fetchState.status === 'done' && (
            <>
              {Array.from({ length: Math.ceil(flatTiers.length / 3) }, (_, rowIndex) => (
                <div key={`row-${rowIndex}`} className={cn('grid grid-cols-3 gap-4', rowIndex > 0 && 'mt-4')}>
                  {flatTiers.slice(rowIndex * 3, rowIndex * 3 + 3).map((tier) => (
                    <TierCard
                      key={tierKey(tier)}
                      tier={tier}
                      availableAmount={availableAmount}
                      onApply={handleApply}
                      applying={applying}
                    />
                  ))}
                </div>
              ))}
              {childGroups.map((children, groupIndex) => (
                <div key={`children-${groupIndex}`} className="mt-4 grid grid-cols-4 gap-4">
                  {children.map((tier) => (
                    <TierCard
                      key={tierKey(tier)}
                      tier={tier}
                      availableAmount={availableAmount}
                      onApply={handleApply}
                      applying={applying}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TierCard({
  tier,
  availableAmount,
  onApply,
  applying,
}: {
  tier: TokenQuotaTierItem;
  availableAmount: number | null;
  onApply: (t: TokenQuotaTierItem) => void;
  applying: number | null;
}) {
  const { t } = useTranslation('dashboard');
  const isApplying = tier.quotaAmount != null && applying === tier.quotaAmount;

  let status: 'applied' | 'available' | 'unavailable';
  if (tier.applied) {
    status = 'applied';
  } else if (tier.quotaAmount != null && tier.quotaAmount === availableAmount) {
    status = 'available';
  } else {
    status = 'unavailable';
  }

  const displayAmount = tier.quotaAmount;
  const showAmount = displayAmount != null;
  const displayTierName = tier.tierName?.trim()
    || t('tokenQuotaDialog.defaultTierName', '默认套餐');

  return (
    <div
      className={cn(
        'relative rounded-lg border p-4 text-center transition-shadow',
        status === 'available'
          ? 'border-orange-200 bg-orange-50/50 dark:border-orange-900/30 dark:bg-orange-900/10'
          : 'border-border bg-white/60 dark:bg-[hsl(var(--glass-bg)/0.2)]',
      )}
    >
      {tier.isDefault && (
        <div className="absolute -top-2 -right-2 rounded-sm bg-green-500 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm">
          {t('tokenQuotaDialog.recommended', '推荐')}
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{displayTierName}</p>
      {showAmount ? (
        <p
          className={cn(
            'mt-1 text-2xl font-bold',
            status === 'available' ? 'text-orange-500' : 'text-foreground',
          )}
        >
          ¥{displayAmount.toFixed(2)}
        </p>
      ) : (
        <p className="mt-1 text-2xl font-bold text-muted-foreground">--</p>
      )}
      {tier.needApproval && tier.approverDesc ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{tier.approverDesc}</p>
      ) : (
        <p className="mt-1 text-[11px] text-transparent">&nbsp;</p>
      )}
      <div className="mt-3">
        {status === 'applied' && (
          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-md border-border bg-transparent text-[12px] text-muted-foreground"
            disabled
          >
            {t('tokenQuotaDialog.applied', '已申请')}
          </Button>
        )}
        {status === 'available' && (
          <Button
            size="sm"
            className="w-full rounded-md bg-orange-500 text-[12px] text-white hover:bg-orange-600"
            onClick={() => onApply(tier)}
            disabled={isApplying || tier.quotaAmount == null}
          >
            {isApplying ? t('tokenQuotaDialog.applying', '申请中...') : t('tokenQuotaDialog.applyNow', '立即申请')}
          </Button>
        )}
        {status === 'unavailable' && (
          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-md border-border bg-transparent text-[12px] text-muted-foreground"
            disabled
          >
            {t('tokenQuotaDialog.unavailable', '暂不可申请')}
          </Button>
        )}
      </div>
    </div>
  );
}
