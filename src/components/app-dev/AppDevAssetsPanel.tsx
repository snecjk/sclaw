/**
 * 生成资产「文件」页（T14）。
 */
import { memo, useEffect, useState } from 'react';
import { Download, FileImage, FileText, FolderOpen, Loader2, Package } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  exportAppGeneratedAsset,
  listAppGeneratedAssets,
  type AppGeneratedAsset,
} from '@/lib/app-dev-api';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';
import { cn } from '@/lib/utils';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetIcon({ kind }: { kind: AppGeneratedAsset['kind'] }) {
  if (kind === 'image') return <FileImage className="h-5 w-5 text-[var(--sto-brand-primary)]" />;
  if (kind === 'document') return <FileText className="h-5 w-5 text-[var(--sto-info-primary,#4760FE)]" />;
  return <Package className="h-5 w-5 text-muted-foreground" />;
}

export const AppDevAssetsPanel = memo(function AppDevAssetsPanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [items, setItems] = useState<AppGeneratedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportingPath, setExportingPath] = useState<string | null>(null);
  const setMode = useAppDevWorkbenchStore((s) => s.setMode);
  const setAssetRevealPath = useAppDevWorkbenchStore((s) => s.setAssetRevealPath);

  const reload = async () => {
    setLoading(true);
    try {
      setItems(await listAppGeneratedAssets(workspaceId));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [workspaceId]);

  const handleDownload = async (item: AppGeneratedAsset) => {
    setExportingPath(item.path);
    try {
      const result = await exportAppGeneratedAsset(workspaceId, item.path);
      if (result.saved) toast.success('已下载');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '下载失败');
    } finally {
      setExportingPath(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="app-dev-assets-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">文件</span>
        <span className="flex-1" />
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void reload()} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : '刷新'}
        </Button>
      </div>

      {items.length === 0 && !loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-foreground">暂无生成文件</p>
          <p className="max-w-[280px] text-xs text-muted-foreground">
            创作过程中生成的文件将会展示在这里
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {items.map((item) => (
              <div
                key={item.path}
                className={cn('flex flex-col gap-2 rounded-lg border border-border bg-card p-3')}
              >
                <div className="flex items-start gap-2">
                  <AssetIcon kind={item.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium" title={item.name}>{item.name}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground" title={item.path}>
                      {item.path}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{formatBytes(item.size)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    disabled={exportingPath === item.path}
                    onClick={() => void handleDownload(item)}
                  >
                    {exportingPath === item.path
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Download className="h-3.5 w-3.5" />}
                    下载
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => {
                      useAppDevWorkbenchStore.getState().pauseCodeFollow();
                      setAssetRevealPath(item.path);
                      setMode('code');
                    }}
                  >
                    在项目中查看
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
