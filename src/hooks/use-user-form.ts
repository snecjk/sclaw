/**
 * useUserForm Hook
 * 
 * Provides form state management and event handling for dynamic user forms.
 * Listens for IPC events from main process and manages form display/response.
 */
import { useState, useCallback, useEffect, ReactElement } from 'react';
import { UserFormModal } from '@/components/user-form/UserFormModal';
import type {
  UserFormConfig,
  FormResult,
  FormResponse,
  ShowFormRequest,
} from '@/types/user-form';

interface UseUserFormReturn {
  /** Current form config, null when no form is showing */
  config: UserFormConfig | null;
  /** Whether a form is currently showing */
  isShowing: boolean;
  /** Submit form values */
  submitForm: (values: FormResult) => Promise<void>;
  /** Cancel the current form */
  cancelForm: () => void;
  /** Form modal element to render in your JSX */
  FormModal: ReactElement | null;
}

/**
 * Hook for managing dynamic user forms
 * 
 * @returns Form state and handlers
 */
export function useUserForm(): UseUserFormReturn {
  const [config, setConfig] = useState<UserFormConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [pendingResponse, setPendingResponse] = useState<{
    resolve: (response: FormResponse) => void;
    reject: (error: Error) => void;
  } | null>(null);

  // Listen for form:show event from main process
  useEffect(() => {
    if (!window.electron?.ipcRenderer) {
      return;
    }

    const handleShowForm = (...args: unknown[]) => {
      const request = args[0] as ShowFormRequest;
      setConfig(request.config);
      setOpen(true);
    };

    const handleHideForm = () => {
      setOpen(false);
      setConfig(null);
      if (pendingResponse) {
        pendingResponse.resolve({
          formId: config?.id || 'unknown',
          cancelled: true,
          timestamp: new Date().toISOString(),
        });
        setPendingResponse(null);
      }
    };

    const unsubscribeShow = window.electron.ipcRenderer.on('form:show', handleShowForm);
    const unsubscribeHide = window.electron.ipcRenderer.on('form:hide', handleHideForm);

    return () => {
      if (typeof unsubscribeShow === 'function') unsubscribeShow();
      if (typeof unsubscribeHide === 'function') unsubscribeHide();
    };
  }, [pendingResponse, config?.id]);

  // Handle form submission
  const handleSubmit = useCallback(async (values: FormResult) => {
    return new Promise<void>((resolve, reject) => {
      setPendingResponse({
        resolve: (response: FormResponse) => {
          if (!response.cancelled) {
            resolve();
          } else {
            reject(new Error('Form cancelled'));
          }
        },
        reject,
      });

      // Send response to main process
      window.electron.ipcRenderer
        .invoke('form:response', {
          formId: config?.id || 'unknown',
          cancelled: false,
          values,
          timestamp: new Date().toISOString(),
        })
        .catch(reject);

      // Close modal if configured
      if (config?.closeOnConfirm !== false) {
        setOpen(false);
        setConfig(null);
      }
    });
  }, [config]);

  // Handle form cancellation
  const handleCancel = useCallback(() => {
    if (!config) return;

    const response: FormResponse = {
      formId: config.id,
      cancelled: true,
      timestamp: new Date().toISOString(),
    };

    // Send response to main process
    window.electron.ipcRenderer
      .invoke('form:response', response)
      .catch(console.error);

    // Close modal
    setOpen(false);
    setConfig(null);

    // Resolve pending promise
    if (pendingResponse) {
      pendingResponse.resolve(response);
      setPendingResponse(null);
    }
  }, [config, pendingResponse]);

  // Handle form error
  const handleError = useCallback((error: unknown) => {
    console.error('[useUserForm] Form error:', error);
  }, []);

  // Create form modal element
  const FormModal: ReactElement | null = (open && config)
    ? UserFormModal({
        config,
        open,
        onSubmit: handleSubmit,
        onCancel: handleCancel,
        onError: handleError,
      })
    : null;

  return {
    config,
    isShowing: open,
    submitForm: handleSubmit,
    cancelForm: handleCancel,
    FormModal,
  };
}
