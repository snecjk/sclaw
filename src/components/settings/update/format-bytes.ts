export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

/** Design spec: speed shown as MB/S (uppercase S). */
export function formatSpeedMBps(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '0 MB/S';
  const mbps = bytesPerSecond / (1024 * 1024);
  return `${mbps.toFixed(2)} MB/S`;
}

/** Compact MB display for progress totals (design uses 28.16 MB/414.72 MB). */
export function formatMegabytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
