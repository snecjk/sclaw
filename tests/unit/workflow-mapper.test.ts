import { describe, expect, it } from 'vitest';
import {
  deriveWorkflowListKind,
  mapWorkflowSummaryToCardItem,
  pickCoverKeyFromWorkflowId,
} from '@/lib/workflow-list-mapper';
import type { WorkflowSummary } from '../../shared/workflow-api';
import { asWorkflowId } from '../../shared/workflow-api';

const t = ((key: string, opts?: Record<string, unknown>) => {
  if (key === 'list.updatedAt' && opts?.time) {
    return `Updated ${opts.time}`;
  }
  const labels: Record<string, string> = {
    'list.neverUpdated': 'Not updated',
    'card.noSchedule': 'No schedule',
    'card.noScheduleDraft': 'Draft schedule',
    'card.noDescription': 'No description',
  };
  return labels[key] ?? key;
}) as Parameters<typeof mapWorkflowSummaryToCardItem>[1];

function summary(partial: Partial<WorkflowSummary> & Pick<WorkflowSummary, 'id' | 'name'>): WorkflowSummary {
  return {
    templateId: null,
    version: 1,
    lifecycleStatus: 'active',
    versionStatus: 'published',
    updatedAt: '2026-06-08T10:45:19+08:00',
    createdBy: null,
    createdByName: null,
    updatedBy: null,
    updatedByName: null,
    ...partial,
    id: asWorkflowId(partial.id),
  };
}

describe('pickCoverKeyFromWorkflowId', () => {
  it('returns stable cover for the same id', () => {
    expect(pickCoverKeyFromWorkflowId('wf_abc')).toBe(pickCoverKeyFromWorkflowId('wf_abc'));
  });
});

describe('deriveWorkflowListKind', () => {
  it('maps draft lifecycle to draft tab', () => {
    expect(
      deriveWorkflowListKind(summary({ id: 'wf_1', name: 'A', lifecycleStatus: 'draft' })),
    ).toBe('draft');
  });

  it('maps published active workflow to published tab', () => {
    expect(
      deriveWorkflowListKind(
        summary({ id: 'wf_2', name: 'B', lifecycleStatus: 'active', versionStatus: 'published' }),
      ),
    ).toBe('published');
  });
});

describe('mapWorkflowSummaryToCardItem', () => {
  it('maps API summary to card item with placeholders', () => {
    const card = mapWorkflowSummaryToCardItem(
      summary({ id: 'wf_3', name: '结算流程', lifecycleStatus: 'active', versionStatus: 'published' }),
      t,
    );

    expect(card.id).toBe('wf_3');
    expect(card.name).toBe('结算流程');
    expect(card.listKind).toBe('published');
    expect(card.flow).toEqual([]);
    expect(card.description).toBe('No description');
  });
});
