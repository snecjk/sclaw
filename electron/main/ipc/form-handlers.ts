/**
 * Form IPC Handlers
 *
 * Handles IPC communication for dynamic user forms between main and renderer processes.
 */
import { ipcMain, BrowserWindow } from 'electron';
import type { ShowFormRequest, FormResponse } from '../../types/user-form';

// Store pending form promises
const pendingForms = new Map<string, {
  resolve: (response: FormResponse) => void;
  reject: (error: Error) => void;
  timeoutTimer: NodeJS.Timeout;
}>();

// Current active form info
let currentForm: {
  formId: string;
  windowId: number;
  config: ShowFormRequest;
} | null = null;

/**
 * Register form-related IPC handlers
 */
export function registerFormHandlers(): void {
  /**
   * Show a form in the renderer process
   * This is called from renderer to request showing a form
   */
  ipcMain.handle('form:show', async (event, request: ShowFormRequest): Promise<FormResponse> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error('Cannot show form: window not found');
    }

    const formId = request.config.id;
    
    // Check if another form is already showing
    if (currentForm) {
      // Optionally, you could queue forms or reject the new one
      console.warn('[form:show] Another form is already showing:', currentForm.formId);
    }

    return new Promise<FormResponse>((resolve, reject) => {
      // Store the promise for later resolution
      const timeoutTimer = setTimeout(() => {
        pendingForms.delete(formId);
        reject(new Error(`Form ${formId} timed out`));
      }, 5 * 60 * 1000); // 5 minute timeout

      pendingForms.set(formId, { resolve, reject, timeoutTimer });

      // Store current form info
      currentForm = {
        formId,
        windowId: window.id,
        config: request,
      };

      // Notify the renderer to show the form
      // The renderer should be listening for this event via the useUserForm hook
      window.webContents.send('form:show', request);
    });
  });

  /**
   * Receive form response from renderer
   */
  ipcMain.handle('form:response', (event, response: FormResponse) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      console.warn('[form:response] Window not found for response');
      return;
    }

    const pending = pendingForms.get(response.formId);
    if (!pending) {
      console.warn('[form:response] No pending form found for:', response.formId);
      return;
    }

    // Clear timeout
    clearTimeout(pending.timeoutTimer);
    pendingForms.delete(response.formId);

    // Clear current form
    if (currentForm?.formId === response.formId) {
      currentForm = null;
    }

    // Resolve the promise
    pending.resolve(response);
  });

  /**
   * Check if a form is currently showing
   */
  ipcMain.handle('form:isShowing', () => {
    return currentForm !== null;
  });

  /**
   * Hide the current form without submitting (called from renderer)
   */
  ipcMain.handle('form:hide', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !currentForm) {
      return;
    }

    // Notify renderer to hide the form
    window.webContents.send('form:hide');
  });
}

/**
 * Resolve a form with the given response
 * Called when form is submitted or cancelled
 */
export function resolveForm(formId: string, response: FormResponse): void {
  const pending = pendingForms.get(formId);
  if (pending) {
    clearTimeout(pending.timeoutTimer);
    pending.resolve(response);
    pendingForms.delete(formId);
  }
}

/**
 * Reject a form with an error
 */
export function rejectForm(formId: string, error: Error): void {
  const pending = pendingForms.get(formId);
  if (pending) {
    clearTimeout(pending.timeoutTimer);
    pending.reject(error);
    pendingForms.delete(formId);
  }
}

/**
 * Get the current active form info
 */
export function getCurrentForm(): typeof currentForm {
  return currentForm;
}

/**
 * Clear all pending forms (e.g., on window close)
 */
export function clearPendingForms(windowId?: number): void {
  for (const [formId, pending] of pendingForms.entries()) {
    if (!windowId || currentForm?.windowId === windowId) {
      clearTimeout(pending.timeoutTimer);
      pending.reject(new Error('Form cancelled: window closed'));
      pendingForms.delete(formId);
    }
  }
  
  if (!windowId || currentForm?.windowId === windowId) {
    currentForm = null;
  }
}
