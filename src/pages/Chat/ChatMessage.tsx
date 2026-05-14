/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, useEffect, memo } from 'react';
import { Sparkles, Copy, Check, ChevronDown, ChevronRight, Wrench, FileText, Film, Music, FileArchive, File, X, FolderOpen, ZoomIn, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { assistantChatCardBg, assistantChatCardBgStreaming } from '@/lib/surfaces';
import { invokeIpc } from '@/lib/api-client';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { extractText, extractThinking, extractImages, extractToolUse, formatTimestamp, extractPreviewableRefs } from './message-utils';

interface ChatMessageProps {
  message: RawMessage;
  showThinking: boolean;
  isStreaming?: boolean;
  streamingTools?: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
  onPreviewFile?: (file: AttachedFileMeta) => void;
}

interface ExtractedImage { url?: string; data?: string; mimeType: string; }

/** Resolve an ExtractedImage to a displayable src string, or null if not possible. */
function imageSrc(img: ExtractedImage): string | null {
  if (img.url) return img.url;
  if (img.data) return `data:${img.mimeType};base64,${img.data}`;
  return null;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  showThinking,
  isStreaming = false,
  streamingTools = [],
  onPreviewFile,
}: ChatMessageProps) {
  const { t } = useTranslation('chat');
  const isUser = message.role === 'user';
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const text = extractText(message);
  const hasText = text.trim().length > 0;
  const thinking = extractThinking(message);
  const images = extractImages(message);
  const tools = extractToolUse(message);
  const visibleThinking = showThinking ? thinking : null;
  const visibleTools = tools;

  const attachedFiles = message._attachedFiles || [];
  const [lightboxImg, setLightboxImg] = useState<{ src: string; fileName: string; filePath?: string; base64?: string; mimeType?: string } | null>(null);

  // Extract previewable refs from message text (local paths / localhost URLs)
  const extractedRefs = extractPreviewableRefs(text).filter(
    (ref) => !attachedFiles.some((f) => f.filePath === ref.filePath),
  );

  // Never render tool result messages in chat UI
  if (isToolResult) return null;

  const hasStreamingToolStatus = isStreaming && streamingTools.length > 0;
  if (!hasText && !visibleThinking && images.length === 0 && visibleTools.length === 0 && attachedFiles.length === 0 && extractedRefs.length === 0 && !hasStreamingToolStatus) return null;

  return (
    <div
      className={cn(
        'flex gap-3 group',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-border bg-[linear-gradient(180deg,#FFF5E6,#FFE8CC)] text-primary shadow-[0_8px_20px_rgba(255,111,0,0.12)]">
          <Sparkles className="h-4 w-4" />
        </div>
      )}

      {/* Content */}
      <div
        className={cn(
          'flex flex-col w-full min-w-0 max-w-[80%] space-y-2',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {isStreaming && !isUser && streamingTools.length > 0 && (
          <ToolStatusBar tools={streamingTools} />
        )}

        {/* Thinking section */}
        {visibleThinking && (
          <ThinkingBlock content={visibleThinking} />
        )}

        {/* Tool use cards */}
        {visibleTools.length > 0 && (
          <div className="space-y-1">
            {visibleTools.map((tool, i) => (
              <ToolCard key={tool.id || i} name={tool.name} input={tool.input} />
            ))}
          </div>
        )}

        {/* Images — rendered ABOVE text bubble for user messages */}
        {/* Images from content blocks (Gateway session data / channel push photos) */}
        {isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImageThumbnail
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — images above text for user, file cards below */}
        {isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              // Skip image attachments if we already have images from content blocks
              if (isImage && images.length > 0) return null;
              if (isImage) {
                return file.preview ? (
                  <ImageThumbnail
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType })}
                  />
                ) : (
                  <div
                    key={`local-${i}`}
                    className="flex h-36 w-36 items-center justify-center rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,246,247,0.95))] text-muted-foreground"
                  >
                    <File className="h-8 w-8" />
                  </div>
                );
              }
              // Non-image files → file card
              return <FileCard key={`local-${i}`} file={file} onPreviewFile={onPreviewFile} />;
            })}
          </div>
        )}

        {/* Main text bubble */}
        {hasText && (
          <MessageBubble
            text={text}
            isUser={isUser}
            isStreaming={isStreaming}
            streamingLabel={t('streaming.respondingBadge')}
            completedLabel={t('streaming.completedLabel')}
            completedBadge={t('streaming.completedBadge')}
            onPreviewFile={onPreviewFile}
          />
        )}

        {/* Images from content blocks — assistant messages (below text) */}
        {!isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImagePreviewCard
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — assistant messages (below text) */}
        {!isUser && (attachedFiles.length > 0 || extractedRefs.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              if (isImage && images.length > 0) return null;
              if (isImage && file.preview) {
                return (
                  <ImagePreviewCard
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType })}
                  />
                );
              }
              if (isImage && !file.preview) {
                return (
                  <div key={`local-${i}`} className="flex h-36 w-36 items-center justify-center rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,246,247,0.95))] text-muted-foreground">
                    <File className="h-8 w-8" />
                  </div>
                );
              }
              return <FileCard key={`local-${i}`} file={file} onPreviewFile={onPreviewFile} />;
            })}
            {extractedRefs.map((ref, i) => (
              <FileCard
                key={`extracted-${i}`}
                file={{ ...ref, fileSize: 0, preview: null }}
                onPreviewFile={onPreviewFile}
              />
            ))}
          </div>
        )}

        {/* Hover row for user messages — timestamp only */}
        {isUser && message.timestamp && (
          <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none">
            {formatTimestamp(message.timestamp)}
          </span>
        )}

        {/* Hover row for assistant messages — only when there is real text content */}
        {!isUser && hasText && (
          <AssistantHoverBar text={text} timestamp={message.timestamp} />
        )}
      </div>

      {/* Image lightbox portal */}
      {lightboxImg && (
        <ImageLightbox
          src={lightboxImg.src}
          fileName={lightboxImg.fileName}
          filePath={lightboxImg.filePath}
          base64={lightboxImg.base64}
          mimeType={lightboxImg.mimeType}
          onClose={() => setLightboxImg(null)}
        />
      )}
    </div>
  );
});

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function ToolStatusBar({
  tools,
}: {
  tools: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}) {
  return (
    <div className="w-full space-y-1">
      {tools.map((tool) => {
        const duration = formatDuration(tool.durationMs);
        const isRunning = tool.status === 'running';
        const isError = tool.status === 'error';
        return (
          <div
            key={tool.toolCallId || tool.id || tool.name}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs transition-all duration-300',
              isRunning && 'border-[hsl(var(--primary)/0.35)] bg-[linear-gradient(135deg,rgba(255,245,230,0.95),rgba(255,232,204,0.75))] text-foreground shadow-[0_8px_18px_rgba(255,111,0,0.08)]',
              !isRunning && !isError && cn('border-border text-muted-foreground', assistantChatCardBg),
              isError && 'border-destructive/30 bg-destructive/5 text-destructive',
            )}
          >
            {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
            {!isRunning && !isError && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
            {isError && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
            <Wrench className="h-3 w-3 shrink-0 opacity-60" />
            <span className="font-mono text-[12px] font-medium">{tool.name}</span>
            {duration && <span className="text-[11px] opacity-60">{tool.summary ? `(${duration})` : duration}</span>}
            {tool.summary && (
              <span className="truncate text-[11px] opacity-70">{tool.summary}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Assistant hover bar (timestamp + copy, shown on group hover) ─

function AssistantHoverBar({ text, timestamp }: { text: string; timestamp?: number }) {
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <div className="flex w-full select-none items-center justify-between px-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
      <span className="text-xs text-muted-foreground">
        {timestamp ? formatTimestamp(timestamp) : ''}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full border border-border bg-primary/[0.04] hover:bg-primary/[0.08]"
        onClick={copyContent}
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────

function MessageBubble({
  text,
  isUser,
  isStreaming,
  streamingLabel,
  completedLabel,
  completedBadge,
  onPreviewFile,
}: {
  text: string;
  isUser: boolean;
  isStreaming: boolean;
  streamingLabel: string;
  completedLabel: string;
  completedBadge: string;
  onPreviewFile?: (file: AttachedFileMeta) => void;
}) {
  const showStreamingChrome = isStreaming && !isUser;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl px-4 py-3 transition-[background-color,border-color,box-shadow] duration-300',
        !isUser && 'w-full',
        isUser
          ? cn(
              'border text-foreground',
              'border-border dark:border-white/12',
              'bg-[linear-gradient(165deg,hsl(var(--primary)/0.26),hsl(var(--primary)/0.11))]',
              'dark:bg-[linear-gradient(165deg,hsl(var(--primary)/0.45),hsl(var(--primary)/0.22))]',
              'shadow-[0_10px_26px_rgba(255,111,0,0.12),inset_0_1px_0_0_hsl(var(--glass-highlight)/0.45)]',
              'dark:shadow-[0_8px_28px_rgba(255,111,0,0.18),inset_0_1px_0_0_hsl(var(--glass-highlight)/0.18)]',
            )
          : showStreamingChrome
            ? cn(
                'border border-border text-foreground shadow-[0_0_0_1px_rgba(15,23,42,0.04),0_18px_34px_rgba(15,23,42,0.08)]',
                'dark:border-border dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_32px_rgba(0,0,0,0.45)]',
                assistantChatCardBgStreaming,
              )
            : cn(
                'border border-border text-foreground shadow-[0_12px_28px_rgba(15,23,42,0.08)]',
                'dark:border-border dark:shadow-[0_10px_28px_rgba(0,0,0,0.4)]',
                assistantChatCardBg,
              ),
      )}
    >
      {showStreamingChrome && (
        <>
          <motion.div
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent"
            initial={{ x: '-120%' }}
            animate={{ x: '120%' }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        </>
      )}

      {isUser ? (
        <p className="whitespace-pre-wrap break-words break-all text-sm">{text}</p>
      ) : (
        <div className="prose prose-sm max-w-none break-words break-all text-sm leading-normal dark:prose-invert">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !className;
                if (isInline) {
                  return (
                    <code className="rounded-md bg-background/55 px-1.5 py-0.5 text-sm font-mono break-all break-words text-foreground" {...props}>
                      {children}
                    </code>
                  );
                }
                return (
                  <pre className="overflow-x-auto rounded-xl border border-border bg-background/55 p-4">
                    <code className={cn('text-sm font-mono', className)} {...props}>
                      {children}
                    </code>
                  </pre>
                );
              },
              a({ href, children }) {
                if (href?.startsWith('preview://') && onPreviewFile) {
                  const target = href.slice('preview://'.length);
                  const fileName = target.split('/').pop() || '';
                  const ext = fileName.split('.').pop()?.toLowerCase() || '';
                  const mimeMap: Record<string, string> = {
                    html: 'text/html', htm: 'text/html',
                    pdf: 'application/pdf',
                    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                    gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
                    md: 'text/markdown',
                  };
                  return (
                    <button
                      onClick={() => onPreviewFile({
                        filePath: target,
                        fileName,
                        mimeType: mimeMap[ext] || 'text/html',
                        fileSize: 0,
                        preview: null,
                      })}
                      className="inline bg-transparent border-0 p-0 text-link hover:underline break-words break-all cursor-pointer font-inherit"
                    >
                      {children}
                    </button>
                  );
                }
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-link hover:underline break-words break-all">
                    {children}
                  </a>
                );
              },
            }}
          >
            {onPreviewFile ? preprocessTextForPreviewLinks(text) : text}
          </ReactMarkdown>
          {isStreaming && (
            <StreamingCursor />
          )}
        </div>
      )}

      {showStreamingChrome && (
        <div className="relative mt-3 flex items-center justify-between gap-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2 min-w-0">
            <StreamingPulse />
            <span className="truncate font-medium tracking-[0.02em] text-foreground/80">
              {streamingLabel}
            </span>
          </div>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.24em] text-primary/70">
            输出中
          </span>
        </div>
      )}
      {!isUser && !isStreaming && (
        <div className="relative mt-3 flex items-center justify-between gap-3 border-t border-border/30 pt-2">
          <span className="truncate text-[10px] text-muted-foreground/45">{completedLabel}</span>
          <span className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-emerald-500/70 dark:text-emerald-400/60">
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {completedBadge}
          </span>
        </div>
      )}
    </div>
  );
}

/** Wrap local file paths and web URLs in preview:// markdown links so ReactMarkdown can render them as clickable buttons. */
function preprocessTextForPreviewLinks(text: string): string {
  // Protect code blocks and inline code from being modified
  const codeBlocks: string[] = [];
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  const inlineCodes: string[] = [];
  text = text.replace(/`[^`]*`/g, (match) => {
    inlineCodes.push(match);
    return `__INLINE_CODE_${inlineCodes.length - 1}__`;
  });

  // Replace web URLs
  text = text.replace(
    /(https?:\/\/[^\s)\]"',;<>]+)/g,
    '[$1](preview://$1)',
  );

  // Replace absolute file paths
  text = text.replace(
    /(\/(?:[\w.-]+\/)*[\w.-]+\.\w{2,})/g,
    '[$1](preview://$1)',
  );

  // Restore inline code
  text = text.replace(/__INLINE_CODE_(\d+)__/g, (_, i) => inlineCodes[Number(i)]);

  // Restore code blocks
  text = text.replace(/__CODE_BLOCK_(\d+)__/g, (_, i) => codeBlocks[Number(i)]);

  return text;
}

function StreamingCursor() {
  return (
    <motion.span
      className="ml-1 inline-flex h-[0.95rem] w-6 rounded-full align-[-0.1em] bg-primary/45 shadow-[0_0_0_1px_rgba(255,111,0,0.18)]"
      animate={{
        opacity: [0.35, 1, 0.45],
        scaleX: [0.92, 1.08, 0.96],
      }}
      transition={{
        duration: 1.4,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    />
  );
}

function StreamingPulse() {
  return (
    <div className="relative flex h-2.5 w-2.5 items-center justify-center">
      <motion.span
        className="absolute h-2.5 w-2.5 rounded-full bg-primary/25"
        animate={{ scale: [0.8, 1.8], opacity: [0.45, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
      />
      <motion.span
        className="relative h-1.5 w-1.5 rounded-full bg-primary"
        animate={{ scale: [0.92, 1.15, 0.92] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

// ── Thinking Block ──────────────────────────────────────────────

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'w-full rounded-2xl border border-border text-[14px] shadow-[0_10px_24px_rgba(15,23,42,0.06)]',
        assistantChatCardBg,
      )}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2.5 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="font-medium">思考过程</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-muted-foreground">
          <div className="prose prose-sm dark:prose-invert max-w-none opacity-75">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ── File Card (for user-uploaded non-image files) ───────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <FileText className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z')) return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

function FileCard({ file, onPreviewFile }: { file: AttachedFileMeta; onPreviewFile?: (file: AttachedFileMeta) => void }) {
  const handleOpen = useCallback(() => {
    if (onPreviewFile) {
      onPreviewFile(file);
    } else if (file.filePath) {
      invokeIpc('shell:openPath', file.filePath);
    }
  }, [file, onPreviewFile]);

  const isPreviewable = ['text/html', 'text/markdown', 'application/pdf'].some((t) => file.mimeType === t) || file.mimeType.startsWith('image/');

  return (
    <div 
      className={cn(
        'flex max-w-[220px] items-center gap-3 rounded-2xl border border-border px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.06)]',
        assistantChatCardBg,
        (file.filePath || onPreviewFile) && 'cursor-pointer transition-all hover:border-muted-foreground/35 hover:bg-white/[0.97] dark:hover:bg-white/[0.12]',
      )}
      onClick={handleOpen}
      title={isPreviewable ? '点击预览' : file.filePath ? '打开文件' : undefined}
    >
      <FileIcon mimeType={file.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 overflow-hidden">
        <p className="text-xs font-medium truncate">{file.fileName}</p>
        <p className="text-[10px] text-muted-foreground">
          {file.fileSize > 0 ? formatFileSize(file.fileSize) : 'File'}
        </p>
      </div>
      {isPreviewable && onPreviewFile && (
        <span className="ml-auto shrink-0 text-[10px] text-link/90">预览</span>
      )}
    </div>
  );
}

// ── Image Thumbnail (user bubble — square crop with zoom hint) ──

function ImageThumbnail({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <div
      className="group/img relative h-36 w-36 cursor-zoom-in overflow-hidden rounded-2xl border border-border bg-white/30 shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:bg-white/[0.08]"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Preview Card (assistant bubble — natural size with overlay actions) ──

function ImagePreviewCard({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <div
      className={cn(
        'group/img relative max-w-xs cursor-zoom-in overflow-hidden rounded-2xl border border-border shadow-[0_10px_24px_rgba(15,23,42,0.08)]',
        assistantChatCardBg,
      )}
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="block w-full" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Lightbox ───────────────────────────────────────────────

function ImageLightbox({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onClose,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onClose: () => void;
}) {
  void src; void base64; void mimeType; void fileName;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleShowInFolder = useCallback(() => {
    if (filePath) {
      invokeIpc('shell:showItemInFolder', filePath);
    }
  }, [filePath]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Image + buttons stacked */}
      <div
        className="flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={fileName}
          className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl object-contain"
        />

        {/* Action buttons below image */}
        <div className="flex items-center gap-2">
          {filePath && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
              onClick={handleShowInFolder}
              title="在文件夹中显示"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
            onClick={onClose}
            title="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Tool Card ───────────────────────────────────────────────────

function ToolCard({ name, input }: { name: string; input: unknown }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'rounded-2xl border border-border text-[14px] shadow-[0_10px_24px_rgba(15,23,42,0.06)]',
        assistantChatCardBg,
      )}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
        <Wrench className="h-3 w-3 shrink-0 opacity-60" />
        <span className="font-mono text-xs">{name}</span>
        {expanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
      </button>
      {expanded && input != null && (
        <pre className="overflow-x-auto px-3 pb-3 text-xs text-muted-foreground">
          {typeof input === 'string' ? input : JSON.stringify(input, null, 2) as string}
        </pre>
      )}
    </div>
  );
}
