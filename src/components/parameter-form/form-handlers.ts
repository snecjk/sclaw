/**
 * Parameter Form Handlers - Global registry for inline form submission callbacks
 *
 * When a ParameterFormCard is rendered in chat, the caller (e.g. workflow send)
 * registers a handler here. The card calls submitParameterForm() on user submit,
 * which dispatches to the registered handler and then cleans up.
 */
import type { FormResult } from '@/types/user-form';

export interface ParameterFormHandler {
  (values: FormResult): void | Promise<void>;
}

const handlers = new Map<string, ParameterFormHandler>();
const listeners = new Set<() => void>();
let handlersRevision = 0;

function notifyHandlerRegistryChanged(): void {
  handlersRevision += 1;
  for (const listener of listeners) listener();
}

/** Subscribe React consumers to the in-memory handler registry. */
export function subscribeParameterFormHandlers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Monotonic snapshot used by useSyncExternalStore. */
export function getParameterFormHandlersRevision(): number {
  return handlersRevision;
}

/** Register a handler for a specific formId */
export function registerParameterFormHandler(formId: string, handler: ParameterFormHandler): void {
  handlers.set(formId, handler);
  notifyHandlerRegistryChanged();
}

/** Remove a registered handler */
export function unregisterParameterFormHandler(formId: string): void {
  if (handlers.delete(formId)) notifyHandlerRegistryChanged();
}

/**
 * Resolve a candidate formId to a registered handler key.
 * Handles workflow-form-{templateId} → workflow-form-{templateId}-{timestamp}.
 */
export function resolveParameterFormId(formId: string): string {
  if (handlers.has(formId)) return formId;
  for (const key of handlers.keys()) {
    if (key === formId || key.startsWith(`${formId}-`)) {
      return key;
    }
  }
  return formId;
}

/** Submit a parameter form by formId. Calls the registered handler if exists. */
export async function submitParameterForm(formId: string, values: FormResult): Promise<boolean> {
  const resolvedId = resolveParameterFormId(formId);
  const handler = handlers.get(resolvedId);
  if (!handler) return false;
  try {
    await handler(values);
    const { dismissParameterFormInChat } = await import('./dismiss-parameter-form');
    dismissParameterFormInChat(resolvedId);
  } finally {
    if (handlers.delete(resolvedId)) notifyHandlerRegistryChanged();
  }
  return true;
}

/** Check if a handler is registered for a formId */
export function hasParameterFormHandler(formId: string): boolean {
  return handlers.has(resolveParameterFormId(formId));
}
