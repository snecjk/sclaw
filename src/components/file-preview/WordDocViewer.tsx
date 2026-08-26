/**
 * WordDocViewer — Word 文档预览
 *
 * 渲染策略（对齐 Kimi OfficePreview 的 docx 分支）：
 * 1. 优先 docx-preview（保留原排版：分页/页眉页脚/表格/图片），适应宽度缩放
 * 2. docx-preview 未安装或渲染失败 → mammoth 转 HTML（iframe srcDoc 兜底）
 *
 * 注：docx-preview 为可选增强依赖，`pnpm add docx-preview` 后自动启用，
 * 不需要改任何代码。
 */
import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { uint8ArrayToArrayBuffer } from '@/lib/preview-binary-load';
import { PreviewLoading } from './PreviewLoading';

interface WordDocViewerProps {
  buffer: Uint8Array;
  fileName: string;
  className?: string;
}

/** mammoth 兜底时的文档 HTML 外壳样式（沿用原 FilePreviewViewer 的排版） */
const MAMMOTH_SHELL_STYLE = `
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.6;max-width:800px;margin:40px auto;padding:0 20px;color:#333;background:#fff}
h1,h2,h3,h4,h5,h6{margin-top:1.5em;margin-bottom:0.5em}
code{background:#f4f4f4;padding:2px 6px;border-radius:3px;font-size:0.9em}
pre{background:#f4f4f4;padding:16px;border-radius:6px;overflow-x:auto}
blockquote{border-left:4px solid #ddd;margin:0;padding-left:16px;color:#666}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #ddd;padding:8px;text-align:left}
th{background:#f8f8f8}
img{max-width:100%}
`;

export function WordDocViewer({ buffer, fileName, className }: WordDocViewerProps) {
  const { t } = useTranslation('chat');
  const containerRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [docxRendered, setDocxRendered] = useState(false);
  const [mammothHtml, setMammothHtml] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [fitScale, setFitScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    setDocxRendered(false);
    setMammothHtml(null);
    setError('');
    setFitScale(1);
    setScaledHeight(null);

    const computeFit = () => {
      const outer = outerRef.current;
      const container = containerRef.current;
      if (!outer || !container) return;
      const section = container.querySelector('section');
      const docWidth = section instanceof HTMLElement ? section.offsetWidth : 0;
      const available = outer.clientWidth - 32; // 两侧留白
      if (docWidth <= 0 || available <= 0) return;
      const scale = Math.min(1, available / docWidth);
      setFitScale(scale);
      setScaledHeight(scale < 1 ? Math.ceil(container.scrollHeight * scale) + 24 : null);
    };

    void (async () => {
      // 1) docx-preview 高保真分支
      try {
        // @ts-ignore — 可选依赖，未安装时走 mammoth 兜底
        const docxPreview = await import(/* @vite-ignore */ 'docx-preview');
        const container = containerRef.current;
        if (cancelled || !container) return;
        container.innerHTML = '';
        await docxPreview.renderAsync(uint8ArrayToArrayBuffer(buffer), container, undefined, {
          className: 'sclaw-docx',
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        });
        if (cancelled) return;
        setDocxRendered(true);
        computeFit();
        // 面板宽度变化时重算缩放
        if (outerRef.current) {
          observer = new ResizeObserver(computeFit);
          observer.observe(outerRef.current);
        }
        return; // docx-preview 渲染成功
      } catch {
        // 未安装或渲染失败 → mammoth 兜底
      }

      // 2) mammoth 兜底分支
      try {
        // @ts-ignore — mammoth 无内置 d.ts
        const mammoth = await import(/* @vite-ignore */ 'mammoth');
        const result = await mammoth.convertToHtml({
          arrayBuffer: uint8ArrayToArrayBuffer(buffer),
        });
        if (!cancelled) setMammothHtml(result.value);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Word 预览失败');
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [buffer]);

  if (error) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-sm', className)}>
        <FileText className="h-12 w-12 text-muted-foreground opacity-40" aria-hidden />
        <p className="font-medium text-foreground">{fileName}</p>
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  // mammoth 兜底：iframe srcDoc
  if (mammothHtml !== null) {
    const srcDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${MAMMOTH_SHELL_STYLE}</style>
</head>
<body>${mammothHtml}</body>
</html>`;
    return (
      <iframe
        srcDoc={srcDoc}
        title={fileName}
        className={cn('h-full min-w-0 w-full border-0', className)}
        sandbox="allow-scripts"
      />
    );
  }

  // docx-preview 分支（渲染完成前容器为空 + 骨架遮罩）
  return (
    <div ref={outerRef} className={cn('relative h-full overflow-auto bg-muted/30 dark:bg-[#0d1117]', className)}>
      <div
        className="mx-auto py-4"
        style={scaledHeight !== null ? { height: scaledHeight } : undefined}
      >
        <div
          ref={containerRef}
          className="sclaw-docx-host mx-auto w-fit"
          style={fitScale < 1 ? { transform: `scale(${fitScale})`, transformOrigin: 'top center' } : undefined}
        />
      </div>
      {!docxRendered ? (
        <div className="absolute inset-0 bg-[var(--sto-panel-bg)]">
          <PreviewLoading label={t('preview.office.parsing', { label: 'Word' })} variant="document" />
        </div>
      ) : null}
    </div>
  );
}
