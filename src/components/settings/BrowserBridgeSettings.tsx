import { useCallback, useEffect, useState } from 'react';
import { Copy, Puzzle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { requestBrowserBridgeInstallGuide } from '@/lib/browser-bridge-install-guide';
import { hostApiFetch } from '@/lib/host-api';

type BridgeSettingsResponse = {
  success?: boolean;
  autoConnectEnabled?: boolean;
  installedExtensionVersion?: string | null;
  bundledExtensionVersion?: string;
  updateAvailable?: boolean;
};

type PairingResponse = {
  success?: boolean;
  code?: string | null;
};

export function BrowserBridgeSettings({ automationEnabled }: { automationEnabled: boolean }) {
  const { t } = useTranslation('settings');
  const [loading, setLoading] = useState(true);
  const [autoConnect, setAutoConnect] = useState(true);
  const [bundledVersion, setBundledVersion] = useState<string | null>(null);
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const settings = await hostApiFetch<BridgeSettingsResponse>('/api/browser-bridge/settings');
      setAutoConnect(settings.autoConnectEnabled !== false);
      setBundledVersion(settings.bundledExtensionVersion ?? null);
      setInstalledVersion(settings.installedExtensionVersion ?? null);
      setUpdateAvailable(settings.updateAvailable === true);
      if (automationEnabled) {
        let pairing = await hostApiFetch<PairingResponse>('/api/browser-bridge/pairing-code');
        if (!pairing.code) {
          pairing = await hostApiFetch<PairingResponse>('/api/browser-bridge/pairing-code', {
            method: 'POST',
          });
        }
        setPairingCode(pairing.code ?? null);
      } else {
        setPairingCode(null);
      }
    } catch {
      setBundledVersion(null);
    } finally {
      setLoading(false);
    }
  }, [automationEnabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAutoConnect = async (next: boolean) => {
    setAutoConnect(next);
    try {
      await hostApiFetch('/api/browser-bridge/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoConnectEnabled: next }),
      });
    } catch (error) {
      setAutoConnect(!next);
      toast.error(error instanceof Error ? error.message : t('advanced.browserBridgeSaveFailed'));
    }
  };

  const handleRefreshCode = async () => {
    try {
      const pairing = await hostApiFetch<PairingResponse>('/api/browser-bridge/pairing-code', {
        method: 'POST',
      });
      setPairingCode(pairing.code ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('advanced.browserBridgeSaveFailed'));
    }
  };

  const handleCopyCode = async () => {
    if (!pairingCode) return;
    await navigator.clipboard.writeText(pairingCode);
    toast.success(t('advanced.browserBridgeCodeCopied'));
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-[var(--sto-form-inset-background)] p-3">
      <div>
        <Label className="text-[13px] font-medium text-foreground">
          {t('advanced.browserBridgeTitle')}
        </Label>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {t('advanced.browserBridgeDesc')}
        </p>
      </div>
      <p className="text-[12px] text-muted-foreground">
        {t('advanced.browserBridgeVersion', {
          bundled: bundledVersion ?? '—',
          installed: installedVersion ?? t('advanced.browserBridgeNotPaired'),
        })}
        {updateAvailable ? ` · ${t('advanced.browserBridgeUpdate')}` : ''}
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-foreground">{t('advanced.browserBridgeAutoConnect')}</span>
        <Switch
          checked={autoConnect}
          disabled={!automationEnabled || loading}
          onCheckedChange={(checked) => {
            void handleAutoConnect(checked);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] text-foreground">
          {pairingCode || t('advanced.browserBridgeNoCode')}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="sto-control-outline h-8"
          disabled={!automationEnabled || !pairingCode}
          onClick={() => {
            void handleCopyCode();
          }}
        >
          <Copy className="mr-1 size-3.5" />
          {t('advanced.browserBridgeCopyCode')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="sto-control-outline h-8"
          disabled={!automationEnabled}
          onClick={() => {
            void handleRefreshCode();
          }}
        >
          <RefreshCw className="mr-1 size-3.5" />
          {t('advanced.browserBridgeRefreshCode')}
        </Button>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="sto-control-outline h-8"
        disabled={!automationEnabled}
        onClick={requestBrowserBridgeInstallGuide}
      >
        <Puzzle className="mr-1 size-3.5" />
        {t('advanced.browserBridgeInstall')}
      </Button>
    </div>
  );
}
