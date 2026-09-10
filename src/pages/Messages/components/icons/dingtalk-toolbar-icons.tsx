import { cn } from '@/lib/utils';

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** 钉钉顶栏：文件夹 */
export function DingTalkFolderIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('shrink-0', className)} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M3.5 6.2V15a1.2 1.2 0 0 0 1.2 1.2h11.1a1.2 1.2 0 0 0 1.2-1.2V8.4a1.2 1.2 0 0 0-1.2-1.2H10.2L8.6 5.2H4.7a1.2 1.2 0 0 0-1.2 1.2v0Z"
        {...stroke}
      />
    </svg>
  );
}

/** 钉钉顶栏：添加成员 */
export function DingTalkUserAddIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('shrink-0', className)} viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="8.2" cy="7.4" r="2.5" {...stroke} />
      <path d="M4.2 15.2c.8-2.2 2.4-3.3 4-3.3s3.2 1.1 4 3.3" {...stroke} />
      <path d="M14.8 8.2v3.2M13.2 9.8h3.2" {...stroke} />
    </svg>
  );
}
