import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Match input @ tokens: @displayName until whitespace/@/newline. */
const AT_MENTION_PATTERN = /@([^\s@\n]+)/g;

export const AT_MENTION_TEXT_CLASS = 'font-medium text-[#1677FF] dark:text-[#4C9BFF]';

export function splitTextByAtMentions(text: string): Array<{ type: 'text' | 'mention'; value: string }> {
  if (!text) return [];

  const parts: Array<{ type: 'text' | 'mention'; value: string }> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(AT_MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, index) });
    }
    parts.push({ type: 'mention', value: match[0] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', value: text }];
}

export function renderTextWithAtMentions(text: string, mentionClassName = AT_MENTION_TEXT_CLASS): ReactNode {
  const parts = splitTextByAtMentions(text);
  return parts.map((part, index) => (
    part.type === 'mention'
      ? <span key={index} className={mentionClassName}>{part.value}</span>
      : <Fragment key={index}>{part.value}</Fragment>
  ));
}

export function highlightAtMentionsInChildren(children: ReactNode, mentionClassName = AT_MENTION_TEXT_CLASS): ReactNode {
  if (typeof children === 'string') {
    return renderTextWithAtMentions(children, mentionClassName);
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{highlightAtMentionsInChildren(child, mentionClassName)}</Fragment>
    ));
  }

  return children;
}

interface AtMentionTextProps {
  text: string;
  className?: string;
  as?: 'p' | 'span';
}

export function AtMentionText({ text, className, as: Tag = 'p' }: AtMentionTextProps) {
  return (
    <Tag className={cn(className)}>
      {renderTextWithAtMentions(text)}
    </Tag>
  );
}
