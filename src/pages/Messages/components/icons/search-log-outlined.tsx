import { cn } from '@/lib/utils';

/** 钉钉 SearchLogOutlined：聊天记录 / 聊天内容搜索（细线描边） */
export function SearchLogOutlinedIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('shrink-0', className)}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
    >
      <path
        d="M5.5 3.5h7a1 1 0 0 1 1 1v9.2a.8.8 0 0 1-.8.8H5.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M6.2 6.5h5.6M6.2 9h5.6M6.2 11.5h3.4"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <circle cx="13.8" cy="13.8" r="2.6" stroke="currentColor" strokeWidth="1" />
      <path
        d="M15.6 15.6 17.2 17.2"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}
