/**
 * Form API Client
 * 
 * Provides APIs for showing dynamic forms to users and receiving their responses.
 * Uses IPC to communicate with the main process for form display and response handling.
 */
import { invokeIpc } from '@/lib/api-client';
import type {
  UserFormConfig,
  FormResult,
  FormResponse,
  ShowFormRequest,
} from '@/types/user-form';

/**
 * Show a form modal to the user
 * 
 * @param config - Form configuration
 * @param options - Additional options
 * @returns Promise that resolves when user submits or cancels the form
 */
export async function showForm(
  config: UserFormConfig,
  options?: {
    sessionId?: string;
    source?: 'skill' | 'intent' | 'workflow' | 'tool';
    sourceId?: string;
    timeoutMs?: number;
  }
): Promise<FormResponse> {
  const request: ShowFormRequest = {
    config,
    sessionId: options?.sessionId,
    source: options?.source,
    sourceId: options?.sourceId,
  };

  return invokeIpc<FormResponse>('form:show', request);
}

/**
 * Submit a form response
 * 
 * @param formId - Form identifier
 * @param values - Form values submitted by user
 */
export async function submitFormResponse(
  formId: string,
  values: FormResult
): Promise<void> {
  return invokeIpc('form:response', {
    formId,
    cancelled: false,
    values,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Cancel a form
 * 
 * @param formId - Form identifier
 */
export async function cancelForm(formId: string): Promise<void> {
  return invokeIpc('form:response', {
    formId,
    cancelled: true,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Check if a form is currently being shown
 */
export async function isFormShowing(): Promise<boolean> {
  return invokeIpc<boolean>('form:isShowing');
}

/**
 * Hide the current form without submitting
 */
export async function hideForm(): Promise<void> {
  return invokeIpc('form:hide');
}
