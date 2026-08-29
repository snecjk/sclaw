/* eslint-disable react-refresh/only-export-components */
/**
 * Button Component
 * Based on shadcn/ui button
 */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonRecipeClass = {
  default: 'sto-control sto-control--primary',
  destructive: 'sto-control sto-control--destructive',
  outline: 'sto-control sto-control--outline',
  secondary: 'sto-control sto-control--secondary',
  ghost: 'sto-control sto-control--ghost',
  link: 'sto-control sto-control--link',
} as const;

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none',
  {
    variants: {
      variant: {
        default: buttonRecipeClass.default,
        destructive: buttonRecipeClass.destructive,
        outline: `${buttonRecipeClass.outline} border`,
        secondary: buttonRecipeClass.secondary,
        ghost: buttonRecipeClass.ghost,
        link: `${buttonRecipeClass.link} underline-offset-4 hover:underline`,
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    className,
    variant,
    size,
    asChild = false,
    disabled,
    'aria-disabled': ariaDisabled,
    tabIndex,
    onClickCapture,
    ...props
  }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const childIsDisabled = asChild
      && (disabled === true || ariaDisabled === true || ariaDisabled === 'true');

    function preventDisabledActivation(event: React.SyntheticEvent): void {
      event.preventDefault();
      event.stopPropagation();
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={asChild ? undefined : disabled}
        aria-disabled={childIsDisabled ? true : ariaDisabled}
        tabIndex={childIsDisabled ? -1 : tabIndex}
        onClickCapture={childIsDisabled ? preventDisabledActivation : onClickCapture}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
