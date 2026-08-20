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
      embeddedHeaderNegotiating: false,
    });
  });

  it('hides the Host header while negotiating and after Web ownership', () => {
    expect(shouldHideWorkflowContentHeader({
      editorActive: true,
      embeddedHeaderOwned: false,
      embeddedHeaderNegotiating: true,
    })).toBe(true);
    expect(shouldHideWorkflowContentHeader({
      editorActive: true,
      embeddedHeaderOwned: false,
      embeddedHeaderNegotiating: false,
    })).toBe(false);
    expect(shouldHideWorkflowContentHeader({
      editorActive: true,
      embeddedHeaderOwned: true,
      embeddedHeaderNegotiating: false,
    })).toBe(true);
    expect(shouldHideWorkflowContentHeader({
      editorActive: false,
      embeddedHeaderOwned: true,
      embeddedHeaderNegotiating: false,
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
