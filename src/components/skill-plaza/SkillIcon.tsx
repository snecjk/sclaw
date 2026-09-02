import { useState } from 'react';
import { cn } from '@/lib/utils';
import fileIcon from '@/assets/icons/file.svg';
import { StoIconSurface } from '@/components/ui/sto-neutral-controls';

type SkillIconSize = 'sm' | 'md';

interface SkillIconProps {
  icon?: string | null;
  size?: SkillIconSize;
  disabled?: boolean;
  className?: string;
}

const sizeClass: Record<SkillIconSize, { shell: string; content: string; text: string }> = {
  sm: {
    shell: 'h-9 w-9',
    content: 'h-4 w-4',
    text: 'text-base',
  },
  md: {
    shell: 'h-10 w-10',
    content: 'h-5 w-5',
    text: 'text-xl',
  },
};

function isInlineSvg(icon: string): boolean {
  return icon.trimStart().startsWith('<svg');
}

function isImageUrl(icon: string): boolean {
  const value = icon.trim();
  return /^(https?:\/\/|data:image\/|file:\/\/|\/)/i.test(value)
    && (
      /^(https?:\/\/|data:image\/|file:\/\/|\/)/i.test(value)
      || /\.(png|jpe?g|webp|gif|avif|svg)(?:[?#].*)?$/i.test(value)
    );
}

function normalizeInlineSvg(icon: string, pixelSize: number): string {
  return icon
    .replace(/width="[^"]*"/, `width="${pixelSize}"`)
    .replace(/height="[^"]*"/, `height="${pixelSize}"`);
}

export function SkillIcon({ icon, size = 'sm', disabled, className }: SkillIconProps) {
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const trimmedIcon = icon?.trim();
  const imageFailed = Boolean(trimmedIcon && failedIcon === trimmedIcon);
  const classes = sizeClass[size];
  const svgPixelSize = size === 'md' ? 20 : 16;

  const content = (() => {
    if (trimmedIcon && !imageFailed && isImageUrl(trimmedIcon)) {
      return (
        <img
          src={trimmedIcon}
          alt=""
          aria-hidden
          className={cn(classes.content, 'object-contain')}
          onError={() => setFailedIcon(trimmedIcon)}
        />
      );
    }

    if (trimmedIcon && isInlineSvg(trimmedIcon)) {
      return (
        <span
          className={cn(classes.content, 'inline-flex items-center justify-center [&_svg]:h-full [&_svg]:w-full')}
          dangerouslySetInnerHTML={{ __html: normalizeInlineSvg(trimmedIcon, svgPixelSize) }}
        />
      );
    }

    if (trimmedIcon && !imageFailed) {
      return <span className={cn(classes.text, 'leading-none')}>{trimmedIcon}</span>;
    }

    return (
      <img
        src={fileIcon}
        alt=""
        aria-hidden
        className={cn(classes.content, 'object-contain dark:invert')}
      />
    );
  })();

  return (
    <StoIconSurface
      className={cn(
        'relative overflow-hidden text-foreground shadow-[0_1px_4px_rgba(15,23,42,0.05),0_4px_12px_rgba(15,23,42,0.04)] dark:shadow-none',
        classes.shell,
        disabled && 'opacity-50',
        className,
      )}
    >
      {content}
    </StoIconSurface>
  );
}
