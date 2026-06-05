/**
 * FilePreviewViewer
 * A standalone file preview component that renders various file types
 * (HTML, PDF, Markdown, web links, Office docs) in an iframe or fallback UI.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, RefreshCw, Maximize, Minimize } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hostApiFetch, getHostApiBase } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';

interface FilePreviewViewerProps {
  filePath: string;
  fileName: string;
  mimeType: string;
  className?: string;
}

/** Serve local files through the Host API to bypass browser file:// restrictions in iframes. */
function toServeUrl(filePath: string): string {
  return `${getHostApiBase()}/api/files/serve?path=${encodeURIComponent(filePath)}`;
}

export function FilePreviewViewer({
  filePath,
  fileName,
  mimeType,
  className,
}: FilePreviewViewerProps) {
  const [mdContent, setMdContent] = useState<string>('');
  const [mdLoading, setMdLoading] = useState(false);
  const [mdError, setMdError] = useState<string>('');
  const [textContent, setTextContent] = useState<string>('');
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (mimeType !== 'text/markdown') {
      setMdContent('');
      setMdError('');
      setMdLoading(false);
      return;
    }

    let cancelled = false;
    setMdContent('');
    setMdError('');
    setMdLoading(true);

    void (async () => {
      try {
        const res = await hostApiFetch<{ content: string; encoding: string }>('/api/files/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, encoding: 'utf-8' }),
        });
        if (cancelled) return;
        setMdContent(typeof res?.content === 'string' ? res.content : '');
      } catch (e) {
        if (!cancelled) {
          setMdError(e instanceof Error ? e.message : '读取失败');
        }
      } finally {
        if (!cancelled) setMdLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, mimeType]);

  // Load plain text / code / json files
  useEffect(() => {
    const isTextFile = mimeType === 'text/plain' || mimeType === 'application/json' || mimeType === 'text/csv';
    if (!isTextFile) {
      setTextContent('');
      setTextError('');
      setTextLoading(false);
      return;
    }

    let cancelled = false;
    setTextContent('');
    setTextError('');
    setTextLoading(true);

    void (async () => {
      try {
        const res = await hostApiFetch<{ content: string; encoding: string }>('/api/files/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, encoding: 'utf-8' }),
        });
        if (cancelled) return;
        setTextContent(typeof res?.content === 'string' ? res.content : '');
      } catch (e) {
        if (!cancelled) {
          setTextError(e instanceof Error ? e.message : '读取失败');
        }
      } finally {
        if (!cancelled) setTextLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, mimeType]);

  const content = (() => {
  // Web URLs (http/https) are no longer routed through the built-in preview viewer
  // because many sites have anti-hotlink / X-Frame-Options / CSP blocking.
  // They are opened directly in the external browser instead.
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-sm text-muted-foreground', className)}>
        <FileText className="h-10 w-10 opacity-40" />
        <p>{fileName}</p>
        <OpenExternalButton filePath={filePath} />
      </div>
    );
  }

  // PDF preview
  if (mimeType === 'application/pdf') {
    return (
      <iframe
        key={filePath}
        src={toServeUrl(filePath)}
        title={fileName}
        className={cn('h-full min-w-0 w-full border-0', className)}
      />
    );
  }
  // Local HTML file preview — serve through Host API to bypass browser restrictions
  // Fallback to extension check when mimeType is mis-detected as application/octet-stream
  const isHtmlFile = mimeType === 'text/html' || (() => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    return ext === 'html' || ext === 'htm';
  })();
  if (isHtmlFile) {
    return (
      <iframe
        key={filePath}
        src={toServeUrl(filePath)}
        title={fileName}
        className={cn('h-full min-w-0 w-full border-0', className)}
        sandbox="allow-scripts allow-same-origin"
      />
    );
  }

  // Markdown preview (converted to HTML srcdoc)
  if (mimeType === 'text/markdown') {
    if (mdLoading) {
      return (
        <div className={cn('flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground', className)}>
          <RefreshCw className="h-5 w-5 animate-spin" />
          正在加载预览…
        </div>
      );
    }
    if (mdError) {
      return (
        <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-sm', className)}>
          <p className="text-destructive">{mdError}</p>
          <OpenExternalButton filePath={filePath} />
        </div>
      );
    }
    const srcDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.6;max-width:800px;margin:40px auto;padding:0 20px;color:#333;background:#fff}
h1,h2,h3,h4,h5,h6{margin-top:1.5em;margin-bottom:0.5em}
code{background:#f4f4f4;padding:2px 6px;border-radius:3px;font-size:0.9em}
pre{background:#f4f4f4;padding:16px;border-radius:6px;overflow-x:auto}
blockquote{border-left:4px solid #ddd;margin:0;padding-left:16px;color:#666}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #ddd;padding:8px;text-align:left}
th{background:#f8f8f8}
img{max-width:100%}
</style>
</head>
<body>${(mdContent ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</body>
</html>`;

    return (
      <iframe
        key={filePath}
        srcDoc={srcDoc}
        title={fileName}
        className={cn('h-full min-w-0 w-full border-0', className)}
        sandbox="allow-scripts"
      />
    );
  }

  // Plain text / code / json / csv preview
  if (mimeType === 'text/plain' || mimeType === 'application/json' || mimeType === 'text/csv') {
    if (textLoading) {
      return (
        <div className={cn('flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground', className)}>
          <RefreshCw className="h-5 w-5 animate-spin" />
          正在加载文件…
        </div>
      );
    }
    if (textError) {
      return (
        <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-sm', className)}>
          <p className="text-destructive">{textError}</p>
          <OpenExternalButton filePath={filePath} />
        </div>
      );
    }
    return (
      <div className={cn('h-full overflow-auto bg-[#1e1e1e] text-[#d4d4d4] p-4', className)}>
        <pre className="text-sm font-mono whitespace-pre">{textContent}</pre>
      </div>
    );
  }

  // Fallback for other previewable types (Office docs, etc.)
  return (
    <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-sm text-muted-foreground', className)}>
      <FileText className="h-10 w-10 opacity-40" />
      <p>{fileName}</p>
      <OpenExternalButton filePath={filePath} />
    </div>
  );
  })();

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {content}
      {/* Fullscreen toggle button */}
      <button
        onClick={toggleFullscreen}
        title={isFullscreen ? '退出全屏' : '全屏放映'}
        className="absolute right-3 bottom-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-opacity hover:bg-black/70 opacity-0 hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
        style={{ opacity: isFullscreen ? 0.7 : undefined }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.9'; }}
        onMouseLeave={(e) => { if (!isFullscreen) (e.currentTarget as HTMLButtonElement).style.opacity = '0'; }}
      >
        {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
      </button>
    </div>
  );
}

function OpenExternalButton({ filePath }: { filePath: string }) {
  const handleOpen = () => {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      window.electron.openExternal(filePath);
    } else {
      void invokeIpc('shell:openPath', filePath);
    }
  };

  return (
    <button
      onClick={handleOpen}
      className="inline-flex items-center gap-1.5 rounded-md bg-link-muted px-3 py-1.5 text-xs text-link transition-colors hover:bg-[#D8E1FF]"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      在外部打开
    </button>
  );
}
