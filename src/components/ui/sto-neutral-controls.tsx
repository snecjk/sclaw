import type {
  ButtonHTMLAttributes,
  ComponentType,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
import { Search } from 'lucide-react';
import {
  stoIconSurfaceClass,
  stoOutlineButtonBaseClass,
  stoSearchFieldShellClass,
  stoSegmentTabClass,
  stoSegmentTabsTrackClass,
} from '@/lib/surfaces';
import { cn } from '@/lib/utils';

export type StoSegmentTabItem<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ComponentType<{
    className?: string;
    strokeWidth?: number;
    'aria-hidden'?: boolean;
  }>;
};

interface StoSearchFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'className' | 'onChange' | 'placeholder' | 'type' | 'value'
  > {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  className?: string;
  inputClassName?: string;
}

export function StoSearchField({
  value,
  onValueChange,
  placeholder,
  className,
  inputClassName,
  ...inputProps
}: StoSearchFieldProps) {
  return (
    <label className={cn(stoSearchFieldShellClass, className)}>
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <input
        {...inputProps}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          'h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-foreground outline-none placeholder:text-muted-foreground',
          inputClassName,
        )}
      />
    </label>
  );
}

export function StoOutlineButton({
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(stoOutlineButtonBaseClass, 'h-9 px-3', className)}
      {...props}
    />
  );
}

interface StoSegmentTabsProps<T extends string> {
  value: T;
  items: Array<StoSegmentTabItem<T>>;
  onValueChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

export function StoSegmentTabs<T extends string>({
  value,
  items,
  onValueChange,
  ariaLabel,
  className,
}: StoSegmentTabsProps<T>) {
  return (
    <div
      className={cn(stoSegmentTabsTrackClass, className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={value === item.value}
            className={stoSegmentTabClass(value === item.value)}
            onClick={() => onValueChange(item.value)}
          >
            {Icon ? (
              <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            ) : null}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function StoIconSurface({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn(stoIconSurfaceClass, className)} {...props} />;
}
