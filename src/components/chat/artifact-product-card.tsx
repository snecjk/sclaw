/**
 * ArtifactProductCard — 对话流产物卡（MasterGo 8:22231 / 任务一 B5）
 *
 * 白底圆角横条：macOS 窗口图标 + 标题 + 类型/扩展名/大小元信息 + 灰色分裂「预览」按钮。
 * 使用位置：ChatMessage FileCard、WorkflowCard 完成态产物区。
 */
import { ChevronDown, Copy, Download, FolderOpen, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ArtifactCardMenuItem } from '@/lib/artifact-card-menu';
import { cn } from '@/lib/utils';

const artifactActionSplitClass =
  'flex shrink-0 items-stretch overflow-hidden rounded-md bg-[var(--sto-form-disabled-background)]';

const artifactActionPrimaryClass =
  'px-3 py-1.5 text-sm leading-[18px] text-foreground transition-colors hover:bg-[var(--sto-content-hover-background)]';

const artifactActionChevronClass =
  'flex items-center border-l border-[var(--sto-border-default)] px-2 text-muted-foreground transition-colors hover:bg-[var(--sto-content-hover-background)]';

const artifactActionPillClass =
  'shrink-0 rounded-md bg-[var(--sto-form-disabled-background)] px-3 py-1.5 text-sm leading-[18px] text-foreground';

const artifactMenuContentClass =
  'sto-overlay sto-overlay--content-border min-w-[11rem] rounded-lg border p-1 shadow-[var(--sto-shadow-content-popover)]';

const artifactMenuItemClass =
  'gap-2 rounded-md px-2.5 py-2 text-sm text-foreground';

function ArtifactMenuItemIcon({ id }: { id: string }) {
  const iconClass = 'h-4 w-4 shrink-0 text-muted-foreground';
  switch (id) {
    case 'showInFolder':
      return <FolderOpen className={iconClass} aria-hidden />;
    case 'copyFile':
      return <Copy className={iconClass} aria-hidden />;
    case 'download':
      return <Download className={iconClass} aria-hidden />;
    case 'copyLink':
      return <Link2 className={iconClass} aria-hidden />;
    default:
      return null;
  }
}

/** 产物卡外框（MCP：rounded-xl + border #E8EAEF + bg-card） */
export const artifactProductCardShellClass =
  'flex w-full items-center gap-3 rounded-xl border border-[var(--sto-sidebar-border)] bg-card py-3 pl-3.5 pr-5';

export interface ArtifactProductCardProps {
  /** 产物展示名（如「每周总部对账单」） */
  title: string;
  /** 副文案（如「文档 · html · 10.4 KB」） */
  metaLine: string;
  /** 右侧操作文案，默认走 i18n workflow.viewArtifact */
  actionLabel?: string;
  /** 点击整卡或「查看产物」 */
  onAction: () => void;
  /** 是否显示右侧操作文案（默认显示） */
  showActionLabel?: boolean;
  /** 下拉菜单项（本地产物 / HTTPS 链接） */
  menuItems?: ArtifactCardMenuItem[];
  /** 可选样式覆盖 */
  className?: string;
}

/**
 * macOS 窗口风格文档图标（设计稿左侧三色圆点 + 文档轮廓）
 */
export function ArtifactWindowIcon({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex h-6 w-6 shrink-0 flex-col rounded-md border border-border bg-card p-1',
        className,
      )}
      aria-hidden
    >
      <div className="flex items-center gap-[3px]">
        <span className="h-[5px] w-[5px] rounded-full bg-[#FF5F57]" />
        <span className="h-[5px] w-[5px] rounded-full bg-[#FEBC2E]" />
        <span className="h-[5px] w-[5px] rounded-full bg-[#28C840]" />
      </div>
      <div className="mt-1 h-2 flex-1 rounded-[2px] border border-border/80 bg-muted/30" />
    </div>
  );
}

function ArtifactActionButton({
  actionLabel,
  onAction,
  menuItems,
}: {
  actionLabel: string;
  onAction: () => void;
  menuItems?: ArtifactCardMenuItem[];
}) {
  const { t } = useTranslation('chat');

  const handleMenuSelect = async (item: ArtifactCardMenuItem) => {
    try {
      const result = await item.onSelect();
      if (item.id === 'copyLink') {
        toast.success(t('artifact.copyLinkSuccess'));
      } else if (item.id === 'copyFile') {
        const count = typeof result === 'number' ? result : 1;
        toast.success(t('messageActions.copyFilesSuccess', { count }));
      }
    } catch (error) {
      console.error('[ArtifactProductCard] menu action failed:', item.id, error);
      toast.error(t('artifact.actionFailed'));
    }
  };

  if (!menuItems?.length) {
    return (
      <span className={artifactActionPillClass}>
        {actionLabel}
      </span>
    );
  }

  return (
    <div
      className={artifactActionSplitClass}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onAction();
        }}
        className={artifactActionPrimaryClass}
      >
        {actionLabel}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={artifactActionChevronClass}
            aria-label={t('artifact.moreActions')}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={artifactMenuContentClass}>
          {menuItems.map((item) => (
            <DropdownMenuItem
              key={item.id}
              className={artifactMenuItemClass}
              onSelect={() => {
                void handleMenuSelect(item);
              }}
            >
              <ArtifactMenuItemIcon id={item.id} />
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function ArtifactProductCard({
  title,
  metaLine,
  actionLabel,
  onAction,
  showActionLabel = true,
  menuItems,
  className,
}: ArtifactProductCardProps) {
  const { t } = useTranslation('chat');
  const resolvedActionLabel = actionLabel ?? t('artifact.preview');
  const hasMenu = Boolean(menuItems?.length);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAction}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onAction();
        }
      }}
      className={cn(
        artifactProductCardShellClass,
        'cursor-pointer text-left transition-colors duration-150 hover:bg-muted/20',
        className,
      )}
    >
      <ArtifactWindowIcon />
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="truncate text-sm font-semibold leading-5 text-foreground">{title}</p>
        <p className="truncate text-xs leading-[18px] text-muted-foreground">{metaLine}</p>
      </div>
      {showActionLabel ? (
        hasMenu ? (
          <ArtifactActionButton
            actionLabel={resolvedActionLabel}
            onAction={onAction}
            menuItems={menuItems}
          />
        ) : (
          <span className={artifactActionPillClass}>
            {resolvedActionLabel}
          </span>
        )
      ) : null}
    </div>
  );
}

/** 由 mime / 文件名推断产物类型文案（i18n） */
export function getArtifactKindLabel(
  mimeType: string,
  fileName: string,
  t: (key: string) => string,
): string {
  const lower = mimeType.toLowerCase();
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : '';

  if (lower.startsWith('image/')) return t('artifact.typeImage');
  if (
    lower.includes('spreadsheet')
    || lower.includes('excel')
    || lower === 'text/csv'
    || lower === 'text/tab-separated-values'
    || ext === 'xlsx'
    || ext === 'xls'
    || ext === 'csv'
    || ext === 'tsv'
  ) {
    return t('artifact.typeSpreadsheet');
  }
  if (lower.includes('zip') || lower.includes('archive') || lower.includes('compressed')) {
    return t('artifact.typeArchive');
  }
  if (lower.startsWith('video/') || lower.startsWith('audio/')) return t('artifact.typeMedia');
  if (
    lower.startsWith('text/')
    || lower === 'application/pdf'
    || lower === 'application/json'
    || lower === 'application/xml'
    || ext === 'html'
    || ext === 'htm'
    || ext === 'md'
    || ext === 'pdf'
  ) {
    return t('artifact.typeDocument');
  }
  return t('artifact.typeFile');
}

/** 格式化文件大小（产物卡元信息用） */
export function formatArtifactFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 副文案：`类型 · 扩展名 · 大小`（无大小时仅前两段） */
export function buildArtifactMetaLine(params: {
  fileName: string;
  mimeType: string;
  fileSize?: number;
  formatFileSize?: (bytes: number) => string;
  t: (key: string) => string;
}): string {
  const { fileName, mimeType, fileSize = 0, t } = params;
  const formatFileSize = params.formatFileSize ?? formatArtifactFileSize;
  const kind = getArtifactKindLabel(mimeType, fileName, t);
  const ext = fileName.includes('.')
    ? fileName.split('.').pop()?.toLowerCase() ?? ''
    : mimeType.split('/').pop()?.toLowerCase() ?? 'file';
  const parts = [kind, ext];
  if (fileSize > 0) parts.push(formatFileSize(fileSize));
  return parts.join(' · ');
}
