/**
 * 手动微调组件库：Catalog 单项 + 用户模块，插入当前选中容器的 children 插槽。
 */
import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { listAppSourceFiles, readAppSourceFile, writeAppSourceFile } from '@/lib/app-dev-api';
import type { AppDevPickedElement } from '@/lib/app-dev-element-intent';
import {
  a2uiPageJsonPath,
  findA2uiComponent,
  insertA2uiModule,
  type A2uiMessage,
  type A2uiModuleFragment,
} from '@/lib/app-dev-a2ui-page';
import {
  builderMetaToModuleFragment,
  parseComponentBuilderContract,
} from '@/lib/app-dev-component-builder';

const MODULE_MIME = 'application/x-sclaw-a2ui-module';

interface AppDevModuleGalleryProps {
  workspaceId: string;
  selected: AppDevPickedElement | null;
  onPersisted?: () => void;
}

export function AppDevModuleGallery({
  workspaceId,
  selected,
  onPersisted,
}: AppDevModuleGalleryProps) {
  const [catalogItems, setCatalogItems] = useState<A2uiModuleFragment[]>([]);
  const [modules, setModules] = useState<A2uiModuleFragment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const files = await listAppSourceFiles(workspaceId);
      const paths = files
        .map((file) => file.path)
        .filter((path) => /^src\/catalog\/modules\/.+\.json$/.test(path));
      const loaded: A2uiModuleFragment[] = [];
      for (const path of paths) {
        const file = await readAppSourceFile(workspaceId, path);
        const parsed = JSON.parse(file.content) as A2uiModuleFragment;
        if (parsed?.id && Array.isArray(parsed.components)) loaded.push(parsed);
      }
      setModules(loaded);

      const builderFile = await readAppSourceFile(workspaceId, 'contracts/component-builder.v1.json').catch(() => null);
      if (builderFile) {
        const contract = parseComponentBuilderContract(JSON.parse(builderFile.content));
        setCatalogItems((contract?.components ?? []).map(builderMetaToModuleFragment));
      } else {
        setCatalogItems([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const allItems = [...catalogItems, ...modules];

  const insert = async (fragment: A2uiModuleFragment) => {
    const pageId = selected?.a2uiPageId;
    const parentId = selected?.a2uiComponentId;
    if (!pageId || !parentId) {
      setHint('请先在 A2UI 页面里选中一个容器（如 AntdStack）');
      return;
    }
    setBusyId(fragment.id);
    setError(null);
    setHint(null);
    try {
      const file = await readAppSourceFile(workspaceId, a2uiPageJsonPath(pageId));
      const messages = JSON.parse(file.content) as A2uiMessage[];
      const parent = findA2uiComponent(messages, parentId);
      if (!parent || (fragment.parentHint && parent.component !== fragment.parentHint && parent.component !== 'AntdStack' && parent.component !== 'Column')) {
        setHint(`请选中 ${fragment.parentHint || 'AntdStack'} 再插入`);
        return;
      }
      const next = insertA2uiModule(messages, parentId, fragment);
      await writeAppSourceFile(workspaceId, a2uiPageJsonPath(pageId), `${JSON.stringify(next, null, 2)}\n`);
      setHint(`已把「${fragment.name}」写入 ${a2uiPageJsonPath(pageId)}`);
      onPersisted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData(MODULE_MIME) || event.dataTransfer.getData('text/plain');
    const item = allItems.find((entry) => entry.id === id);
    if (!item) {
      setHint('未识别的模块，请从下方列表拖入');
      return;
    }
    void insert(item);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
          选中 A2UI 容器后插入或拖入。条目是 page.json 片段，不会引入另一套搭建格式。
        </p>
        <div
          className="mb-3 rounded-md border border-dashed border-border px-2 py-4 text-center text-[11px] text-muted-foreground"
          data-testid="app-dev-module-drop"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={handleDrop}
        >
          拖到此处，插入当前选中容器的插槽
        </div>
        {error ? (
          <p className="mb-3 text-xs text-[var(--sto-danger-primary,#FA3C3C)]">{error}</p>
        ) : null}
        <GallerySection
          title="组件"
          items={catalogItems}
          empty="当前应用没有 component-builder 契约。"
          busyId={busyId}
          onInsert={insert}
        />
        <GallerySection
          title="模块"
          items={modules}
          empty="当前应用还没有 `src/catalog/modules/` 模块。"
          busyId={busyId}
          onInsert={insert}
        />
      </div>
      <div className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        {hint}
      </div>
    </div>
  );
}

function GallerySection({
  title,
  items,
  empty,
  busyId,
  onInsert,
}: {
  title: string;
  items: A2uiModuleFragment[];
  empty: string;
  busyId: string | null;
  onInsert: (fragment: A2uiModuleFragment) => void;
}) {
  return (
    <section className="mb-4 space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2" data-testid={`app-dev-module-gallery-${title === '组件' ? 'catalog' : 'modules'}`}>
          {items.map((item) => (
            <li
              key={item.id}
              className="sto-card-flat flex items-center gap-2 rounded-md px-2 py-2"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(MODULE_MIME, item.id);
                event.dataTransfer.setData('text/plain', item.id);
                event.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">{item.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{item.id}</p>
              </div>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                disabled={busyId === item.id}
                onClick={() => void onInsert(item)}
              >
                插入
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
