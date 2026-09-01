/**
 * 发布菜单弹窗：树状列表，可改名称；拖拽仅调整同一父级（含根级）内的顺序。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  previewStoAppMenus,
  syncStoAppMenus,
  type SiteappMenuPreview,
} from '@/lib/app-dev-api';
import type { CodeApplicationPageType } from '../../../shared/code-application-catalog';
import {
  applyMenuTreeDrag,
  flattenMenuTree,
  menusToTree,
  renameMenuTreeNode,
  treeToMenus,
  type SiteappMenuTreeNode,
} from '../../../shared/siteapp-menu-tree';

const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

const sameParentCollision: CollisionDetection = (args) => {
  const parentKey = args.active.data.current?.parentCode ?? null;
  const containers = args.droppableContainers.filter(
    (container) => (container.data.current?.parentCode ?? null) === parentKey,
  );
  return closestCenter({ ...args, droppableContainers: containers });
};

interface StoAppMenuPublishDialogProps {
  open: boolean;
  workspaceId: string;
  appName: string;
  appCode?: string;
  pageType?: CodeApplicationPageType;
  onClose: () => void;
}

function typeLabel(node: SiteappMenuTreeNode, depth: 0 | 1): string {
  if (depth === 1) return '二级页面';
  if (node.children.length > 0 || node.menu_type === 'directory') return '一级目录';
  return '一级菜单';
}

function SortableMenuRow({
  node,
  depth,
  parentCode,
  disabled,
  onRename,
}: {
  node: SiteappMenuTreeNode;
  depth: 0 | 1;
  parentCode: string | null;
  disabled?: boolean;
  onRename: (menuCode: string, menuName: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.menu_code,
    disabled,
    data: { parentCode },
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'border-b border-border px-2 py-1.5 last:border-b-0',
        isDragging && 'z-10 bg-background opacity-80 shadow-sm',
      )}
    >
      <div className={cn('flex items-center gap-1.5', depth === 1 && 'ml-6 border-l border-border pl-3')}>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground',
            disabled ? 'cursor-not-allowed opacity-40' : 'cursor-grab touch-none hover:bg-muted active:cursor-grabbing',
          )}
          aria-label={`拖拽调整「${node.menu_name}」`}
          disabled={disabled}
          {...(disabled ? {} : { ...attributes, ...listeners })}
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <input
            value={node.menu_name}
            onChange={(event) => onRename(node.menu_code, event.target.value)}
            onBlur={(event) => onRename(node.menu_code, event.target.value.trim() || node.menu_code)}
            aria-label={`菜单名称 ${node.menu_code}`}
            className="h-7 w-full rounded-md border border-transparent bg-transparent px-1.5 text-[13px] text-foreground outline-none hover:border-border focus:border-border focus:bg-background"
          />
          <div className="px-1.5 font-mono text-[11px] text-muted-foreground">
            {node.menu_code}
            {node.resource_path ? ` · ${node.resource_path}` : ''}
          </div>
        </div>
        <span className="shrink-0 pr-1 text-[11px] text-muted-foreground">
          {typeLabel(node, depth)}
        </span>
      </div>
    </li>
  );
}

export function StoAppMenuPublishDialog({
  open,
  workspaceId,
  appName,
  appCode,
  pageType = 'site',
  onClose,
}: StoAppMenuPublishDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SiteappMenuPreview | null>(null);
  const [tree, setTree] = useState<SiteappMenuTreeNode[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setTree([]);
    void previewStoAppMenus({ workspaceId, pageType, appName })
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setTree(menusToTree(result.menus));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '扫描菜单失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, workspaceId, pageType, appName]);

  const rows = useMemo(() => flattenMenuTree(tree), [tree]);
  const sortableIds = rows.map((row) => row.node.menu_code);

  if (!open) return null;

  const resolvedAppCode = preview?.appCode || appCode || '';
  const skipped = preview?.skipped ?? [];
  const menus = treeToMenus(tree);
  const canSync = Boolean(resolvedAppCode) && menus.length > 0 && !loading && !syncing;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setTree((prev) => applyMenuTreeDrag(prev, String(active.id), String(over.id)));
  };

  const handleSync = async () => {
    if (!canSync) return;
    setSyncing(true);
    setError(null);
    try {
      await syncStoAppMenus({ workspaceId, appCode: resolvedAppCode, menus });
      toast.success('菜单已同步到云端');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步菜单失败');
    } finally {
      setSyncing(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-black/40 p-4 dark:bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sto-app-menu-publish-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !syncing) onClose();
      }}
    >
      <div
        className={cn(
          'flex max-h-[min(80vh,620px)] w-full max-w-[520px] flex-col overflow-hidden rounded-[12px]',
          'border border-border bg-background p-5 shadow-[0_12px_40px_rgba(15,23,42,0.12)]',
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="sto-app-menu-publish-title" className="text-[16px] font-semibold text-foreground">
            发布菜单
          </h2>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="关闭"
            disabled={syncing}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          根据「{appName}」当前导航配置整理云端菜单。可改名称；拖拽只调整同一父级下的顺序（根级之间，或某个一级目录内的页面），不能跨级或改父子关系。
          {pageType === 'assets' ? '托管应用只同步一个一级菜单。' : '首页重定向不会生成「根目录」。'}
        </p>

        <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
          应用编码（appCode）：
          <span className="ml-1 font-mono text-foreground">
            {resolvedAppCode || '未绑定云端应用'}
          </span>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-6 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              正在扫描导航配置…
            </div>
          ) : error && !preview ? (
            <p className="px-3 py-4 text-[13px] text-destructive">{error}</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-muted-foreground">
              没有可同步的菜单。请检查 `src/layouts/nav-config.ts`，并排除 developerOnly / 404 / 默认重定向。
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={sameParentCollision}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                <ul className="text-[13px]">
                  {rows.map((row) => (
                    <SortableMenuRow
                      key={row.node.menu_code}
                      node={row.node}
                      depth={row.depth}
                      parentCode={row.parentCode}
                      disabled={row.siblingCount < 2}
                      onRename={(code, name) => setTree((prev) => renameMenuTreeNode(prev, code, name))}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {skipped.length > 0 ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            已跳过：{skipped.map((item) => `${item.label}（${item.reason}）`).join('、')}
          </p>
        ) : null}

        {error && preview ? (
          <p className="mt-2 text-[12px] text-destructive">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={syncing}
          >
            取消
          </Button>
          <Button type="button" onClick={() => void handleSync()} disabled={!canSync}>
            {syncing ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                同步中…
              </>
            ) : (
              '确认同步'
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
