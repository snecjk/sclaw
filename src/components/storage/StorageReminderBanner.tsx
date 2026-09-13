import { useEffect, useState } from 'react';
import { AlertTriangle, HardDrive, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { maxStorageSeverity, shouldShowStorageReminder } from '../../../shared/storage-management';
import { useSettingsStore } from '@/stores/settings';
import { useStorageStore } from '@/stores/storage';

const FIRST_CHECK_DELAY_MS = 5 * 60 * 1000;
const BUSY_RETRY_MS = 10 * 60 * 1000;
const DAILY_CHECK_MS = 24 * 60 * 60 * 1000;

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
}

export function StorageReminderBanner() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation('settings');
  const enabled = useSettingsStore((state) => state.storageReminderEnabled);
  const setEnabled = useSettingsStore((state) => state.setStorageReminderEnabled);
  const load = useStorageStore((state) => state.load);
  const overview = useStorageStore((state) => state.overview);
  const [visible, setVisible] = useState(false);
  const [confirmNever, setConfirmNever] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(() => {
        void load({ background: true }).then((result) => {
          if (cancelled) return;
          if (!result) { schedule(BUSY_RETRY_MS); return; }
          schedule(DAILY_CHECK_MS);
          const today = localDate();
          const settings = useSettingsStore.getState();
          if (shouldShowStorageReminder({
            enabled: settings.storageReminderEnabled,
            lastShownLocalDate: settings.storageReminderLastShownLocalDate,
            todayLocalDate: today,
            diskSeverity: result.disk.severity,
            managedSeverity: result.managedSeverity,
          })) {
            settings.markStorageReminderShown(today);
            setVisible(true);
          }
        }).catch(() => schedule(BUSY_RETRY_MS));
      }, delay);
    };
    schedule(FIRST_CHECK_DELAY_MS);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [load]);

  if (!visible || !enabled || !overview || location.pathname !== '/') return null;
  const severity = maxStorageSeverity(overview.disk.severity, overview.managedSeverity);
  const critical = severity === 'critical';
  return (
    <>
      <div className={`fixed left-1/2 top-14 z-40 flex w-[min(920px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${critical ? 'border-red-300 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/95 dark:text-red-100' : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/95 dark:text-amber-100'}`}>
        {critical ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <HardDrive className="h-5 w-5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{critical ? t('storage.reminderCritical') : t('storage.reminderWarning')}</p>
          <p className="text-xs opacity-80">{t('storage.reminderSummary', { disk: formatBytes(overview.disk.availableBytes), managed: formatBytes(overview.managedBytes) })}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate('/settings/storage')}>{t('storage.reviewCleanup')}</Button>
        <button type="button" className="text-xs underline opacity-70 hover:opacity-100" onClick={() => setConfirmNever(true)}>{t('storage.neverRemind')}</button>
        <button type="button" aria-label={t('storage.close')} onClick={() => setVisible(false)}><X className="h-4 w-4" /></button>
      </div>
      <ConfirmDialog
        open={confirmNever}
        title={t('storage.neverRemindTitle')}
        message={t('storage.neverRemindMessage')}
        confirmLabel={t('storage.neverRemind')}
        cancelLabel={t('storage.cancel')}
        onCancel={() => setConfirmNever(false)}
        onConfirm={() => { setEnabled(false); setVisible(false); setConfirmNever(false); }}
      />
    </>
  );
}
