import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, QrCode, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';

interface HubStatusResponse {
  success: boolean;
  local?: {
    bindStatus?: string;
    externalUserId?: string | null;
    engineType?: string | null;
    agentId?: string | null;
    lastOnlineAt?: string | null;
  } | null;
  ws?: { state?: string; connected?: boolean };
  remote?: { bound?: boolean; dingUserId?: string; error?: string } | null;
  deviceId?: string;
  error?: string;
}

interface DingTalkHubBindModalProps {
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
}

const outlineButtonClass =
  'h-8 rounded-md border-[#E5E6EB] bg-white px-3 text-[13px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]';
const primaryButtonClass =
  'h-8 rounded-md px-4 text-[13px] font-medium shadow-none';

function qrImageUrl(content: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(content)}`;
}

export function DingTalkHubBindModal({ onClose, onChanged }: DingTalkHubBindModalProps) {
  const { t } = useTranslation('channels');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<HubStatusResponse | null>(null);
  const [qrContent, setQrContent] = useState<string | null>(null);
  const [pollHint, setPollHint] = useState<string | null>(null);
  const [qrExpired, setQrExpired] = useState(false);
  const pollTimerRef = useRef<number | null>(null);
  const claimedRef = useRef(false);
  const autoStartedRef = useRef(false);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    const result = await hostApiFetch<HubStatusResponse>('/api/channels/hub/dingtalk/status');
    setStatus(result);
    return result;
  }, []);

  const claimTicket = useCallback(
    async (ticket: string) => {
      if (claimedRef.current) return;
      claimedRef.current = true;
      clearPoll();
      setBusy(true);
      setPollHint(t('hub.dingtalk.claiming'));
      try {
        await hostApiFetch('/api/channels/hub/dingtalk/bind/claim', {
          method: 'POST',
          body: JSON.stringify({ ticket }),
        });
        toast.success(t('hub.dingtalk.bindSuccess'));
        setQrContent(null);
        setPollHint(null);
        setQrExpired(false);
        await refreshStatus();
        await onChanged?.();
        onClose();
      } catch (error) {
        claimedRef.current = false;
        toast.error(t('hub.dingtalk.bindFailed', { error: String(error) }));
        setPollHint(null);
      } finally {
        setBusy(false);
      }
    },
    [clearPoll, onChanged, onClose, refreshStatus, t],
  );

  const startBind = useCallback(async () => {
    clearPoll();
    claimedRef.current = false;
    setBusy(true);
    setPollHint(null);
    setQrExpired(false);
    try {
      const created = await hostApiFetch<{
        success: boolean;
        bindToken?: string;
        qrContent?: string;
        error?: string;
      }>('/api/channels/hub/dingtalk/bind/create', { method: 'POST' });
      if (!created.success || !created.bindToken || !created.qrContent) {
        throw new Error(created.error || 'create bind failed');
      }
      setQrContent(created.qrContent);
      setPollHint(t('hub.dingtalk.waitingScan'));

      pollTimerRef.current = window.setInterval(() => {
        void (async () => {
          try {
            const polled = await hostApiFetch<{
              success: boolean;
              status?: string;
              ticket?: string;
            }>(
              `/api/channels/hub/dingtalk/bind/poll?bindToken=${encodeURIComponent(created.bindToken!)}`,
            );
            if (polled.status === 'confirmed' && polled.ticket) {
              await claimTicket(polled.ticket);
            } else if (polled.status === 'expired' || polled.status === 'revoked') {
              clearPoll();
              setQrExpired(true);
              setPollHint(t('hub.dingtalk.expired'));
            }
          } catch {
            // keep polling
          }
        })();
      }, 2000);
    } catch (error) {
      toast.error(t('hub.dingtalk.createFailed', { error: String(error) }));
    } finally {
      setBusy(false);
    }
  }, [claimTicket, clearPoll, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await refreshStatus();
      } catch (error) {
        if (!cancelled) {
          toast.error(t('hub.dingtalk.statusFailed', { error: String(error) }));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      clearPoll();
    };
  }, [clearPoll, refreshStatus, t]);

  // 编辑 = 重新绑定：无论当前是否已绑定，都直接拉起扫码
  useEffect(() => {
    if (loading || status == null) return;
    if (qrContent || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void startBind();
  }, [loading, qrContent, startBind, status]);

  const alreadyBound = status?.local?.bindStatus === 'bound';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.42)] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="relative w-full max-w-[480px] overflow-hidden rounded-[12px] border border-[#E5E6EB] bg-white shadow-[0_12px_40px_rgba(15,23,42,0.12)] dark:border-border dark:bg-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E6EB] px-5 py-4 dark:border-border">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E5E6EB] bg-[#F7F8FA] dark:border-border dark:bg-muted/40">
              <img src={dingtalkIcon} alt="" className="h-5 w-5 dark:invert" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold leading-tight text-[#1D2129] dark:text-foreground">
                {alreadyBound ? t('hub.dingtalk.rebindTitle', { defaultValue: '重新绑定钉钉' }) : t('hub.dingtalk.title')}
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
                {alreadyBound
                  ? t('hub.dingtalk.rebindSubtitle', {
                      defaultValue: '扫码后将替换当前钉钉绑定账号',
                    })
                  : t('hub.dingtalk.subtitle')}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-[#86909C] hover:bg-[#F7F8FA] hover:text-[#1D2129] dark:hover:bg-white/[0.04]"
            onClick={onClose}
            disabled={busy}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {loading ? (
            <div className="flex min-h-[160px] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[#86909C]" />
            </div>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
                {alreadyBound
                  ? t('hub.dingtalk.rebindHint', {
                      defaultValue: '使用钉钉扫描下方二维码完成重新绑定',
                    })
                  : t('hub.dingtalk.scanHint')}
              </p>

              {qrContent ? (
                <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#E5E6EB] bg-[#F7F8FA] p-4 dark:border-border dark:bg-muted/30">
                  <img
                    src={qrImageUrl(qrContent)}
                    alt="DingTalk bind QR"
                    className={cn(
                      'h-56 w-56 rounded-[8px] border border-[#E5E6EB] bg-white p-2',
                      qrExpired && 'opacity-40',
                    )}
                  />
                  <p className="text-center text-[12px] text-[#86909C] dark:text-muted-foreground">
                    {pollHint}
                  </p>
                  {qrExpired ? (
                    <Button
                      variant="outline"
                      className={outlineButtonClass}
                      disabled={busy}
                      onClick={() => void startBind()}
                    >
                      {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                      {t('hub.dingtalk.refreshQr')}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[8px] border border-dashed border-[#E5E6EB] bg-[#F7F8FA] p-6 dark:border-border dark:bg-muted/20">
                  {busy ? (
                    <>
                      <Loader2 className="h-7 w-7 animate-spin text-[#86909C]" />
                      <p className="text-[12px] text-[#86909C]">{t('hub.dingtalk.waitingScan')}</p>
                    </>
                  ) : (
                    <>
                      <QrCode className="h-7 w-7 text-[#86909C]" />
                      <Button className={primaryButtonClass} onClick={() => void startBind()}>
                        {t('hub.dingtalk.startBind')}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
