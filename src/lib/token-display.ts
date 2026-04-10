const MILLION_TOKEN_DIVISOR = 1_000_000
const THOUSAND_TOKEN_DIVISOR = 1_000
const TOKEN_THRESHOLD = 100
const THOUSAND_THRESHOLD = 100_000

function safeNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return null
  }
  return value
}

export function toMillionTokenValue(value: number | null | undefined): number | null {
  const numericValue = safeNumber(value)
  if (numericValue === null) return null
  return numericValue / MILLION_TOKEN_DIVISOR
}

export function formatMillionToken(value: number | null | undefined, fallback = '--'): string {
  const tokenDisplay = formatTokenDisplay(value, fallback)
  return tokenDisplay === fallback ? fallback : `${tokenDisplay.valueText} ${tokenDisplay.unit}`
}

export function formatTokenDisplay(
  value: number | null | undefined,
  fallback = '--',
): { valueText: string; unit: 'Token' | '千Token' | '百万Token' } | string {
  const numericValue = safeNumber(value)
  if (numericValue === null) return fallback
  const absValue = Math.abs(numericValue)
  if (absValue < TOKEN_THRESHOLD) {
    return { valueText: numericValue.toFixed(2), unit: 'Token' }
  }
  if (absValue < THOUSAND_THRESHOLD) {
    return { valueText: (numericValue / THOUSAND_TOKEN_DIVISOR).toFixed(2), unit: '千Token' }
  }
  return { valueText: (numericValue / MILLION_TOKEN_DIVISOR).toFixed(2), unit: '百万Token' }
}
