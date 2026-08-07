/**
 * FilePreviewViewer
 * A standalone file preview component that renders various file types
 * (HTML, PDF, Markdown, web links, Office docs, CSV, code) in an iframe or fallback UI.
 */
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { ExternalLink, FileText, RefreshCw, Maximize, Minimize, Table, FileSpreadsheet, Presentation } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { chatRemarkPlugins } from '@/lib/remark-gfm-chat';
import { cn } from '@/lib/utils';
import { hostApiFetch, getHostApiBase } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { previewBridgeHttpFetch } from '@/lib/preview-bridge-fetch';
import { isExtensionlessWebUrl, isHttpUrl, isRemoteFileHtmlUrl, normalizeLocalFilePath, resolvePreviewMimeType } from '@/lib/preview-url';
import { loadPreviewBinary, uint8ArrayToArrayBuffer } from '@/lib/preview-binary-load';
import { resolvePreviewPathOnHost } from '@/lib/preview-href';
import {
  HTML_PREVIEW_IFRAME_SANDBOX,
  isPreviewHttpFetchMessage,
  preparePreviewSrcDoc,
} from '@/lib/preview-srcdoc';
import { UserWatermark } from '@/components/layout/UserWatermark';
// @ts-ignore — highlight.js v10 ships without bundled .d.ts
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';

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

function isHtmlFileType(mimeType: string, fileName: string, filePath?: string): boolean {
  if (mimeType === 'text/html') return true;
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'html' || ext === 'htm') return true;
  if (filePath && /\.html?(?:\?|#|$)/i.test(filePath)) return true;
  if (filePath && isHttpUrl(filePath) && isExtensionlessWebUrl(filePath)) return true;
  return false;
}

function isImageFileType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

async function fetchRemotePreviewText(filePath: string): Promise<string> {
  const result = await previewBridgeHttpFetch({
    url: filePath,
    allowedOrigin: new URL(filePath).origin,
  });
  if (!result.ok || !result.bodyBase64) {
    throw new Error(result.error || `HTTP ${result.status ?? 'error'}`);
  }
  const bytes = Uint8Array.from(atob(result.bodyBase64), (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/** Map file extension to highlight.js language name. */
function extToHljsLang(ext: string): string | undefined {
  const map: Record<string, string> = {
    js: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', sql: 'sql',
    java: 'java', go: 'go', rs: 'rust',
    cpp: 'cpp', c: 'c', h: 'cpp',
    cs: 'csharp', rb: 'ruby', php: 'php',
    swift: 'swift', kt: 'kotlin', scala: 'scala',
    r: 'r', m: 'matlab', mm: 'objectivec',
    json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml',
    html: 'xml', htm: 'xml',
    css: 'css', scss: 'scss', less: 'less',
    sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
    ps1: 'powershell', bat: 'dos', cmd: 'dos',
    md: 'markdown',
  };
  return map[ext];
}

/** Detect if a file is a code file by extension. */
function isCodeFile(filePath: string, mimeType: string): boolean {
  if (mimeType === 'application/json') return true;
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const codeExts = ['js', 'jsx', 'ts', 'tsx', 'py', 'sql', 'java', 'go', 'rs', 'cpp', 'c', 'h', 'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'r', 'm', 'mm', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'properties', 'env', 'css', 'scss', 'less', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'];
  return codeExts.includes(ext);
}

/** Detect Office file types. */
function isOfficeFile(mimeType: string, filePath: string): { type: 'excel' | 'word' | 'ppt' | null } {
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  ) return { type: 'excel' };
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) return { type: 'word' };
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint'
  ) return { type: 'ppt' };
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (ext === 'xlsx' || ext === 'xls') return { type: 'excel' };
  if (ext === 'docx' || ext === 'doc') return { type: 'word' };
  if (ext === 'pptx' || ext === 'ppt') return { type: 'ppt' };
  return { type: null };
}

type OfficeData =
  | { type: 'excel'; data: unknown[][] }
  | { type: 'word'; html: string }
  | { type: 'ppt'; buffer: Uint8Array };

export function FilePreviewViewer({
  filePath: rawFilePath,
  fileName,
  mimeType,
  className,
}: FilePreviewViewerProps) {
  const [resolvedPath, setResolvedPath] = useState(() => normalizeLocalFilePath(rawFilePath));
  const filePath = useMemo(() => resolvedPath, [resolvedPath]);
  const effectiveMime = useMemo(
    () => resolvePreviewMimeType(mimeType, filePath, fileName),
    [mimeType, filePath, fileName],
  );
  const resolveAttemptedRef = useRef(false);

  useEffect(() => {
    const next = normalizeLocalFilePath(rawFilePath);
    setResolvedPath(next);
    resolveAttemptedRef.current = false;
  }, [rawFilePath]);

  const retryResolvePath = useCallback(async (hint: string): Promise<string | null> => {
    if (isHttpUrl(hint) || resolveAttemptedRef.current) return null;
    resolveAttemptedRef.current = true;
    try {
      const resolved = await resolvePreviewPathOnHost(hint);
      if (resolved.exists && resolved.path !== hint) {
        setResolvedPath(normalizeLocalFilePath(resolved.path));
        return resolved.path;
      }
      if (resolved.exists) return resolved.path;
    } catch {
      // ignore — fall through to original error UI
    }
    return null;
  }, []);

  useEffect(() => {
    if (isHttpUrl(resolvedPath)) return;
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await resolvePreviewPathOnHost(resolvedPath);
        if (cancelled || !resolved.exists || resolved.path === resolvedPath) return;
        resolveAttemptedRef.current = true;
        setResolvedPath(normalizeLocalFilePath(resolved.path));
      } catch {
        // preview still attempts read with original hint
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawFilePath]);
  const [mdContent, setMdContent] = useState<string>('');
  const [mdLoading, setMdLoading] = useState(false);
  const [mdError, setMdError] = useState<string>('');
  const [textContent, setTextContent] = useState<string>('');
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState<string>('');
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [htmlLoading, setHtmlLoading] = useState(false);
  const [officeData, setOfficeData] = useState<OfficeData | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [officeError, setOfficeError] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => {
      const fs = document.fullscreenElement;
      const el = containerRef.current;
      setIsFullscreen(!!fs && !!el && (fs === el || fs.contains(el)));
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
    if (effectiveMime !== 'text/markdown' || isHttpUrl(filePath)) {
      if (!isHttpUrl(filePath)) {
        setMdContent('');
        setMdError('');
        setMdLoading(false);
      }
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
          const msg = e instanceof Error ? e.message : '读取失败';
          if (!isHttpUrl(filePath) && /ENOENT|不存在|not found/i.test(msg)) {
            const resolved = await retryResolvePath(filePath);
            if (resolved && !cancelled) return;
          }
          setMdError(msg);
        }
      } finally {
        if (!cancelled) setMdLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, effectiveMime, retryResolvePath]);

  // Load local plain text / code / json / csv / tsv files
  useEffect(() => {
    const office = isOfficeFile(effectiveMime, filePath);
    const isText = !isHttpUrl(filePath) && !office.type && (
      effectiveMime === 'text/plain' ||
      effectiveMime === 'application/json' ||
      effectiveMime === 'text/csv' ||
      effectiveMime === 'text/tab-separated-values' ||
      isCodeFile(filePath, effectiveMime)
    );

    if (!isText) {
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
          const msg = e instanceof Error ? e.message : '读取失败';
          if (!isHttpUrl(filePath) && /ENOENT|不存在|not found/i.test(msg)) {
            const resolved = await retryResolvePath(filePath);
            if (resolved && !cancelled) return;
          }
          setTextError(msg);
        }
      } finally {
        if (!cancelled) setTextLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, effectiveMime, retryResolvePath]);

  // Fetch remote .html/.htm on OSS/CDN
  useEffect(() => {
    const shouldFetch = isHttpUrl(filePath)
      && isHtmlFileType(effectiveMime, fileName, filePath)
      && isRemoteFileHtmlUrl(filePath);
    if (!shouldFetch) {
      setHtmlContent('');
      setHtmlLoading(false);
      return;
    }

    let cancelled = false;
    setHtmlContent('');
    setHtmlLoading(true);

    void (async () => {
      try {
        const content = await fetchRemotePreviewText(filePath);
        if (cancelled) return;
        setHtmlContent(content);
      } catch {
        // Fall through to iframe src when fetch fails (CORS, attachment headers, etc.)
      } finally {
        if (!cancelled) setHtmlLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, effectiveMime, fileName]);

  // Load remote text/json/markdown from http(s) URLs (OSS/CDN)
  useEffect(() => {
    const office = isOfficeFile(effectiveMime, filePath);
    const isRemoteTextFile = isHttpUrl(filePath) && !office.type
      && (effectiveMime === 'text/plain' || effectiveMime === 'application/json'
        || effectiveMime === 'text/csv' || effectiveMime === 'text/markdown');
    if (!isRemoteTextFile) {
      if (isHttpUrl(filePath)) return;
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
        const content = await fetchRemotePreviewText(filePath);
        if (cancelled) return;
        setTextContent(content);
      } catch (e) {
        if (!cancelled) {
          setTextError(e instanceof Error ? e.message : '加载远程文件失败');
        }
      } finally {
        if (!cancelled) setTextLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, effectiveMime]);

  // Load Office files (Excel / Word / PPT) — local paths and remote OSS URLs
  useEffect(() => {
    const office = isOfficeFile(effectiveMime, filePath);
    if (!office.type) {
      setOfficeData(null);
      setOfficeLoading(false);
      setOfficeError('');
      return;
    }

    let cancelled = false;
    setOfficeData(null);
    setOfficeError('');
    setOfficeLoading(true);

    void (async () => {
      try {
        const buffer = await loadPreviewBinary(filePath);

        if (office.type === 'excel') {
          try {
            // @ts-ignore
            const XLSX = await import(/* @vite-ignore */ 'xlsx');
            const workbook = XLSX.read(buffer, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][];
            if (!cancelled) setOfficeData({ type: 'excel', data });
          } catch {
            throw new Error('Excel 预览库未安装（pnpm add xlsx）');
          }
        } else if (office.type === 'word') {
          try {
            // @ts-ignore
            const mammoth = await import(/* @vite-ignore */ 'mammoth');
            const result = await mammoth.convertToHtml({
              arrayBuffer: uint8ArrayToArrayBuffer(buffer),
            });
            if (!cancelled) setOfficeData({ type: 'word', html: result.value });
          } catch {
            throw new Error('Word 预览库未安装（pnpm add mammoth）');
          }
        } else if (office.type === 'ppt') {
          if (!cancelled) setOfficeData({ type: 'ppt', buffer });
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : '预览失败';
          if (!isHttpUrl(filePath) && /ENOENT|不存在|not found/i.test(msg)) {
            const resolved = await retryResolvePath(filePath);
            if (resolved && !cancelled) return;
          }
          setOfficeError(msg);
        }
      } finally {
        if (!cancelled) setOfficeLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, effectiveMime, retryResolvePath]);

  const tableData = useMemo(() => {
    if (isOfficeFile(effectiveMime, filePath).type) return null;
    if (!textContent || (effectiveMime !== 'text/csv' && effectiveMime !== 'text/tab-separated-values')) return null;
    const delimiter = effectiveMime === 'text/tab-separated-values' ? '\t' : ',';
    return textContent.split('\n').map((row) => row.split(delimiter));
  }, [textContent, effectiveMime, filePath]);

  const highlightedHtml = useMemo(() => {
    if (!textContent) return '';
    if (effectiveMime === 'text/csv' || effectiveMime === 'text/tab-separated-values') return '';

    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const lang = extToHljsLang(ext);

    if (effectiveMime === 'application/json') {
      try {
        const formatted = JSON.stringify(JSON.parse(textContent), null, 2);
        return hljs.highlight(formatted, { language: 'json' }).value;
      } catch {
        return hljs.highlight(textContent, { language: 'json' }).value;
      }
    }

    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(textContent, { language: lang }).value;
    }

    if (isCodeFile(filePath, effectiveMime)) {
      const auto = hljs.highlightAuto(textContent);
      return auto.value;
    }

    return '';
  }, [textContent, filePath, effectiveMime]);

  const renderOfficePreview = () => {
    const office = isOfficeFile(effectiveMime, filePath);
    if (!office.type) return null;

    const Icon = office.type === 'excel' ? FileSpreadsheet : office.type === 'ppt' ? Presentation : FileText;
    const label = office.type === 'excel' ? 'Excel' : office.type === 'ppt' ? 'PowerPoint' : 'Word';

    if (officeLoading) {
      return (
        <div className={cn('flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground', className)}>
          <RefreshCw className="h-5 w-5 animate-spin" />
          正在解析 {label} 文件…
        </div>
      );
    }

    if (officeError) {
      const isMissingLib = officeError.includes('未安装');
      let friendlyError = officeError;
      if (officeError.includes('EPERM') || officeError.includes('EACCES')) {
        friendlyError = '文件被系统锁定，暂时无法预览';
      } else if (officeError.includes('ENOENT')) {
        friendlyError = '文件不存在或路径有误';
      }
      return (
        <div className={cn('flex h-full flex-col items-center justify-center gap-4 px-6 text-sm text-muted-foreground', className)}>
          <Icon className="h-12 w-12 opacity-40" />
          <div className="text-center">
            <p className="font-medium text-foreground">{fileName}</p>
            <p className="mt-1 text-xs text-destructive">{friendlyError}</p>
            {isMissingLib && (
              <p className="mt-1 text-xs">安装依赖后可预览：{office.type === 'excel' ? 'pnpm add xlsx' : 'pnpm add mammoth'}</p>
            )}
          </div>
          <OpenExternalButton filePath={filePath} />
        </div>
      );
    }

    if (officeData?.type === 'excel' && officeData.data.length > 0) {
      const data = officeData.data;
      return (
        <div className={cn('h-full overflow-auto bg-white dark:bg-[#0d1117] p-4', className)}>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <FileSpreadsheet className="h-4 w-4" />
            <span>{data.length} 行 · {data[0]?.length ?? 0} 列</span>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/60">
                {Array.isArray(data[0]) && data[0].map((cell, i) => (
                  <th key={i} className="border border-border px-3 py-2 text-left font-medium text-foreground">
                    {String(cell ?? '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(1).map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                  {Array.isArray(row) && row.map((cell, ci) => (
                    <td key={ci} className="border border-border px-3 py-2 text-foreground">
                      {String(cell ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (officeData?.type === 'word') {
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
<body>${officeData.html}</body>
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

    if (officeData?.type === 'ppt') {
      return <PptxPreviewPanel buffer={officeData.buffer} className={className} />;
    }

    return null;
  };

  const content = (() => {
    const officePreview = renderOfficePreview();
    if (officePreview) return officePreview;

    if (isHttpUrl(filePath)) {
      const isHtmlFile = isHtmlFileType(effectiveMime, fileName, filePath);

      if (isHtmlFile) {
        if (isRemoteFileHtmlUrl(filePath)) {
          if (htmlLoading) {
            return (
              <div className={cn('flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground', className)}>
                <RefreshCw className="h-5 w-5 animate-spin" />
                正在加载 HTML 预览…
              </div>
            );
          }
          if (htmlContent) {
            return (
              <RemoteSrcDocPreview
                key={filePath}
                html={htmlContent}
                sourceUrl={filePath}
                fileName={fileName}
                className={className}
              />
            );
          }
        }
        return (
          <HtmlIframeView
            src={filePath}
            fileName={fileName}
            className={className}
          />
        );
      }

      if (isImageFileType(effectiveMime)) {
        return <ImagePreview src={filePath} fileName={fileName} className={className} />;
      }

      if (effectiveMime === 'application/pdf') {
        return (
          <iframe
            key={filePath}
            src={filePath}
            title={fileName}
            className={cn('h-full min-w-0 w-full border-0', className)}
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        );
      }

      if (effectiveMime === 'text/markdown') {
        if (textLoading) {
          return (
            <div className={cn('flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground', className)}>
              <RefreshCw className="h-5 w-5 animate-spin" />
              正在加载预览…
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
        if (textContent) {
          return <MarkdownPreviewPane content={textContent} className={className} />;
        }
      }

      if (effectiveMime === 'text/plain' || effectiveMime === 'application/json' || effectiveMime === 'text/csv') {
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
        if (textContent) {
          return (
            <div className={cn('h-full overflow-auto bg-[#1e1e1e] text-[#d4d4d4] p-4', className)}>
              <pre className="text-sm font-mono whitespace-pre-wrap break-words">{textContent}</pre>
            </div>
          );
        }
      }

      return (
        <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-sm text-muted-foreground', className)}>
          <FileText className="h-10 w-10 opacity-40" />
          <p>{fileName}</p>
          <OpenExternalButton filePath={filePath} />
        </div>
      );
    }

    if (isImageFileType(effectiveMime)) {
      return <ImagePreview src={toServeUrl(filePath)} fileName={fileName} className={className} />;
    }

    if (effectiveMime === 'application/pdf') {
      return (
        <iframe
          key={filePath}
          src={toServeUrl(filePath)}
          title={fileName}
          className={cn('h-full min-w-0 w-full border-0', className)}
        />
      );
    }

    const isHtmlFile = isHtmlFileType(effectiveMime, fileName, filePath);
    if (isHtmlFile) {
      return (
        <HtmlIframeView
          src={toServeUrl(filePath)}
          fileName={fileName}
          className={className}
        />
      );
    }

    if (effectiveMime === 'text/markdown') {
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
      return <MarkdownPreviewPane content={mdContent ?? ''} className={className} />;
    }

    if (tableData && tableData.length > 0) {
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
        <div className={cn('h-full overflow-auto bg-white dark:bg-[#0d1117] p-4', className)}>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Table className="h-4 w-4" />
            <span>{tableData.length} 行 · {tableData[0]?.length ?? 0} 列</span>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/60">
                {tableData[0]?.map((cell, i) => (
                  <th key={i} className="border border-border px-3 py-2 text-left font-medium text-foreground">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.slice(1).map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-border px-3 py-2 text-foreground">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    const isText =
      effectiveMime === 'text/plain' ||
      effectiveMime === 'application/json' ||
      isCodeFile(filePath, effectiveMime);

    if (isText) {
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

      if (highlightedHtml) {
        return (
          <div className={cn('file-preview-code h-full overflow-auto bg-[#1e1e1e] p-4', className)}>
            <pre className="hljs !m-0 !bg-transparent text-sm font-mono whitespace-pre text-[#d4d4d4]">
              <code
                className="hljs !bg-transparent text-[#d4d4d4]"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            </pre>
          </div>
        );
      }

      return (
        <div className={cn('file-preview-code h-full overflow-auto bg-[#1e1e1e] p-4', className)}>
          <pre className="text-sm font-mono whitespace-pre text-[#d4d4d4]">{textContent}</pre>
        </div>
      );
    }

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
      {/* Fullscreen leaves the app shell; keep a local copy so artifacts stay watermarked. */}
      {isFullscreen ? <UserWatermark mode="absolute" /> : null}
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

function ImagePreview({ src, fileName, className }: { src: string; fileName: string; className?: string }) {
  return (
    <div className={cn('flex h-full w-full items-center justify-center overflow-auto bg-white p-6 dark:bg-[#0d1117]', className)}>
      <img
        src={src}
        alt={fileName}
        className="max-h-full max-w-full object-contain"
        draggable={false}
      />
    </div>
  );
}

function PptxPreviewPanel({ buffer, className }: { buffer: Uint8Array; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<any>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setError('');

    void (async () => {
      try {
        // @ts-ignore
        const { init } = await import(/* @vite-ignore */ 'pptx-preview');
        if (cancelled) return;

        if (containerRef.current && !previewerRef.current) {
          previewerRef.current = init(containerRef.current, {
            width: 960,
            height: 540,
          });
        }

        previewerRef.current?.preview(buffer.buffer);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'PPT 预览失败');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [buffer]);

  if (error) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-4 px-6 text-sm text-muted-foreground', className)}>
        <Presentation className="h-12 w-12 opacity-40" />
        <p className="text-destructive">{error}</p>
        <p className="text-xs">pptx-preview 库未安装（pnpm add pptx-preview）</p>
      </div>
    );
  }

  return <div ref={containerRef} className={cn('h-full w-full', className)} />;
}

function MarkdownPreviewPane({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('h-full overflow-auto bg-white px-6 py-5 dark:bg-[#0d1117]', className)}>
      <article className="prose prose-sm max-w-none text-foreground dark:prose-invert">
        <ReactMarkdown
          remarkPlugins={chatRemarkPlugins}
          components={{
            code({ className: codeClassName, children, ...props }) {
              const match = /language-(\w+)/.exec(codeClassName || '');
              const isInline = !match && !codeClassName;
              if (isInline) {
                return (
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.9em] font-mono" {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <pre className="overflow-x-auto rounded-lg border border-border bg-[#282c34] p-4">
                  <code className={cn('text-sm font-mono text-[#abb2bf]', codeClassName)} {...props}>
                    {children}
                  </code>
                </pre>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}

function RemoteSrcDocPreview({
  html,
  sourceUrl,
  fileName,
  className,
}: {
  html: string;
  sourceUrl: string;
  fileName: string;
  className?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => preparePreviewSrcDoc(html, sourceUrl), [html, sourceUrl]);

  useEffect(() => {
    let artifactOrigin = '';
    try {
      artifactOrigin = new URL(sourceUrl).origin;
    } catch {
      return;
    }

    const onMessage = (event: MessageEvent) => {
      if (iframeRef.current?.contentWindow !== event.source) return;
      if (!isPreviewHttpFetchMessage(event.data)) return;

      let targetOrigin = '';
      try {
        targetOrigin = new URL(event.data.url).origin;
      } catch {
        event.source?.postMessage({
          type: 'preview-http-fetch-response',
          requestId: event.data.requestId,
          error: 'Invalid fetch URL',
        }, { targetOrigin: '*' });
        return;
      }

      if (!artifactOrigin || artifactOrigin !== targetOrigin) {
        event.source?.postMessage({
          type: 'preview-http-fetch-response',
          requestId: event.data.requestId,
          error: 'Preview fetch blocked: origin mismatch',
        }, { targetOrigin: '*' });
        return;
      }

      void (async () => {
        try {
          const result = await previewBridgeHttpFetch({
            url: event.data.url,
            allowedOrigin: artifactOrigin,
            method: event.data.method,
            headers: event.data.headers,
            body: event.data.body,
          });

          if (!result?.ok) {
            event.source?.postMessage({
              type: 'preview-http-fetch-response',
              requestId: event.data.requestId,
              error: result?.error || 'Preview fetch failed',
            }, { targetOrigin: '*' });
            return;
          }

          event.source?.postMessage({
            type: 'preview-http-fetch-response',
            requestId: event.data.requestId,
            status: result.status,
            headers: result.headers,
            bodyBase64: result.bodyBase64,
          }, { targetOrigin: '*' });
        } catch (error) {
          event.source?.postMessage({
            type: 'preview-http-fetch-response',
            requestId: event.data.requestId,
            error: error instanceof Error ? error.message : 'Preview fetch failed',
          }, { targetOrigin: '*' });
        }
      })();
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sourceUrl]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      title={fileName}
      className={cn('h-full min-h-0 w-full border-0', className)}
      sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
    />
  );
}

function HtmlIframeView({
  src,
  fileName,
  className,
}: {
  src: string;
  fileName: string;
  className?: string;
}) {
  return (
    <iframe
      key={src}
      src={src}
      title={fileName}
      className={cn('h-full min-h-0 w-full border-0', className)}
      sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
    />
  );
}

function OpenExternalButton({ filePath }: { filePath: string }) {
  const handleOpen = () => {
    if (isHttpUrl(filePath)) {
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
