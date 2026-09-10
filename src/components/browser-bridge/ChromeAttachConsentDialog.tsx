import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApiFetch } from '@/lib/host-api';

type ConsentPayload = {
  url?: string;
};

export function ChromeAttachConsentDialog() {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | undefined>();

  useEffect(() => {
    const handleConsent = (...args: unknown[]) => {
      const payload = args[0] as ConsentPayload | undefined;
      setUrl(typeof payload?.url === 'string' && payload.url ? payload.url : undefined);
      setOpen(true);
    };
    const unsubscribe = window.electron?.ipcRenderer.on('browser-bridge:consent', handleConsent);
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const reply = useCallback(async (allowed: boolean) => {
    setOpen(false);
    try {
      await hostApiFetch('/api/browser-bridge/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed }),
      });
    } catch {
      /* 主进程超时后仍尽量把决定送出去 */
    }
  }, []);

  const message = url
    ? t('advanced.browserBridgeConsentWithUrl', { url })
    : t('advanced.browserBridgeConsentMessage');

  return (
    <ConfirmDialog
      open={open}
      title={t('advanced.browserBridgeConsentTitle')}
      message={message}
      confirmLabel={t('advanced.browserBridgeConsentAllow')}
      cancelLabel={t('advanced.browserBridgeConsentDeny')}
      overlayClassName="z-[100000]"
      onConfirm={() => reply(true)}
      onCancel={() => {
        void reply(false);
      }}
    />
  );
}
