/**
 * AppIcon — circular app icon with optional remote iconUrl or builtin SVG fallback.
 */
import { cn } from '@/lib/utils';
import { getAppIcon } from './app-icons';
import type { AppTone } from '@/types/more-apps';

type AppIconSize = 'sm' | 'md' | 'lg';

interface AppIconProps {
  iconKey?: string;
  iconUrl?: string;
  tone?: AppTone;
  size?: AppIconSize;
  className?: string;
}

export function AppIcon({ iconKey, iconUrl, tone = 'gray', size = 'md', className }: AppIconProps) {
  const trimmedUrl = iconUrl?.trim();

  return (
    <span
      className={cn(
        'app-icon',
        `app-icon--${size}`,
        `app-icon--tone-${tone}`,
        trimmedUrl && 'app-icon--image',
        className,
      )}
    >
      {trimmedUrl ? (
        <img src={trimmedUrl} alt="" className="app-icon__img" draggable={false} />
      ) : (
        <span dangerouslySetInnerHTML={{ __html: getAppIcon(iconKey) }} />
      )}
    </span>
  );
}
