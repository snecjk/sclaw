import { beforeEach, describe, expect, it } from 'vitest';

import {
  shouldHideWorkflowContentHeader,
  useWorkflowUiStore,
} from '@/stores/workflow-ui';

describe('embedded workflow header ownership', () => {
  beforeEach(() => {
    useWorkflowUiStore.setState({
      editorActive: false,
      embeddedHeaderOwned: false,
    });
  });

  it('hides the Host header only after negotiated ownership', () => {
    expect(shouldHideWorkflowContentHeader({
      editorActive: true,
      embeddedHeaderOwned: false,
    })).toBe(false);
    expect(shouldHideWorkflowContentHeader({
      editorActive: true,
      embeddedHeaderOwned: true,
    })).toBe(true);
    expect(shouldHideWorkflowContentHeader({
      editorActive: false,
      embeddedHeaderOwned: true,
    })).toBe(false);
  });

  it('tracks embedded ownership independently from editor activation', () => {
    useWorkflowUiStore.getState().setEditorActive(true);
    expect(useWorkflowUiStore.getState()).toMatchObject({
      editorActive: true,
      embeddedHeaderOwned: false,
    });

    useWorkflowUiStore.getState().setEmbeddedHeaderOwned(true);
    expect(useWorkflowUiStore.getState()).toMatchObject({
      editorActive: true,
      embeddedHeaderOwned: true,
    });

    useWorkflowUiStore.getState().setEditorActive(false);
    expect(useWorkflowUiStore.getState()).toMatchObject({
      editorActive: false,
      embeddedHeaderOwned: true,
    });
  });
});
