/** 快捷输入「管理」滑块图标（源尺寸 14×14，勿覆盖宽高） */
export function QuickInputManageIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="none"
      className={className}
      aria-hidden
    >
      {/* 上滑块：圆在左，杆向右 */}
      <circle cx="3.5" cy="4" r="1.75" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 4H11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      {/* 下滑块：杆在左，圆在右 */}
      <path d="M2.5 10H8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="10.5" cy="10" r="1.75" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
