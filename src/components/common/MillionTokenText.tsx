import { cn } from '@/lib/utils'
import { formatMillionToken, formatTokenDisplay } from '@/lib/token-display'

interface MillionTokenTextProps {
  value: number | null | undefined
  className?: string
}

export function MillionTokenText({ value, className }: MillionTokenTextProps) {
  const display = formatTokenDisplay(value)
  if (typeof display === 'string') {
    return <span className={cn('text-muted-foreground', className)}>{formatMillionToken(value)}</span>
  }

  const unitClassName =
    display.unit === '百万Token'
      ? 'bg-orange-100 text-orange-700 ring-1 ring-orange-200/80 font-semibold'
      : display.unit === '千Token'
        ? 'bg-link-muted text-link ring-1 ring-[hsl(var(--link)/0.22)]'
        : 'bg-muted/70 text-muted-foreground ring-1 ring-border'

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span>{display.valueText}</span>
      <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-none', unitClassName)}>
        {display.unit}
      </span>
    </span>
  )
}
