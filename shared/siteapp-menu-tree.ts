import type { SiteappMenuItemInput } from './siteapp-menu-sync';

export interface SiteappMenuTreeNode {
  menu_code: string;
  menu_name: string;
  menu_type: 'directory' | 'page';
  resource_path?: string | null;
  children: SiteappMenuTreeNode[];
}

function cloneTree(tree: SiteappMenuTreeNode[]): SiteappMenuTreeNode[] {
  return tree.map((node) => ({
    ...node,
    children: cloneTree(node.children),
  }));
}

export function menusToTree(items: SiteappMenuItemInput[]): SiteappMenuTreeNode[] {
  const nodes = new Map<string, SiteappMenuTreeNode>();
  const order: string[] = [];
  for (const item of items) {
    const code = item.menu_code.trim();
    if (!code || nodes.has(code)) continue;
    order.push(code);
    nodes.set(code, {
      menu_code: code,
      menu_name: item.menu_name.trim() || code,
      menu_type: item.menu_type === 'directory' ? 'directory' : 'page',
      resource_path: item.resource_path ?? null,
      children: [],
    });
  }

  const roots: SiteappMenuTreeNode[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const code = item.menu_code.trim();
    const node = nodes.get(code);
    if (!node || placed.has(code)) continue;
    const parentCode = item.parent_code?.trim() || '';
    const parent = parentCode ? nodes.get(parentCode) : undefined;
    if (parent && parent.menu_code !== code) {
      parent.menu_type = 'directory';
      parent.children.push(node);
      placed.add(code);
    }
  }
  for (const code of order) {
    if (placed.has(code)) continue;
    const node = nodes.get(code);
    if (node) roots.push(node);
  }
  return roots;
}

export function treeToMenus(tree: SiteappMenuTreeNode[]): SiteappMenuItemInput[] {
  const menus: SiteappMenuItemInput[] = [];
  const walk = (nodes: SiteappMenuTreeNode[], parentCode: string | null) => {
    for (const node of nodes) {
      const isDirectory = node.children.length > 0 || node.menu_type === 'directory';
      menus.push({
        menu_code: node.menu_code,
        parent_code: parentCode,
        menu_name: node.menu_name.trim() || node.menu_code,
        menu_type: isDirectory && !parentCode ? 'directory' : 'page',
        resource_path: node.resource_path?.trim() || null,
      });
      if (!parentCode) walk(node.children, node.menu_code);
    }
  };
  walk(tree, null);
  return menus;
}

export function flattenMenuTree(tree: SiteappMenuTreeNode[]): Array<{
  node: SiteappMenuTreeNode;
  parentCode: string | null;
  depth: 0 | 1;
  siblingCount: number;
}> {
  const rows: Array<{
    node: SiteappMenuTreeNode;
    parentCode: string | null;
    depth: 0 | 1;
    siblingCount: number;
  }> = [];
  for (const node of tree) {
    rows.push({ node, parentCode: null, depth: 0, siblingCount: tree.length });
    for (const child of node.children) {
      rows.push({
        node: child,
        parentCode: node.menu_code,
        depth: 1,
        siblingCount: node.children.length,
      });
    }
  }
  return rows;
}

export function renameMenuTreeNode(
  tree: SiteappMenuTreeNode[],
  menuCode: string,
  menuName: string,
): SiteappMenuTreeNode[] {
  const next = cloneTree(tree);
  const visit = (nodes: SiteappMenuTreeNode[]) => {
    for (const node of nodes) {
      if (node.menu_code === menuCode) {
        node.menu_name = menuName;
        return true;
      }
      if (visit(node.children)) return true;
    }
    return false;
  };
  visit(next);
  return next;
}

function findInSiblings(
  nodes: SiteappMenuTreeNode[],
  code: string,
): { siblings: SiteappMenuTreeNode[]; index: number; node: SiteappMenuTreeNode } | null {
  const index = nodes.findIndex((item) => item.menu_code === code);
  if (index >= 0) return { siblings: nodes, index, node: nodes[index]! };
  for (const item of nodes) {
    const nested = findInSiblings(item.children, code);
    if (nested) return nested;
  }
  return null;
}

/** Reorder among siblings of the same parent (root included). No cross-level or reparenting. */
export function applyMenuTreeDrag(
  tree: SiteappMenuTreeNode[],
  activeCode: string,
  overCode: string,
): SiteappMenuTreeNode[] {
  if (!activeCode || !overCode || activeCode === overCode) return tree;
  const next = cloneTree(tree);
  const activeFound = findInSiblings(next, activeCode);
  const overFound = findInSiblings(next, overCode);
  if (!activeFound || !overFound) return tree;
  if (activeFound.siblings !== overFound.siblings) return tree;
  const from = activeFound.index;
  const to = overFound.index;
  if (from === to) return tree;
  const [removed] = activeFound.siblings.splice(from, 1);
  if (!removed) return tree;
  activeFound.siblings.splice(to, 0, removed);
  return next;
}
