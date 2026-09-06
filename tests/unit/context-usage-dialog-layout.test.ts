import { describe, expect, it } from 'vitest';
import { resolveEmbedContextUsageDialogLayout } from '../../src/pages/Chat/context-usage/context-usage-dialog-layout';

describe('App Plaza context usage dialog layout', () => {
  it('opens toward the available side without crossing the chat panel', () => {
    expect(resolveEmbedContextUsageDialogLayout({
      anchor: { left: 1650, right: 1680, top: 1160, width: 30 },
      panel: { left: 1470, right: 2048, top: 0, width: 578 },
      viewportWidth: 2048,
      viewportHeight: 1220,
    })).toMatchObject({
      left: 1650,
      bottom: 68,
      width: 340,
    });
  });

  it('shrinks and clamps the dialog inside a minimum-width chat panel', () => {
    expect(resolveEmbedContextUsageDialogLayout({
      anchor: { left: 930, right: 960, top: 700, width: 30 },
      panel: { left: 784, right: 1024, top: 0, width: 240 },
      viewportWidth: 1024,
      viewportHeight: 768,
    })).toMatchObject({
      left: 796,
      bottom: 76,
      width: 216,
    });
  });
});
