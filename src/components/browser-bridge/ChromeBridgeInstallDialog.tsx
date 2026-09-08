import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { subscribeBrowserBridgeInstallGuide } from '@/lib/browser-bridge-install-guide';
import { hostApiFetch } from '@/lib/host-api';

type ExtensionInfo = {
  success?: boolean;
  storeAvailable?: boolean;
};

type PrepareInstallResponse = {
  success?: boolean;
  unpackedDir?: string;
  error?: string;
};

function GuideStep({ index, children }: { index: number; children: string }) {
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] text-muted-foreground">
        {index}
      </span>
      <span className="text-[13px] leading-relaxed text-muted-foreground">{children}</span>
    </li>
  );
}

export function ChromeBridgeInstallDialog() {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const [storeAvailable, setStoreAvailable] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [unpackedDir, setUnpackedDir] = useState<string | null>(null);

  const refreshInfo = useCallback(async () => {
    try {
      const info = await hostApiFetch<ExtensionInfo>('/api/browser-bridge/extension-info');
      setStoreAvailable(info.storeAvailable === true);
    } catch {
      setStoreAvailable(false);
    }
  }, []);

  useEffect(() => {
    const openGuide = () => {
      setOpen(true);
      void refreshInfo();
    };
    const unsubscribeEvent = subscribeBrowserBridgeInstallGuide(openGuide);
    const unsubscribeIpc = window.electron?.ipcRenderer.on('browser-bridge:install-guide', openGuide);
    return () => {
      unsubscribeEvent();
      if (typeof unsubscribeIpc === 'function') unsubscribeIpc();
    };
  }, [refreshInfo]);

  useEffect(() => {
    if (open) void refreshInfo();
  }, [open, refreshInfo]);

  const handleOpenStore = async () => {
    try {
      await hostApiFetch('/api/browser-bridge/open-chrome-store', { method: 'POST' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('advanced.browserBridgeInstallFailed'));
    }
  };

  const handleLocalGuide = async () => {
    setPreparing(true);
    try {
      const prepared = await hostApiFetch<PrepareInstallResponse>(
        '/api/browser-bridge/prepare-extension-install',
        { method: 'POST' },
      );
      if (!prepared.success || !prepared.unpackedDir) {
        throw new Error(prepared.error || t('advanced.browserBridgeInstallFailed'));
      }
      setUnpackedDir(prepared.unpackedDir);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('advanced.browserBridgeInstallFailed'));
    } finally {
      setPreparing(false);
    }
  };

  const handleCopyPath = async () => {
    if (!unpackedDir) return;
    await navigator.clipboard.writeText(unpackedDir);
    toast.success(t('advanced.browserBridgePathCopied'));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        overlayClassName="z-[100000]"
        className="z-[100001] max-w-[440px] gap-4"
      >
        <DialogHeader>
          <DialogTitle>{t('advanced.browserBridgeGuideTitle')}</DialogTitle>
          <DialogDescription>{t('advanced.browserBridgeGuideDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {storeAvailable ? (
            <Button
              type="button"
              size="sm"
              className="h-8 w-full"
              onClick={() => {
                void handleOpenStore();
              }}
            >
              <ExternalLink className="mr-1.5 size-3.5" />
              {t('advanced.browserBridgeGuideStore')}
            </Button>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              {t('advanced.browserBridgeGuideStoreUnavailable')}
            </p>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="sto-control-outline h-8 w-full"
            disabled={preparing}
            onClick={() => {
              void handleLocalGuide();
            }}
          >
            <Puzzle className="mr-1.5 size-3.5" />
            {preparing ? t('advanced.browserBridgeGuidePreparing') : t('advanced.browserBridgeGuideLocal')}
          </Button>

          {unpackedDir ? (
            <div className="space-y-2 rounded-md border border-border bg-[var(--sto-form-inset-background)] p-3">
              <ol className="space-y-2">
                <GuideStep index={1}>{t('advanced.browserBridgeGuideStep1')}</GuideStep>
                <GuideStep index={2}>{t('advanced.browserBridgeGuideStep2')}</GuideStep>
                <GuideStep index={3}>{t('advanced.browserBridgeGuideStep3')}</GuideStep>
              </ol>
              <p className="break-all font-mono text-[12px] text-muted-foreground">{unpackedDir}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="sto-control-outline h-8"
                onClick={() => {
                  void handleCopyPath();
                }}
              >
                <Copy className="mr-1 size-3.5" />
                {t('advanced.browserBridgeCopyPath')}
              </Button>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="sto-control-outline h-8"
            onClick={() => setOpen(false)}
          >
            {t('advanced.browserBridgeGuideLater')}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={() => setOpen(false)}
          >
            {t('advanced.browserBridgeGuideDone')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
