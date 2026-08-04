/**
 * 工作流 MC 编辑/AI 创建：将返回、单行标题、外链按钮注入全局 ContentHeader（方案 B）。
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ExternalLink, History, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useContentHeader } from '@/components/layout/content-header-context';
import { openMemoryCenterWorkflowDesigner } from '@/lib/memory-center-web-url';
import { getWorkflowStoToken } from '@/lib/workflow-api';
import { cn } from '@/lib/utils';
import { contentHeaderTitleClass } from '@/lib/surfaces';
import { useAuthStore } from '@/stores/auth';

export interface UseWorkflowEditorContentHeaderOptions {
  /** 工作流 ID（展示在标题行次要段） */
  workflowId: string;
  /** 返回列表 */
  onBack: () => void;
  /** AI 创建：用户 prompt（sto-claw 侧展示，不进 MC URL 时仍可作为副文案） */
  prompt?: string;
  /** AI 创建：MC 缓存 prompt 的短 ID */
  promptCacheId?: string;
  /** 为 false 时不占用 ContentHeader（如创建中 loading） */
  enabled?: boolean;
  /** 手动新建空画布页：标题用「新建工作流」，无次级 id、无外链按钮 */
  create?: boolean;
  /** 客户端本地试运行入口，由编辑路由提供，和 iframe 内画布交互解耦。 */
  onTryRun?: () => void;
  tryRunDisabled?: boolean;
  /** 打开当前工作流的客户端本地运行记录。 */
  onOpenLocalRunHistory?: () => void;
}

function truncatePrompt(prompt: string, maxLen = 50): string {
  if (prompt.length <= maxLen) return prompt;
  return `${prompt.slice(0, maxLen)}…`;
}

/**
 * 编辑/AI 创建路由挂载：全局 52px 顶栏展示返回 +「编辑工作流 · wf_xxx」+ 在浏览器打开。
 */
export function useWorkflowEditorContentHeader({
  workflowId,
  onBack,
  prompt,
  promptCacheId,
  enabled = true,
  create = false,
  onTryRun,
  tryRunDisabled = false,
  onOpenLocalRunHistory,
}: UseWorkflowEditorContentHeaderOptions): void {
  const { t } = useTranslation('workflow');
  const stoToken = useAuthStore((s) => s.user?.stoToken);
  const token = useMemo(() => stoToken?.trim() || getWorkflowStoToken() || '', [stoToken]);
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  const isAiCreateMode = Boolean(prompt || promptCacheId);
  const secondaryLabel = create ? '' : isAiCreateMode && prompt ? truncatePrompt(prompt) : workflowId;
  const secondaryTitle = create ? '' : isAiCreateMode && prompt ? prompt : workflowId;

  const title = useMemo((): ReactNode => {
    if (!enabled) return null;

    const mainTitle = create
      ? t('editor.createTitle')
      : isAiCreateMode
        ? t('editor.aiCreateTitle')
        : t('editor.editTitle');

    return (
      <div className="no-drag flex min-w-0 max-w-full items-center gap-1 overflow-hidden">
        <button
          type="button"
          aria-label={t('editor.backAria')}
          onClick={() => onBackRef.current()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground/80 hover:bg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <p
          className={cn(contentHeaderTitleClass, 'flex min-w-0 items-baseline gap-1')}
          title={secondaryTitle}
        >
          <span className="shrink-0">{mainTitle}</span>
          {secondaryLabel ? (
            <>
              <span className="shrink-0 text-muted-foreground" aria-hidden>
                ·
              </span>
              <span className="min-w-0 truncate font-normal text-muted-foreground">{secondaryLabel}</span>
            </>
          ) : null}
        </p>
      </div>
    );
  }, [enabled, create, isAiCreateMode, secondaryLabel, secondaryTitle, t]);

  const actions = useMemo((): ReactNode => {
    if (!enabled || !workflowId) return null;

    return (
      <>
        {onTryRun ? (
          <Button type="button" variant="outline" size="sm" disabled={tryRunDisabled} onClick={onTryRun}>
            <Play className="mr-1 h-3.5 w-3.5" aria-hidden />
            {t('builder.tryRun')}
          </Button>
        ) : null}
        {onOpenLocalRunHistory ? (
          <Button type="button" variant="outline" size="sm" onClick={onOpenLocalRunHistory}>
            <History className="mr-1 h-3.5 w-3.5" aria-hidden />
            本地运行记录
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openMemoryCenterWorkflowDesigner(workflowId, token, promptCacheId, prompt)}
        >
          <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
          {t('editor.openInBrowser')}
        </Button>
      </>
    );
  }, [enabled, onOpenLocalRunHistory, onTryRun, prompt, promptCacheId, t, token, tryRunDisabled, workflowId]);

  useContentHeader({
    title,
    actions,
    enabled,
  });
}
