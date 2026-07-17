/**
 * UserFormProvider
 * 
 * Provides form context to the entire app.
 * Wrap this around your app root to enable dynamic forms anywhere.
 */
import { createContext, useContext, ReactNode } from 'react';
import { useUserForm } from '@/hooks/use-user-form';
import type { UserFormConfig, FormResult } from '@/types/user-form';

interface UserFormContextValue {
  /** Show a form programmatically */
  showForm: (config: UserFormConfig) => Promise<FormResult | null>;
  /** Current form config */
  config: UserFormConfig | null;
  /** Whether a form is showing */
  isShowing: boolean;
}

const UserFormContext = createContext<UserFormContextValue | null>(null);

interface UserFormProviderProps {
  children: ReactNode;
}

export function UserFormProvider({ children }: UserFormProviderProps) {
  const { config, isShowing, FormModal } = useUserForm();

  // showForm function for programmatic form display
  const showForm = async (_formConfig: UserFormConfig): Promise<FormResult | null> => {
    return new Promise((resolve) => {
      // This is a simplified version - in a real implementation,
      // you would need to coordinate with the IPC-based form showing
      resolve(null);
    });
  };

  const value: UserFormContextValue = {
    showForm,
    config,
    isShowing,
  };

  return (
    <UserFormContext.Provider value={value}>
      {children}
      {FormModal}
    </UserFormContext.Provider>
  );
}

export function useUserFormContext(): UserFormContextValue {
  const context = useContext(UserFormContext);
  if (!context) {
    throw new Error('useUserFormContext must be used within UserFormProvider');
  }
  return context;
}
