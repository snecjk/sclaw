/**
 * FilePreviewViewer
 * A standalone file preview component that renders various file types
 * (HTML, PDF, Markdown, web links, Office docs) in an iframe or fallback UI.
 */
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FileText, RefreshCw } from 'lucide-react';
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

  const loadMarkdown = useCallback(async () => {
    if (mdContent || mdLoading) return;
    setMdLoading(true);
    setMdError('');
    try {
      const res = await hostApiFetch<{ content: string; encoding: string }>('/api/files/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, encoding: 'utf-8' }),
      });
      setMdContent(res.content);
    } catch {
      setMdError('读取失败');
    } finally {
      setMdLoading(false);
    }
  }, [filePath, mdContent, mdLoading]);

  useEffect(() => {
    if (mimeType === 'text/markdown') {
      void loadMarkdown();
    }
  }, [mimeType, loadMarkdown]);

  // Web URL preview (localhost and external)
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return (
      <iframe
        src={filePath}
        title={fileName}
        className={cn('h-full w-full border-0', className)}
      />
    );
  }

  // PDF preview
  if (mimeType === 'application/pdf') {
    return (
      <iframe
        src={toServeUrl(filePath)}
        title={fileName}
        className={cn('h-full w-full border-0', className)}
      />
    );
  }

  // Local HTML file preview — serve through Host API to bypass browser restrictions
  if (mimeType === 'text/html') {
    return (
      <iframe
        src={toServeUrl(filePath)}
        title={fileName}
        className={cn('h-full w-full border-0', className)}
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
<body>${mdContent.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</body>
</html>`;

    return (
      <iframe
        srcDoc={srcDoc}
        title={fileName}
        className={cn('h-full w-full border-0', className)}
        sandbox="allow-scripts"
      />
    );
  }

  // Fallback for other previewable types (Office docs, txt, csv, json, etc.)
  return (
    <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-sm text-muted-foreground', className)}>
      <FileText className="h-10 w-10 opacity-40" />
      <p>{fileName}</p>
      <OpenExternalButton filePath={filePath} />
    </div>
  );
}

function OpenExternalButton({ filePath }: { filePath: string }) {
  const handleOpen = useCallback(() => {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      window.electron.openExternal(filePath);
    } else {
      invokeIpc('shell:openPath', filePath);
    }
  }, [filePath]);

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
