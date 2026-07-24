/**
 * AppIcon — circular app icon with optional remote iconUrl or builtin SVG fallback.
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
  tone?: AppTone;
  size?: AppIconSize;
  shape?: AppIconShape;
  className?: string;
}

export function AppIcon({
  iconKey,
  iconUrl,
  tone = 'gray',
  size = 'md',
  shape = 'circle',
  className,
}: AppIconProps) {
  const trimmedUrl = iconUrl?.trim();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showRemoteImage = !!trimmedUrl && failedUrl !== trimmedUrl;

  return (
    <span
      className={cn(
        'app-icon',
        `app-icon--${size}`,
        `app-icon--tone-${tone}`,
        shape === 'rounded' && 'app-icon--rounded',
        showRemoteImage && 'app-icon--image',
        className,
      )}
    >
      {showRemoteImage ? (
        <img
          src={trimmedUrl}
          alt=""
          className="app-icon__img"
          draggable={false}
          onError={() => setFailedUrl(trimmedUrl)}
        />
      ) : (
        <span dangerouslySetInnerHTML={{ __html: getAppIcon(iconKey) }} />
      )}
    </span>
  );
}
