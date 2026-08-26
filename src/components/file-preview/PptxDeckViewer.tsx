/**
 * PptxDeckViewer — PPT 幻灯片预览（对齐 Kimi 的放映式体验）
 *
 * 基于内置 pptx-preview 依赖的 slide 模式：
 * - 隐藏库自带的粗糙翻页按钮（CSS 覆盖），自绘底部导航条：上一页/页码/下一页
 * - 1280×720 渲染后按面板宽度整体缩放（transform scale）
 * - 键盘 ←/→ 翻页
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Presentation } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { uint8ArrayToArrayBuffer } from '@/lib/preview-binary-load';
import { PreviewLoading } from './PreviewLoading';

const RENDER_WIDTH = 1280;
const RENDER_HEIGHT = 720;

interface PptxDeckViewerProps {
  buffer: Uint8Array;
  fileName: string;
  className?: string;
}

// pptx-preview 实例的最小结构（库无完整 d.ts）
interface PptxPreviewerInstance {
  currentIndex: number;
  readonly slideCount: number;
  preview: (file: ArrayBuffer) => Promise<unknown>;
  renderSingleSlide: (slideIndex: number) => void;
  destroy: () => void;
}

export function PptxDeckViewer({ buffer, fileName, className }: PptxDeckViewerProps) {
  const { t } = useTranslation('chat');
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<PptxPreviewerInstance | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideCount, setSlideCount] = useState(0);
  const [fitScale, setFitScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setLoaded(false);
    setSlideIndex(0);
    setSlideCount(0);

    void (async () => {
      try {
        // @ts-ignore — pptx-preview 无内置 d.ts
        const { init } = await import(/* @vite-ignore */ 'pptx-preview');
        const container = containerRef.current;
        if (cancelled || !container) return;

        container.innerHTML = '';
        const previewer = init(container, {
          width: RENDER_WIDTH,
          height: RENDER_HEIGHT,
          mode: 'slide',
        }) as PptxPreviewerInstance;
        previewerRef.current = previewer;

        await previewer.preview(uint8ArrayToArrayBuffer(buffer));
        if (cancelled) return;
        setSlideCount(previewer.slideCount);
        setSlideIndex(previewer.currentIndex);
        setLoaded(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'PPT 预览失败');
      }
    })();

    return () => {
      cancelled = true;
      previewerRef.current?.destroy();
      previewerRef.current = null;
    };
  }, [buffer]);

  // 适应宽度缩放
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer || !loaded) return;
    const computeFit = () => {
      const available = outer.clientWidth - 32;
      if (available <= 0) return;
      setFitScale(Math.min(1, available / RENDER_WIDTH));
    };
    computeFit();
    const observer = new ResizeObserver(computeFit);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [loaded]);

  const goTo = (index: number) => {
    const previewer = previewerRef.current;
    if (!previewer || slideCount === 0) return;
    const next = Math.max(0, Math.min(slideCount - 1, index));
    if (next === slideIndex) return;
    previewer.renderSingleSlide(next);
    setSlideIndex(previewer.currentIndex);
  };

  // 键盘翻页
  useEffect(() => {
    if (!loaded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') goTo(slideIndex - 1);
      if (event.key === 'ArrowRight') goTo(slideIndex + 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loaded, slideIndex, slideCount]);

  if (error) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-sm', className)}>
        <Presentation className="h-12 w-12 text-muted-foreground opacity-40" aria-hidden />
        <p className="font-medium text-foreground">{fileName}</p>
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-muted/30 dark:bg-[#0d1117]', className)}>
      {/* 放映区 */}
      <div ref={outerRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {!loaded ? (
          <PreviewLoading label={t('preview.office.parsing', { label: 'PowerPoint' })} variant="slides" className="absolute inset-0" />
        ) : null}
        <div
          className="sclaw-pptx-stage overflow-hidden rounded-md shadow-lg"
          style={{
            width: RENDER_WIDTH * fitScale,
            height: RENDER_HEIGHT * fitScale,
            visibility: loaded ? 'visible' : 'hidden',
          }}
        >
          <div
            ref={containerRef}
            className="sclaw-pptx-host"
            style={{
              width: RENDER_WIDTH,
              height: RENDER_HEIGHT,
              transform: `scale(${fitScale})`,
              transformOrigin: 'top left',
            }}
          />
        </div>
      </div>

      {/* 导航条 */}
      {loaded && slideCount > 0 ? (
        <div className="flex h-11 shrink-0 items-center justify-center gap-3 border-t border-border/60">
          <button
            type="button"
            onClick={() => goTo(slideIndex - 1)}
            disabled={slideIndex === 0}
            aria-label={t('preview.slides.prev')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="min-w-[64px] text-center text-xs tabular-nums text-muted-foreground">
            {slideIndex + 1} / {slideCount}
          </span>
          <button
            type="button"
            onClick={() => goTo(slideIndex + 1)}
            disabled={slideIndex >= slideCount - 1}
            aria-label={t('preview.slides.next')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
