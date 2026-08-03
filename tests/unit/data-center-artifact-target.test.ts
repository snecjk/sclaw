import { describe, expect, it } from 'vitest';
import {
  buildDataCenterTargetUri,
  parseDataCenterTargetUri,
} from '../../electron/services/data-center-artifact-sync/target-uri';

describe('data center artifact target uri', () => {
  it('parses my artifact root target', () => {
    const target = parseDataCenterTargetUri('data-center://qa_artifact/root', '我的产物');

    expect(target).toEqual({
      uri: 'data-center://qa_artifact/root',
      spaceType: 'qa_artifact',
      parentEntryId: 'root',
      label: '我的产物',
    });
  });

  it('parses scoped shared target', () => {
    const target = parseDataCenterTargetUri('data-center://site_shared_artifact/site-1/root');

    expect(target).toMatchObject({
      spaceType: 'site_shared_artifact',
      spaceId: 'site-1',
      parentEntryId: 'root',
    });
  });

  it('canonicalizes equivalent target URIs when parsing', () => {
    const target = parseDataCenterTargetUri('  data-center://qa_artifact//%72oot  ');

    expect(target).toMatchObject({
      uri: 'data-center://qa_artifact/root',
      spaceType: 'qa_artifact',
      parentEntryId: 'root',
    });
  });

  it('builds future scoped target uri without changing parser', () => {
    const uri = buildDataCenterTargetUri({
      spaceType: 'project_artifact',
      spaceId: 'project-9',
      parentEntryId: 'folder-2',
    });

    expect(uri).toBe('data-center://project_artifact/project-9/folder-2');
    expect(parseDataCenterTargetUri(uri)).toMatchObject({
      spaceType: 'project_artifact',
      spaceId: 'project-9',
      parentEntryId: 'folder-2',
    });
  });
});
