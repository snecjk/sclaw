/**
 * Sidebar delete confirmation portal — mounted outside Sidebar for instant open/close.
 */
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  confirmSidebarSessionDelete,
  confirmSidebarSubitemDelete,
  useSidebarDeleteConfirmStore,
} from '@/stores/sidebar-delete-confirm';

export function SidebarDeleteConfirmPortal() {
  const { t } = useTranslation(['common', 'tasks']);
  const sessionToDelete = useSidebarDeleteConfirmStore((s) => s.sessionToDelete);
  const subitemToDelete = useSidebarDeleteConfirmStore((s) => s.subitemToDelete);
  const clearSessionDelete = useSidebarDeleteConfirmStore((s) => s.clearSessionDelete);
  const clearSubitemDelete = useSidebarDeleteConfirmStore((s) => s.clearSubitemDelete);

  const deletingLabel = t('common:actions.deleting', { defaultValue: '删除中…' });

  return (
    <>
      <ConfirmDialog
        open={!!sessionToDelete}
        title={t('common:actions.confirm')}
        message={t('common:sidebar.deleteSessionConfirm', { label: sessionToDelete?.label })}
        confirmLabel={t('common:actions.delete')}
        confirmingLabel={deletingLabel}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={confirmSidebarSessionDelete}
        onCancel={clearSessionDelete}
      />

      <ConfirmDialog
        open={!!subitemToDelete}
        title={t('common:actions.confirm')}
        message={t('tasks:deleteSubitemConfirm', { label: subitemToDelete?.label })}
        confirmLabel={t('common:actions.delete')}
        confirmingLabel={deletingLabel}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={confirmSidebarSubitemDelete}
        onCancel={clearSubitemDelete}
      />
    </>
  );
}
