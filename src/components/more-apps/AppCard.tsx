/**
 * AppCard — single app card in the 应用广场 grid
 * Aligned with the PRD demo (more-apps.css)
 */
import { memo } from 'react';
import { Heart, Pencil } from 'lucide-react';
import type { AppItem } from '@/types/more-apps';
import { AppIcon } from './AppIcon';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { collectionCardShellClass } from '@/lib/surfaces';
import { CollectionCardAction } from '@/components/ui/collection-card-action';
import { formatExternalAppDomain } from './format-external-app-domain';

interface AppCardProps {
  app: AppItem;
  isMineTab?: boolean;
  isInstalled?: boolean;
  isFavorite?: boolean;
  onOpen: (app: AppItem) => void;
  onInstall?: (id: string) => void;
  onDelete?: (app: AppItem) => void;
  onEdit?: (app: AppItem) => void;
  onToggleFavorite?: (id: string) => void;
}

function AppCardImpl({ 
  app, 
  isMineTab, 
  isInstalled, 
  isFavorite,
  onOpen, 
  onInstall, 
  onDelete,
  onEdit,
  onToggleFavorite,
}: AppCardProps) {
  const { t } = useTranslation('common');

  const isExternal = app.kind === 'external' || app.external;
  const installed = isInstalled ?? app.installed;
  const favorite = isFavorite ?? false;
  const appMetaText = app.recent
    ? `${t('moreApps.recent', { defaultValue: '最近使用' })}：${app.recent}`
    : app.url
      ? formatExternalAppDomain(app.url)
      : t('moreApps.clickToInstall', { defaultValue: '点击安装后可用' });

  // Tags based on app properties
  const tags: { label: string; variant: 'official' | 'external' | 'hot' }[] = [];
  if (app.official) {
    tags.push({ label: t('moreApps.tag.official', { defaultValue: '官方' }), variant: 'official' });
  }
  if (isExternal) {
    tags.push({ label: t('moreApps.tag.external', { defaultValue: '外部' }), variant: 'external' });
  }
  if (app.badge) {
    tags.push({ label: app.badge, variant: 'hot' });
  }

  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite?.(app.id);
  };

  const handleInstall = (e: React.MouseEvent) => {
    e.stopPropagation();
    onInstall?.(app.id);
    onOpen(app);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(app);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(app);
  };

  const handleOpen = () => {
    if (!installed && onInstall) {
      onInstall(app.id);
    }
    onOpen(app);
  };

  return (
    <article
      className={cn(
        collectionCardShellClass,
        'more-apps-card',
        isExternal && 'more-apps-card--custom',
        installed && 'more-apps-card--installed',
      )}
    >
      <CollectionCardAction
        aria-label={t('moreApps.openApp', {
          appName: app.name,
          defaultValue: `打开${app.name}`,
        })}
        onClick={handleOpen}
      />
      {/* Top row: icon + title + actions */}
      <div className="more-apps-card__top">
        <AppIcon
          iconKey={app.iconKey}
          iconUrl={app.iconUrl}
          name={app.name}
          letterFallback={Boolean(isExternal)}
          tone={app.tone}
          size="md"
        />
        <div className="more-apps-card__head">
          <h3 className="more-apps-card__title">{app.name}</h3>
          {isMineTab && isExternal && (
            <div className="more-apps-card__actions">
              <button
                type="button"
                className="sto-control sto-control--icon-muted more-apps-card__icon-btn"
                onClick={handleEdit}
                aria-label={t('moreApps.action.edit', { defaultValue: '编辑' })}
                title={t('moreApps.action.edit', { defaultValue: '编辑' })}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="sto-control sto-control--icon-muted sto-control--icon-danger more-apps-card__icon-btn more-apps-card__icon-btn--danger"
                onClick={handleDelete}
                aria-label={t('moreApps.action.delete', { defaultValue: '删除' })}
                title={t('moreApps.action.delete', { defaultValue: '删除' })}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                  <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7h12z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="more-apps-card__desc">
        {isExternal
          ? (app.description && app.description !== '外部应用链接' ? app.description : t('moreApps.externalLinkDesc', { defaultValue: '外部应用链接' }))
          : (app.description || app.url)}
      </p>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="more-apps-card__tags">
          {tags.map((tag, idx) => (
            <span key={idx} className="sto-feedback sto-feedback--badge more-apps-tag" data-variant={tag.variant}>
              {tag.label}
            </span>
          ))}
        </div>
      )}

      {/* Footer: meta + actions */}
      <div className="more-apps-card__foot">
        <span className="more-apps-card__meta">
          {appMetaText}
        </span>
        <div className="more-apps-card__foot-actions">
          {!isExternal && onToggleFavorite && (
            <button
              type="button"
              className={cn('sto-control sto-control--favorite sto-control--favorite-subtle more-apps-card__favorite', favorite && 'more-apps-card__favorite--active')}
              onClick={handleToggleFavorite}
              aria-label={favorite ? t('moreApps.unfavorite', { defaultValue: '取消收藏' }) : t('moreApps.favorite', { defaultValue: '收藏' })}
              aria-pressed={favorite}
              title={favorite ? t('moreApps.unfavorite', { defaultValue: '取消收藏' }) : t('moreApps.favorite', { defaultValue: '收藏' })}
            >
              <Heart className="h-4 w-4" fill={favorite ? 'currentColor' : 'none'} />
            </button>
          )}
          {installed ? (
            <span className="more-apps-card__use">
              {isExternal ? t('moreApps.action.openLink', { defaultValue: '打开链接' }) : t('moreApps.action.open', { defaultValue: '打开' })}
            </span>
          ) : (
            <button
              className="sto-control sto-control--brand-solid more-apps-card__install"
              onClick={handleInstall}
            >
              {t('moreApps.action.install', { defaultValue: '打开' })}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export const AppCard = memo(AppCardImpl);
