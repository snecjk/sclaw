import { useSettingsStore } from '@/stores/settings';
import { useSplitPanelResize } from '@/hooks/use-split-panel-resize';

/** Home and Chat share presentation sizing; split and overlay preferences stay independent. */
export function usePreviewLayoutResize(isPreviewOverlay: boolean) {
  const previewPanelPercent = useSettingsStore((s) => isPreviewOverlay
    ? s.previewOverlayPercent ?? 40
    : s.previewSplitPercent ?? 50);
  const setPercent = useSettingsStore((s) => isPreviewOverlay
    ? s.setPreviewOverlayPercent
    : s.setPreviewSplitPercent);
  return {
    previewPanelPercent,
    ...useSplitPanelResize(previewPanelPercent, setPercent, { overlay: isPreviewOverlay }),
  };
}
