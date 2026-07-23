export function formatAppBadges(value?: string) {
  if (!value) return '';

  return [...new Set(
    value
      .split(/[,，、;；]/)
      .map((badge) => badge.trim())
      .filter(Boolean),
  )].join('、');
}
