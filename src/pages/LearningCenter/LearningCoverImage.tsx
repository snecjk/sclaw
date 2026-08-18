import { useEffect, useRef, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import {
  requiresLearningCoverHostFetch,
  resolveLearningCoverSrc,
} from '@/lib/learning-center-cover';

interface LearningCoverImageProps {
  url: string;
  alt: string;
  className?: string;
  iconClassName?: string;
}

export function LearningCoverImage({
  url,
  alt,
  className,
  iconClassName = 'h-9 w-9',
}: LearningCoverImageProps) {
  const coverUrl = url.trim();
  const initialSrc = requiresLearningCoverHostFetch(coverUrl) ? '' : coverUrl;
  const [resolved, setResolved] = useState(() => ({ url: coverUrl, src: initialSrc }));
  const hostFetchFor = useRef('');
  const src = resolved.url === coverUrl ? resolved.src : initialSrc;

  useEffect(() => {
    let active = true;
    const nextInitialSrc = requiresLearningCoverHostFetch(coverUrl) ? '' : coverUrl;
    hostFetchFor.current = '';
    if (coverUrl && !nextInitialSrc) {
      hostFetchFor.current = coverUrl;
      void resolveLearningCoverSrc(coverUrl).then((next) => {
        if (active) setResolved({ url: coverUrl, src: next });
      });
    }
    return () => { active = false; };
  }, [coverUrl]);

  if (!coverUrl || !src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className="flex h-full w-full items-center justify-center text-muted-foreground"
      >
        <ImageIcon className={iconClassName} strokeWidth={1.5} aria-hidden />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
      onError={() => {
        if (src.startsWith('data:') || hostFetchFor.current === coverUrl) return;
        hostFetchFor.current = coverUrl;
        void resolveLearningCoverSrc(coverUrl).then((next) => {
          if (next.startsWith('data:')) setResolved({ url: coverUrl, src: next });
        });
      }}
    />
  );
}
