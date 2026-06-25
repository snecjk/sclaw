import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { glassSectionSurface } from '@/lib/surfaces';
import {
  fetchDingTalkStatus,
  installDwsCli,
  isDwsInstallFetchFailedMessage,
  loginDingTalk,
  type DingTalkStatusResponse,
} from '@/lib/host-api';
import { cn } from '@/lib/utils';

/** 右侧操作按钮统一尺寸，保证高度与内边距一致，宽度随文案自适应。 */
const DWS_CLI_ACTION_BTN =
  'h-9 shrink-0 whitespace-nowrap justify-center rounded-md px-3 text-[13px]';

export function DwsCliSettings() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<DingTalkStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchDingTalkStatus();
      setStatus(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    setError(null);
    try {
      const result = await installDwsCli();
      if (!result.success) {
        throw new Error(result.error || t('dwsCli.installFailed'));
      }
      if (result.updated === false) {
        toast.success(t('dwsCli.alreadyLatest', { version: result.version ?? '' }));
      }
      await refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isDwsInstallFetchFailedMessage(message)) {
        toast.error(t('dwsCli.installFailed'));
      } else {
        setError(message);
        toast.error(t('dwsCli.installFailed'), { description: message });
      }
    } finally {
      setInstalling(false);
    }
  }, [refreshStatus, t]);

  const handleLogin = useCallback(async () => {
    setLoggingIn(true);
    setError(null);
    try {
      const result = await loginDingTalk();
      if (!result.success) {
        throw new Error(t('dwsCli.loginFailed'));
      }
      toast.success(t('dwsCli.loginSuccess'));
      await refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(t('dwsCli.loginFailed'), { description: message });
    } finally {
      setLoggingIn(false);
    }
  }, [refreshStatus, t]);

  const installed = status?.installed === true;
  const authenticated = status?.authenticated === true;

  return (
    <section className={glassSectionSurface}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {t('dwsCli.title')}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t('dwsCli.desc')}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            DWS_CLI_ACTION_BTN,
            'border-glass-border bg-transparent hover:bg-[hsl(var(--glass-bg)/0.35)]',
          )}
          onClick={() => void refreshStatus()}
          disabled={loading || installing || loggingIn}
        >
          {loading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          {t('dwsCli.refresh')}
        </Button>
      </div>

      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Label className="text-[15px] font-medium text-foreground">{t('dwsCli.status')}</Label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-[12px] font-medium',
                  installed
                    ? 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                )}
              >
                {installed ? t('dwsCli.installed') : t('dwsCli.notInstalled')}
              </Badge>
              {installed && status?.version && (
                <span className="text-[13px] text-muted-foreground">
                  {t('dwsCli.version')}: v{status.version}
                </span>
              )}
              {installed && status?.skillMode && (
                <span className="text-[13px] text-muted-foreground">
                  skill: {status.skillMode}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Button
              size="sm"
              className={DWS_CLI_ACTION_BTN}
              onClick={() => void handleInstall()}
              disabled={loading || installing || loggingIn}
            >
              {installing ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {t('dwsCli.installing')}
                </>
              ) : (
                installed ? t('dwsCli.reinstall') : t('dwsCli.install')
              )}
            </Button>
            {installed && !authenticated && (
              <Button
                variant="outline"
                size="sm"
                className={cn(DWS_CLI_ACTION_BTN, 'border-glass-border')}
                onClick={() => void handleLogin()}
                disabled={loading || installing || loggingIn}
              >
                {loggingIn ? t('dwsCli.loggingIn') : t('dwsCli.login')}
              </Button>
            )}
          </div>
        </div>

        {installed && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Label className="text-[15px] font-medium text-foreground">{t('dwsCli.auth')}</Label>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-[12px] font-medium',
                      authenticated
                        ? 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400'
                        : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                    )}
                  >
                    {authenticated ? t('dwsCli.authenticated') : t('dwsCli.notAuthenticated')}
                  </Badge>
                </div>
              </div>
              {authenticated && (
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(DWS_CLI_ACTION_BTN, 'border-glass-border')}
                  onClick={() => void handleLogin()}
                  disabled={loading || installing || loggingIn}
                >
                  {loggingIn ? t('dwsCli.loggingIn') : t('dwsCli.relogin')}
                </Button>
              )}
            </div>

            {status?.binaryPath && (
              <div className="space-y-2">
                <Label className="text-[14px] font-medium text-foreground/80">{t('dwsCli.path')}</Label>
                <Input
                  readOnly
                  value={status.binaryPath}
                  className="h-9 font-mono text-[12px]"
                />
              </div>
            )}

          </div>
        )}

        {error && (
          <p className="text-[13px] text-destructive">{error}</p>
        )}
      </div>
    </section>
  );
}
