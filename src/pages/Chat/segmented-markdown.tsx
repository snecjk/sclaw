/**
 * P5 W1-1：流式 markdown 分段——已完成块 memo 定稿，仅尾巴段重 parse。
 * 以 fence 外最后一个 `\n\n` 为界切 sealed / tail。
 */
import { memo } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';

export function splitStreamingMarkdown(text: string): { sealed: string[]; tail: string } {
  if (!text) return { sealed: [], tail: '' };

  const sealed: string[] = [];
  let inFence = false;
  let blockStart = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith('```', i)) {
      inFence = !inFence;
      i += 2;
      continue;
    }
    if (!inFence && text[i] === '\n' && text[i + 1] === '\n') {
      const block = text.slice(blockStart, i);
      if (block.length > 0) sealed.push(block);
      blockStart = i + 2;
      i += 1;
    }
  }

  return { sealed, tail: text.slice(blockStart) };
}

type MarkdownPlugins = NonNullable<Options['remarkPlugins']>;

const MemoMarkdownBlock = memo(function MemoMarkdownBlock({
  source,
  remarkPlugins,
  components,
  urlTransform,
}: {
  source: string;
  remarkPlugins?: MarkdownPlugins;
  components?: Components;
  urlTransform?: Options['urlTransform'];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      components={components}
      urlTransform={urlTransform}
    >
      {source}
    </ReactMarkdown>
  );
}, (prev, next) => prev.source === next.source);

/**
 * 流式：sealed 块定稿后不再 parse；非流式：整文一次 parse（与旧行为一致）。
 */
export function SegmentedMarkdown({
  source,
  isStreaming,
  remarkPlugins,
  components,
  urlTransform,
}: {
  source: string;
  isStreaming: boolean;
  remarkPlugins?: MarkdownPlugins;
  components?: Components;
  urlTransform?: Options['urlTransform'];
}) {
  if (!isStreaming) {
    return (
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={components}
        urlTransform={urlTransform}
      >
        {source}
      </ReactMarkdown>
    );
  }

  const { sealed, tail } = splitStreamingMarkdown(source);
  return (
    <>
      {sealed.map((block, index) => (
        <MemoMarkdownBlock
          key={`sealed-${index}`}
          source={block}
          remarkPlugins={remarkPlugins}
          components={components}
          urlTransform={urlTransform}
        />
      ))}
      {tail ? (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          components={components}
          urlTransform={urlTransform}
        >
          {tail}
        </ReactMarkdown>
      ) : null}
    </>
  );
}
