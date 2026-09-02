import { Copy, ExternalLink, FileCode2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DeployResourcePage } from '../../../shared/sto-app-deploy-resources';

interface DeployResourceListProps {
  pages: DeployResourcePage[];
  onCopy: (url: string) => void;
  onOpen: (url: string) => void;
}

export function DeployResourceList({ pages, onCopy, onOpen }: DeployResourceListProps) {
  if (pages.length === 0) {
    return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">暂未生成产物</div>;
  }
  const sorted = [...pages.filter((page) => page.entry), ...pages.filter((page) => !page.entry)];
  return (
    <div className="space-y-2">
      {sorted.map((page) => (
        <div
          key={page.url}
          data-testid="deploy-resource-row"
          className="flex min-h-12 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
        >
          <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="truncate">{page.fileName}</span>
              {page.entry ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">入口页</span> : null}
              {!page.available ? <span className="text-xs font-normal text-amber-600 dark:text-amber-300">生成中</span> : null}
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground" title={page.url}>{page.url}</div>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={`复制 ${page.fileName}`} onClick={() => onCopy(page.url)}>
            <Copy className="h-4 w-4" aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={`打开 ${page.fileName}`} disabled={!page.available} onClick={() => onOpen(page.url)}>
            <ExternalLink className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ))}
    </div>
  );
}
