import { describe, expect, it } from 'vitest';
import {
  buildDataManageEmbedHref,
  buildDataManagePreviewUrl,
  CREATE_OWNED_DATASOURCE_URL,
  isPreviewLeaveHash,
  parseDataManageEmbedSearch,
  PREVIEW_EMBED_SOURCE,
} from '@/pages/DataCenter/data-manage/constants';

describe('data-manage preview urls', () => {
  it('appends source=sclaw to every preview entry url', () => {
    expect(CREATE_OWNED_DATASOURCE_URL).toContain(`source=${PREVIEW_EMBED_SOURCE}`);
    expect(buildDataManagePreviewUrl({ kind: 'create-owned' })).toContain('#/data-model/datasources/create?source=sclaw');
    expect(buildDataManagePreviewUrl({ kind: 'edit-owned', editId: 'ds_1' })).toContain(
      '#/data-model/datasources/create?editId=ds_1&source=sclaw',
    );
  });

  it('builds in-app embed hrefs for datasource create / edit only', () => {
    expect(buildDataManageEmbedHref({ kind: 'create-owned' })).toBe(
      '/data-center/data-manage/create?kind=create-owned',
    );
    expect(buildDataManageEmbedHref({ kind: 'edit-owned', editId: 'ds_1' })).toBe(
      '/data-center/data-manage/create?kind=edit-owned&editId=ds_1',
    );
  });

  it('treats preview hub/list hashes as leave-to-SClaw', () => {
    expect(isPreviewLeaveHash('https://page.sto.cn/ux/sto-finance-bi-preview/index.html#/data-model')).toBe(true);
    expect(isPreviewLeaveHash('#/data-model/datasources')).toBe(true);
    expect(isPreviewLeaveHash('#/data-model/datasources/create?source=sclaw')).toBe(false);
    expect(isPreviewLeaveHash('#/data-model/create?mode=create&source=sclaw')).toBe(true);
  });

  it('parses embed search back to the preview target', () => {
    expect(parseDataManageEmbedSearch('')).toEqual({ kind: 'create-owned' });
    expect(parseDataManageEmbedSearch('?kind=edit-owned&editId=ds_1')).toEqual({
      kind: 'edit-owned',
      editId: 'ds_1',
    });
    expect(parseDataManageEmbedSearch('kind=create-report&sourceCode=ds_1')).toEqual({
      kind: 'create-owned',
    });
  });
});
