import { describe, expect, it } from 'vitest';
import { resolveProcessHeaderLayout } from '@/components/chat/process-rail-layout';

describe('ProcessRailLayout', () => {
  it('readonly thinking tool: no leading offset', () => {
    expect(
      resolveProcessHeaderLayout('readonly_title').hasLeadingControlBeforeSemanticIcon,
    ).toBe(false);
  });

  it('thinking collapsible: chevron after icon, no leading offset', () => {
    expect(
      resolveProcessHeaderLayout('collapsible_chevron_after_icon').hasLeadingControlBeforeSemanticIcon,
    ).toBe(false);
  });

  it('default collapsible: chevron before icon, needs offset', () => {
    expect(
      resolveProcessHeaderLayout('collapsible_chevron_before_icon').hasLeadingControlBeforeSemanticIcon,
    ).toBe(true);
  });

  it('spinner before icon: needs offset', () => {
    expect(
      resolveProcessHeaderLayout('running_spinner_before_icon').hasLeadingControlBeforeSemanticIcon,
    ).toBe(true);
  });
});
