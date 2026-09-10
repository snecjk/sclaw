import { FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { IMArtifactOption } from '../types';

export function SendArtifactDialog({
  open,
  artifacts,
  onOpenChange,
}: {
  open: boolean;
  artifacts: IMArtifactOption[];
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('common');
  const [selectedId, setSelectedId] = useState(artifacts[0]?.id ?? '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('im.sendArtifact')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {artifacts.map((artifact) => {
            const active = artifact.id === selectedId;
            return (
              <button
                key={artifact.id}
                type="button"
                onClick={() => setSelectedId(artifact.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-[12px] border px-3 py-3 text-left transition-colors',
                  active
                    ? 'border-[var(--sto-brand-6)] bg-[var(--sto-brand-1)]'
                    : 'border-[var(--sto-border-subtle)] hover:bg-[var(--sto-surface-hover)]',
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--sto-badge-official-background)] text-[var(--sto-badge-official-foreground)]">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{artifact.title}</div>
                  <div className="text-[12px] text-[var(--sto-text-tertiary)]">
                    {artifact.fileName} · {artifact.fileSize}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t('im.sendNow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
