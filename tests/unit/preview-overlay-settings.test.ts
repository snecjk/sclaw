import { describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/stores/settings';

describe('preview overlay width preferences', () => {
  it('defaults separately and persists bounded overlay widths without changing split width', async () => {
    const settings = useSettingsStore.getState();
    expect(settings.previewOverlayPercent).toBe(40);
    settings.setPreviewSplitPercent(57);
    settings.setPreviewOverlayPercent(63);
    expect(useSettingsStore.getState().previewSplitPercent).toBe(57);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().previewOverlayPercent).toBe(63);
    for (const [input, expected] of [[10, 40], [99, 70], [NaN, 40]]) {
      useSettingsStore.getState().setPreviewOverlayPercent(input);
      expect(useSettingsStore.getState().previewOverlayPercent).toBe(expected);
    }
    expect(useSettingsStore.getState().previewSplitPercent).toBe(57);
  });
});
