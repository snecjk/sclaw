/**
 * Select Component
 * Styled native select matching shadcn/ui conventions
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        className={cn(
          'sto-control sto-control--field sto-control--select flex h-10 w-full rounded-md border px-3 py-2 text-sm',
          'dark:[color-scheme:dark]',
          '[-webkit-appearance:none] appearance-none',
          'bg-[length:16px_16px] bg-[right_12px_center] bg-no-repeat',
          'pr-10',
          'disabled:cursor-not-allowed',
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = 'Select';

export { Select };
