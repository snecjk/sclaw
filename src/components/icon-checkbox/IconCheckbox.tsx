/**
 * IconCheckbox — 用设计稿 SVG 切换勾选态
 * - checbox_1：未选
 * - checbox_2：已选
 *
 * 传入 `onCheckedChange` 时为可点击按钮；仅传 `checked` 时为展示态。
 */
import { useCallback, type ButtonHTMLAttributes, type MouseEvent } from 'react';
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
    <img
      src={checked ? checkedIcon : uncheckedIcon}
      alt=""
      width={size}
      height={size}
      className="pointer-events-none select-none object-contain"
      style={{ width: size, height: size }}
      draggable={false}
      aria-hidden
    />
  );

  const sharedClassName = cn(
    'inline-flex shrink-0 items-center justify-center border-0 bg-transparent p-0',
    className,
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || disabled) return;
      onCheckedChange?.(!checked);
    },
    [checked, disabled, onCheckedChange, onClick],
  );

  if (!onCheckedChange) {
    return (
      <span className={sharedClassName} aria-hidden>
        {icon}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
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
