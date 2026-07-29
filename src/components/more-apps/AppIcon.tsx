/**
 * AppIcon — circular app icon with remote image, letter avatar, or builtin SVG.
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { getAppIcon } from './app-icons';
import type { AppTone } from '@/types/more-apps';

type AppIconSize = 'sm' | 'md' | 'lg';
type AppIconShape = 'circle' | 'rounded';

interface AppIconProps {
  iconKey?: string;
  iconUrl?: string;
  /** App display name — used for letter avatar when no favicon yet. */
  name?: string;
  /**
   * When true (e.g. external / 我的应用), fall back to the first character of `name`
   * instead of the generic "external link" SVG.
   */
  letterFallback?: boolean;
  tone?: AppTone;
  size?: AppIconSize;
  shape?: AppIconShape;
  className?: string;
}

/** First visible character for letter avatar (supports CJK). */
export function getAppNameInitial(name?: string): string {
  const trimmed = name?.trim();
  if (!trimmed) return '?';
  const chars = Array.from(trimmed);
  return chars[0] || '?';
}

export function AppIcon({
  iconKey,
  iconUrl,
  name,
  letterFallback = false,
  tone = 'gray',
  size = 'md',
  shape = 'circle',
  className,
}: AppIconProps) {
  const trimmedUrl = iconUrl?.trim();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showRemoteImage = !!trimmedUrl && failedUrl !== trimmedUrl;
  const useLetter = !showRemoteImage
    && letterFallback
    && Boolean(name?.trim())
    && (!iconKey || iconKey === 'external' || iconKey === 'default');

  return (
    <span
      className={cn(
        'app-icon',
        `app-icon--${size}`,
        `app-icon--tone-${tone}`,
        shape === 'rounded' && 'app-icon--rounded',
        showRemoteImage && 'app-icon--image',
        useLetter && 'app-icon--letter',
        className,
      )}
      aria-hidden
    >
      {showRemoteImage ? (
        <img
          src={trimmedUrl}
          alt=""
          className="app-icon__img"
          draggable={false}
          onError={() => setFailedUrl(trimmedUrl)}
        />
      ) : useLetter ? (
        <span className="app-icon__letter">{getAppNameInitial(name)}</span>
      ) : (
        <span dangerouslySetInnerHTML={{ __html: getAppIcon(iconKey) }} />
      )}
    </span>
  );
}
