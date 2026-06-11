/**
 * FilePreviewViewer
 * A standalone file preview component that renders various file types
 * (HTML, PDF, Markdown, web links, Office docs, CSV, code) in an iframe or fallback UI.
 */
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { ExternalLink, FileText, RefreshCw, Maximize, Minimize, Table, FileSpreadsheet, Presentation } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { hostApiFetch, getHostApiBase } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { isHttpUrl } from '@/lib/preview-url';
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
  if (filePath && /\.html?(?:\?|$)/i.test(filePath)) return true;
  return false;
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
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [htmlLoading, setHtmlLoading] = useState(false);
  const [htmlError, setHtmlError] = useState<string>('');
  const [officeData, setOfficeData] = useState<OfficeData | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [officeError, setOfficeError] = useState<string>('');
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
    if (mimeType !== 'text/markdown' || isHttpUrl(filePath)) {
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

  // Load local plain text / code / json / csv / tsv files
  useEffect(() => {
    const isText = !isHttpUrl(filePath) && (
      mimeType === 'text/plain' ||
      mimeType === 'application/json' ||
      mimeType === 'text/csv' ||
      mimeType === 'text/tab-separated-values' ||
      isCodeFile(filePath, mimeType)
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

  // Fetch remote HTML (OSS often sets Content-Disposition: attachment — iframe src triggers download)
  useEffect(() => {
    const isRemoteHtml = isHttpUrl(filePath) && isHtmlFileType(mimeType, fileName, filePath);
    if (!isRemoteHtml) {
      setHtmlContent('');
      setHtmlError('');
      setHtmlLoading(false);
      return;
    }

    let cancelled = false;
    setHtmlContent('');
    setHtmlError('');
    setHtmlLoading(true);

    void (async () => {
      try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const content = await response.text();
        if (cancelled) return;
        setHtmlContent(content);
      } catch (e) {
        if (!cancelled) {
          setHtmlError(e instanceof Error ? e.message : '加载 HTML 预览失败');
        }
      } finally {
        if (!cancelled) setHtmlLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, mimeType, fileName]);

  // Load remote text/json/markdown from http(s) URLs (OSS/CDN)
  useEffect(() => {
    const isRemoteTextFile = isHttpUrl(filePath)
      && (mimeType === 'text/plain' || mimeType === 'application/json' || mimeType === 'text/csv' || mimeType === 'text/markdown');
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
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const content = await response.text();
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
  }, [filePath, mimeType]);

  // Load local Office files (Excel / Word / PPT)
  useEffect(() => {
    if (isHttpUrl(filePath)) {
      setOfficeData(null);
      setOfficeLoading(false);
      setOfficeError('');
      return;
    }

    const office = isOfficeFile(mimeType, filePath);
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
        const readRes = await hostApiFetch<{ content: string; encoding: string }>('/api/files/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, encoding: 'base64' }),
        });
        const base64 = readRes?.content;
        if (!base64) throw new Error('无法读取文件内容');
        const binary = atob(base64);
        const buffer = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);

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
            const result = await mammoth.convertToHtml({ arrayBuffer: buffer.buffer });
            if (!cancelled) setOfficeData({ type: 'word', html: result.value });
          } catch {
            throw new Error('Word 预览库未安装（pnpm add mammoth）');
          }
        } else if (office.type === 'ppt') {
          if (!cancelled) setOfficeData({ type: 'ppt', buffer });
        }
      } catch (e) {
        if (!cancelled) {
          setOfficeError(e instanceof Error ? e.message : '预览失败');
        }
      } finally {
        if (!cancelled) setOfficeLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, mimeType]);

  const tableData = useMemo(() => {
    if (!textContent || (mimeType !== 'text/csv' && mimeType !== 'text/tab-separated-values')) return null;
    const delimiter = mimeType === 'text/tab-separated-values' ? '\t' : ',';
    return textContent.split('\n').map((row) => row.split(delimiter));
  }, [textContent, mimeType]);

  const highlightedHtml = useMemo(() => {
    if (!textContent) return '';
    if (mimeType === 'text/csv' || mimeType === 'text/tab-separated-values') return '';

    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const lang = extToHljsLang(ext);

    if (mimeType === 'application/json') {
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

    if (isCodeFile(filePath, mimeType)) {
      const auto = hljs.highlightAuto(textContent);
      return auto.value;
    }

    return '';
  }, [textContent, filePath, mimeType]);

  const content = (() => {
    if (isHttpUrl(filePath)) {
      const isHtmlFile = isHtmlFileType(mimeType, fileName, filePath);

      if (isHtmlFile) {
        if (htmlLoading) {
          return (
            <div className={cn('flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground', className)}>
              <RefreshCw className="h-5 w-5 animate-spin" />
              正在加载 HTML 预览…
            </div>
          );
        }
        if (htmlError) {
          return (
            <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-sm', className)}>
              <p className="text-destructive">{htmlError}</p>
              <OpenExternalButton filePath={filePath} />
            </div>
          );
        }
        if (htmlContent) {
          return (
            <iframe
              key={filePath}
              srcDoc={htmlContent}
              title={fileName}
              className={cn('h-full min-w-0 w-full border-0', className)}
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          );
        }
      }

      if (mimeType === 'application/pdf') {
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

      if (mimeType === 'text/markdown') {
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

    const isHtmlFile = isHtmlFileType(mimeType, fileName, filePath);
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
      mimeType === 'text/plain' ||
      mimeType === 'application/json' ||
      isCodeFile(filePath, mimeType);

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

    const office = isOfficeFile(mimeType, filePath);
    if (office.type) {
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
          remarkPlugins={[remarkGfm]}
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
