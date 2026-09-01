/**
 * IconCheckbox — 浅色沿用设计稿 SVG，暗色使用共享 checkbox recipe
 *
 * 传入 `onCheckedChange` 时为可点击按钮；仅传 `checked` 时为展示态。
 */
import { type ButtonHTMLAttributes, type MouseEvent } from 'react';
import { Check } from 'lucide-react';
import uncheckedIcon from '@/assets/icons/checbox_1.svg';
import checkedIcon from '@/assets/icons/checbox_2.svg';
import { cn } from '@/lib/utils';

export interface IconCheckboxProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** 图标边长，默认 16 */
  size?: number;
}

export function IconCheckbox({
  checked = false,
  onCheckedChange,
  size = 16,
  className,
  disabled,
  onClick,
  ...props
}: IconCheckboxProps) {
  const icon = (
    <>
      <img
        src={checked ? checkedIcon : uncheckedIcon}
        alt=""
        width={size}
        height={size}
        className="sto-checkbox-light-visual pointer-events-none select-none object-contain"
        style={{ width: size, height: size }}
        draggable={false}
        aria-hidden
      />
      <span
        className="sto-checkbox-dark-visual pointer-events-none shrink-0 items-center justify-center rounded-[4px] border bg-transparent text-primary-foreground"
        style={{ width: size, height: size }}
        data-state={checked ? 'checked' : 'unchecked'}
        data-sto-checkbox-theme="dark"
        aria-hidden
      >
        {checked ? <Check style={{ width: size * 0.75, height: size * 0.75 }} strokeWidth={3} /> : null}
      </span>
    </>
  );

  const sharedClassName = cn(
    'inline-flex shrink-0 items-center justify-center border-0 bg-transparent p-0',
    className,
  );

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || disabled) return;
    onCheckedChange?.(!checked);
  };

  if (!onCheckedChange) {
    return (
      <span className={sharedClassName} data-state={checked ? 'checked' : 'unchecked'} aria-hidden>
        {icon}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      disabled={disabled}
      className={cn(
        sharedClassName,
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
      onClick={handleClick}
      {...props}
    >
      {icon}
    </button>
  );
}
