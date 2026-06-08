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

/** Register a handler for a specific formId */
export function registerParameterFormHandler(formId: string, handler: ParameterFormHandler): void {
  handlers.set(formId, handler);
}

/** Remove a registered handler */
export function unregisterParameterFormHandler(formId: string): void {
  handlers.delete(formId);
}

/** Submit a parameter form by formId. Calls the registered handler if exists. */
export async function submitParameterForm(formId: string, values: FormResult): Promise<boolean> {
  const handler = handlers.get(formId);
  if (!handler) return false;
  try {
    await handler(values);
  } finally {
    handlers.delete(formId);
  }
  return true;
}

/** Check if a handler is registered for a formId */
export function hasParameterFormHandler(formId: string): boolean {
  return handlers.has(formId);
}
