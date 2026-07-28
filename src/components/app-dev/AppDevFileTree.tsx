import { useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen } from 'lucide-react';
import type { AppDevFileTreeNode } from '@/lib/app-dev-file-tree';
import { cn } from '@/lib/utils';

interface AppDevFileTreeProps {
  nodes: AppDevFileTreeNode[];
  activePath: string;
  onOpenFile: (path: string) => void;
}

function TreeNode({
  node,
  depth,
  activePath,
  onOpenFile,
}: {
  node: AppDevFileTreeNode;
  depth: number;
  activePath: string;
  onOpenFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2 || activePath.startsWith(`${node.path}/`));

  if (node.kind === 'file') {
    const active = node.path === activePath;
    return (
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors',
          active
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onOpenFile(node.path)}
        title={node.path}
      >
        <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  const FolderIcon = open ? FolderOpen : Folder;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-background/60 hover:text-foreground"
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Chevron className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        <FolderIcon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
        <span className="truncate font-medium">{node.name}</span>
      </button>
      {open ? (
        <div>
          {(node.children ?? []).map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AppDevFileTree({ nodes, activePath, onOpenFile }: AppDevFileTreeProps) {
  if (nodes.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">暂无源文件</p>;
  }
  return (
    <div className="space-y-0.5 py-1">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}
