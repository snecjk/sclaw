import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface ReleaseChangelogMarkdownProps {
  content: string;
  className?: string;
}

export function ReleaseChangelogMarkdown({ content, className }: ReleaseChangelogMarkdownProps) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  return (
    <div className={cn('flex flex-col', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h3: ({ children }) => (
            <h3 className="mt-4 text-[13px] font-bold leading-snug text-[#1D2129] first:mt-0 dark:text-foreground">
              {children}
            </h3>
          ),
          ul: ({ children }) => (
            <ul className="mt-2 list-disc space-y-2 pl-5 marker:text-[#C9CDD4]">{children}</ul>
          ),
          li: ({ children }) => (
            <li className="text-[13px] font-normal leading-relaxed text-[#86909C] dark:text-muted-foreground">
              {children}
            </li>
          ),
          p: ({ children }) => (
            <p className="mt-2 text-[13px] font-normal leading-relaxed text-[#86909C] first:mt-0 dark:text-muted-foreground">
              {children}
            </p>
          ),
        }}
      >
        {trimmed}
      </ReactMarkdown>
    </div>
  );
}
