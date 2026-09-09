import type { ReactNode } from 'react';

export function A2uiStamp({
  name,
  id,
  children,
}: {
  name: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-a2ui-component={name}
      data-a2ui-component-id={id || undefined}
      style={{ display: 'contents' }}
    >
      {children}
    </div>
  );
}

export function resolveA2uiCtxId(ctx: unknown): string {
  if (!ctx || typeof ctx !== 'object') return '';
  const rec = ctx as Record<string, unknown>;
  if (typeof rec.id === 'string' && rec.id) return rec.id;
  const component = rec.component;
  if (component && typeof component === 'object' && typeof (component as { id?: string }).id === 'string') {
    return (component as { id: string }).id;
  }
  return '';
}
