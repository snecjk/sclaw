import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { trackUiEvent } from '@/lib/telemetry';
import { hostApiFetch } from '@/lib/host-api';

interface TokenQuotaDialogProps {
  open: boolean;
  onClose: () => void;
  tokenId: string;
  spend: number;
  maxBudget: number;
}

interface QuotaTier {
  name: string;
  amount: number;
  approvers: string | null;
  recommended?: boolean;
}

const QUOTA_TIERS: QuotaTier[] = [
  { name: '经典版', amount: 200, approvers: null, recommended: true },
  { name: '畅行版', amount: 400, approvers: null },
  { name: '优享版', amount: 600, approvers: '直属主管' },
  { name: '高能版', amount: 800, approvers: '直属主管 + 上一级领导' },
  { name: '旗舰版', amount: 1000, approvers: '直属主管 + 上一级领导 + CTO' },
  { name: '荣耀版', amount: 1200, approvers: '直属主管 + 上一级领导 + CTO' },
  { name: '至尊版', amount: 1400, approvers: null },
  { name: '', amount: 1600, approvers: null },
  { name: '', amount: 1800, approvers: null },
  { name: '', amount: 2000, approvers: null },
];

export function TokenQuotaDialog({ open, onClose, tokenId, spend, maxBudget }: TokenQuotaDialogProps) {
  const { t } = useTranslation('dashboard');
  const [applying, setApplying] = useState<number | null>(null);

  if (!open) return null;

  const available = Math.max(0, maxBudget - spend);

  // TODO: 后续从接口获取真实数据
  const expansionCount = 0;
  const totalExpanded = 0;
  const nextResetDate = '2026-06-01 00:00:00';

  const handleApply = async (tier: QuotaTier) => {
    if (!tokenId || applying !== null) return;
    setApplying(tier.amount);
    trackUiEvent('models.token_quota_apply', { amount: tier.amount });
    try {
      await hostApiFetch('/api/token-quota/expansion', {
        method: 'POST',
        body: JSON.stringify({ tokenId, quotaAmount: tier.amount }),
      });
      trackUiEvent('models.token_quota_apply_success', { amount: tier.amount });
    } catch (error) {
      trackUiEvent('models.token_quota_apply_failed', {
        amount: tier.amount,
        error: error instanceof Error ? error.message : String(error),
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm dark:bg-black/60"
      role="dialog"
      aria-modal="true"
      onKeyDown={handleKeyDown}
    >
      <div className="mx-auto w-full max-w-3xl rounded-xl border border-glass-border bg-white shadow-2xl dark:bg-[hsl(var(--glass-bg))]">
        {/* Header */}
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

        {/* Info bar */}
        <div className="grid grid-cols-3 gap-4 bg-muted/40 px-6 py-4 text-sm">
          <div>
            <p className="text-muted-foreground">{t('tokenQuotaDialog.totalQuota', '总额度')}</p>
            <p className="font-semibold text-foreground">¥{maxBudget.toFixed(2)}</p>
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
            <p className="text-muted-foreground">{t('tokenQuotaDialog.nextReset', '下次重置时间')}</p>
            <p className="font-semibold text-foreground">{nextResetDate}</p>
          </div>
        </div>

        {/* Tiers */}
        <div className="px-6 py-5">
          <div className="grid grid-cols-3 gap-4">
            {QUOTA_TIERS.slice(0, 3).map((tier) => (
              <TierCard
                key={tier.amount}
                tier={tier}
                currentMax={maxBudget}
                onApply={handleApply}
                applying={applying}
              />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4">
            {QUOTA_TIERS.slice(3, 6).map((tier) => (
              <TierCard
                key={tier.amount}
                tier={tier}
                currentMax={maxBudget}
                onApply={handleApply}
                applying={applying}
              />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-4 gap-4">
            {QUOTA_TIERS.slice(6).map((tier) => (
              <TierCard
                key={tier.amount}
                tier={tier}
                currentMax={maxBudget}
                onApply={handleApply}
                applying={applying}
              />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TierCard({
  tier,
  currentMax,
  onApply,
  applying,
}: {
  tier: QuotaTier;
  currentMax: number;
  onApply: (t: QuotaTier) => void;
  applying: number | null;
}) {
  const { t } = useTranslation('dashboard');
  const isCurrent = currentMax === tier.amount;
  const isApplying = applying === tier.amount;

  // 当前额度档位 → 已申请；下一个档位 → 可申请；其余 → 暂不可申请
  const sortedAmounts = [...new Set(QUOTA_TIERS.map((t) => t.amount))].sort((a, b) => a - b);
  const currentIndex = sortedAmounts.indexOf(currentMax);
  const tierIndex = sortedAmounts.indexOf(tier.amount);

  let status: 'applied' | 'available' | 'unavailable';
  if (isCurrent) {
    status = 'applied';
  } else if (currentIndex >= 0 && tierIndex === currentIndex + 1) {
    status = 'available';
  } else {
    status = 'unavailable';
  }

  return (
    <div
      className={cn(
        'relative rounded-lg border p-4 text-center transition-shadow',
        status === 'available'
          ? 'border-orange-200 bg-orange-50/50 dark:border-orange-900/30 dark:bg-orange-900/10'
          : 'border-border bg-white/60 dark:bg-[hsl(var(--glass-bg)/0.2)]',
      )}
    >
      {tier.recommended && (
        <div className="absolute -top-2 -right-2 rounded-sm bg-green-500 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm">
          {t('tokenQuotaDialog.recommended', '推荐')}
        </div>
      )}
      {tier.name ? (
        <p className="text-sm font-medium text-foreground">{tier.name}</p>
      ) : (
        <p className="text-sm font-medium text-transparent">&nbsp;</p>
      )}
      <p
        className={cn(
          'mt-1 text-2xl font-bold',
          status === 'available' ? 'text-orange-500' : 'text-foreground',
        )}
      >
        ¥{tier.amount.toFixed(2)}
      </p>
      {tier.approvers ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{tier.approvers}</p>
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
            disabled={isApplying}
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
