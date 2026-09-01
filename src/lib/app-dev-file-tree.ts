export interface AppDevFileTreeNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: AppDevFileTreeNode[];
}

/** Build a nested tree from flat relative paths like `frontend/src/App.tsx`. */
export function buildAppDevFileTree(paths: string[]): AppDevFileTreeNode[] {
  type Mutable = {
    name: string;
    path: string;
    kind: 'file' | 'dir';
    children?: Map<string, Mutable>;
  };

  const root = new Map<string, Mutable>();

  for (const raw of paths) {
    const parts = raw.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let cursor = root;
    let prefix = '';
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      prefix = prefix ? `${prefix}/${name}` : name;
      const isFile = i === parts.length - 1;
      let node = cursor.get(name);
      if (!node) {
        node = {
          name,
          path: prefix,
          kind: isFile ? 'file' : 'dir',
          children: isFile ? undefined : new Map(),
        };
        cursor.set(name, node);
      } else if (!isFile && node.kind === 'file') {
        // Prefer directory if both somehow collide.
        node.kind = 'dir';
        node.children = node.children ?? new Map();
      }
      if (!isFile) {
        node.children = node.children ?? new Map();
        cursor = node.children;
      }
    }
  }

  const toArray = (map: Map<string, Mutable>): AppDevFileTreeNode[] => {
    const nodes = [...map.values()].map((node) => {
      if (node.kind === 'dir') {
        return {
          name: node.name,
          path: node.path,
          kind: 'dir' as const,
          children: toArray(node.children ?? new Map()),
        };
      }
      return { name: node.name, path: node.path, kind: 'file' as const };
    });
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  };

  return toArray(root);
}
