import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  DataCenterFilePickerType,
  DataCenterStagedFile,
} from '@/components/data-center-file-picker';
import { isSiteUser, useAuthStore } from '@/stores/auth';
import type { ComposerAttachSource } from './ComposerAttachMenu';

export interface UseComposerAttachSourceOptions {
  pickFiles: () => void | Promise<void>;
  /** 弹窗已完成 download+stage，这里只接入本地 staged 结果 */
  stageDataCenterFiles: (files: DataCenterStagedFile[]) => Promise<void>;
}

/**
 * Composer 附件来源菜单状态：
 * - 本地 → pickFiles
 * - 数据中心三类 → 打开公用弹窗；确认后拿到带 stagedPath 的结果再接入 stager
 */
export function useComposerAttachSource({
  pickFiles,
  stageDataCenterFiles,
}: UseComposerAttachSourceOptions) {
  const authUser = useAuthStore((s) => s.user);
  const siteDepartmentTypes = useAuthStore((s) => s.siteDepartmentTypes);
  const showSharedArtifact = siteDepartmentTypes !== null && isSiteUser(authUser?.categoryCode);

  const attachButtonRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerType, setPickerType] = useState<DataCenterFilePickerType>('drive');

  const openAttachMenu = useCallback(() => {
    setMenuOpen((prev) => !prev);
  }, []);

  const handleMenuSelect = useCallback((source: ComposerAttachSource) => {
    if (source === 'local') {
      void pickFiles();
      return;
    }
    setPickerType(source);
    setPickerOpen(true);
  }, [pickFiles]);

  const handlePickerConfirm = useCallback(async (files: DataCenterStagedFile[]) => {
    setPickerOpen(false);
    if (files.length === 0) return;
    try {
      await stageDataCenterFiles(files);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加数据中心文件失败');
    }
  }, [stageDataCenterFiles]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
  }, []);

  return {
    attachButtonRef,
    menuOpen,
    setMenuOpen,
    openAttachMenu,
    handleMenuSelect,
    showSharedArtifact,
    pickerOpen,
    pickerType,
    closePicker,
    handlePickerConfirm,
  };
}
