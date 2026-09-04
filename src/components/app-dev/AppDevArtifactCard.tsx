/**
 * 轮结束产物卡（T09）。
 */
import { Heart, ExternalLink, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AppDevArtifactRecord } from '@/lib/app-dev-api';

interface AppDevArtifactCardProps {
  artifact: AppDevArtifactRecord;
  onOpenPreview: () => void;
  onPublish?: () => void;
  onToggleFavorite: () => void;
}

const PLACEHOLDER_GRADIENT =
  'linear-gradient(135deg, #FF6F00 0%, #FFB380 100%)';

export function AppDevArtifactCard({
  artifact,
  onOpenPreview,
  onPublish,
  onToggleFavorite,
}: AppDevArtifactCardProps) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card animate-in fade-in duration-200">
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {artifact.thumbnailDataUrl ? (
          <img
            src={artifact.thumbnailDataUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full" style={{ background: PLACEHOLDER_GRADIENT }} />
        )}
        <button
          type="button"
          className={cn(
            'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-popover/90',
            artifact.favorite && 'text-[var(--sto-brand-primary)]',
          )}
          onClick={onToggleFavorite}
          aria-label={artifact.favorite ? '取消收藏' : '收藏'}
        >
          <Heart className={cn('h-3.5 w-3.5', artifact.favorite && 'fill-current')} />
        </button>
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{artifact.title}</div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onOpenPreview}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          打开预览
        </Button>
        {onPublish ? (
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={onPublish}
          >
            <Rocket className="h-3.5 w-3.5" />
            发布应用
          </Button>
        ) : null}
      </div>
    </div>
  );
}
