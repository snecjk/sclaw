import { describe, expect, it } from 'vitest';
import { useComposerFlowStore } from '@/stores/composer-flow';

describe('composer-flow store', () => {
  it('takeFilePickerRequest returns the pending request only once', () => {
    useComposerFlowStore.setState({ filePickerRequest: null });

    const requestId = useComposerFlowStore.getState().requestFilePicker({
      accept: '.xlsx',
      multiple: false,
      autoSend: true,
    });

    const first = useComposerFlowStore.getState().takeFilePickerRequest();
    const second = useComposerFlowStore.getState().takeFilePickerRequest();

    expect(first?.requestId).toBe(requestId);
    expect(first?.multiple).toBe(false);
    expect(second).toBeNull();
    expect(useComposerFlowStore.getState().filePickerRequest).toBeNull();
  });

  it('defaults multiple to false unless explicitly enabled', () => {
    useComposerFlowStore.setState({ filePickerRequest: null });

    useComposerFlowStore.getState().requestFilePicker({ accept: '.csv' });
    const request = useComposerFlowStore.getState().takeFilePickerRequest();

    expect(request?.multiple).toBe(false);
  });
});
