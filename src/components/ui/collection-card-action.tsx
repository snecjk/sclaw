import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function CollectionCardAction({
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn('sto-collection-card__action', className)}
      {...props}
    />
  );
}
