/**
 * DevAppCard — 应用广场「开发应用」卡片。
 * 主操作：继续编辑；⋯ 菜单含发布/拉取（MVP 禁用）。
 */
import { useState } from 'react';
import { Code2, FolderOpen, MoreHorizontal, Pencil, Upload, Download } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DevAppSummary } from '@/lib/app-dev-api';
import { invokeIpc } from '@/lib/api-client';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';

interface DevAppCardProps {
  app: DevAppSummary;
}

export function DevAppCard({ app }: DevAppCardProps) {
  const openOrFocusDevAppTab = useAppPlazaShellStore((s) => s.openOrFocusDevAppTab);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleEdit = () => {
    openOrFocusDevAppTab(app.workspaceId, app.name);
  };

  const handleReveal = async () => {
    try {
      await invokeIpc('shell:showItemInFolder', app.appPath);
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <article
      className={cn('more-apps-card more-apps-card--dev', menuOpen && 'more-apps-card--menu-open')}
      onClick={handleEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleEdit();
        }
      }}
    >
      <div className="more-apps-card__top">
        <div className="more-apps-card__icon--dev" aria-hidden>
          <Code2 className="h-6 w-6" />
        </div>
        <div className="more-apps-card__head">
          <h3 className="more-apps-card__title">{app.name}</h3>
        </div>
      </div>

      <p className="more-apps-card__desc">
        {app.projectType === 'fullstack' ? '前端 + 后端应用' : '前端应用'}，通过对话持续完善
      </p>

      <div className="more-apps-card__foot more-apps-card__foot--dev">
        <button
          type="button"
          className="more-apps-card__primary-action"
          onClick={(e) => {
            e.stopPropagation();
            handleEdit();
          }}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          继续编辑
        </button>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="more-apps-card__more-btn"
              aria-label="更多操作"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={handleEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden />
              编辑应用
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleReveal()}>
              <FolderOpen className="mr-2 h-3.5 w-3.5" aria-hidden />
              在访达中打开
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled title="即将支持：同步到公司 GitLab 后可用">
              <Upload className="mr-2 h-3.5 w-3.5" aria-hidden />
              发布应用
            </DropdownMenuItem>
            <DropdownMenuItem disabled title="即将支持：从云端拉取到本地">
              <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
              拉取应用
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
