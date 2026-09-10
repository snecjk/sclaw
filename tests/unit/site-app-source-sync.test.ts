import { describe, expect, it } from 'vitest';
import {
  decideSourcePullAction,
  isVersionConflictError,
  parseSourceCommitResult,
  parseSourceSnapshotHeaders,
  remoteMatchesBaseline,
} from '../../shared/site-app-source-sync';

describe('site-app source sync parsers', () => {
  it('reads ready commit payload from the HTTP envelope', () => {
    expect(parseSourceCommitResult({
      success: true,
      errCode: '200',
      data: {
        app_code: 'site_demo',
        revision_id: '01J00000000000000000000000',
        status: 'ready',
        source_sha256: 'aa'.repeat(32),
        archive_sha256: 'bb'.repeat(32),
        commit_sha: 'abc123',
        file_count: 18,
      },
    })).toEqual({
      appCode: 'site_demo',
      revisionId: '01J00000000000000000000000',
      status: 'ready',
      commitSha: 'abc123',
      sourceSha256: 'aa'.repeat(32),
      archiveSha256: 'bb'.repeat(32),
      fileCount: 18,
    });
  });

  it('reads snapshot identity from response headers', () => {
    expect(parseSourceSnapshotHeaders({
      'X-STO-Revision-Id': '01J11111111111111111111111',
      'X-STO-Commit-Sha': 'def456',
      'X-STO-Source-Sha256': 'cc'.repeat(32),
      'X-STO-Archive-Sha256': 'dd'.repeat(32),
      ETag: `"${'dd'.repeat(32)}"`,
    })).toEqual({
      revisionId: '01J11111111111111111111111',
      commitSha: 'def456',
      sourceSha256: 'cc'.repeat(32),
      archiveSha256: 'dd'.repeat(32),
    });
  });

  it('detects VERSION_CONFLICT', () => {
    expect(isVersionConflictError('VERSION_CONFLICT')).toBe(true);
    expect(isVersionConflictError('SOURCE_NOT_INITIALIZED')).toBe(false);
  });
});

describe('site-app source pull decision', () => {
  const base = {
    revisionId: 'rev-a',
    commitSha: 'commit-a',
    sourceSha256: 'sha-a',
  };
  const remote = {
    revisionId: 'rev-a',
    commitSha: 'commit-a',
    sourceSha256: 'sha-a',
  };

  it('keeps an already-synced workspace', () => {
    expect(decideSourcePullAction({
      base,
      localSourceSha256: 'sha-a',
      remote,
      workspaceEmpty: false,
    })).toBe('already-synced');
    expect(remoteMatchesBaseline(remote, base)).toBe(true);
  });

  it('does not overwrite local-ahead files', () => {
    expect(decideSourcePullAction({
      base,
      localSourceSha256: 'sha-local',
      remote,
      workspaceEmpty: false,
    })).toBe('local-ahead');
  });

  it('applies remote-only updates', () => {
    expect(decideSourcePullAction({
      base,
      localSourceSha256: 'sha-a',
      remote: { revisionId: 'rev-b', commitSha: 'commit-b', sourceSha256: 'sha-b' },
      workspaceEmpty: false,
    })).toBe('remote-ahead');
  });

  it('refuses to overwrite when local and remote both changed', () => {
    expect(decideSourcePullAction({
      base,
      localSourceSha256: 'sha-local',
      remote: { revisionId: 'rev-b', commitSha: 'commit-b', sourceSha256: 'sha-b' },
      workspaceEmpty: false,
    })).toBe('diverged');
  });

  it('initializes an empty workspace without a local baseline', () => {
    expect(decideSourcePullAction({
      base: { revisionId: null, commitSha: null, sourceSha256: null },
      localSourceSha256: null,
      remote: { revisionId: 'rev-b', commitSha: 'commit-b', sourceSha256: 'sha-b' },
      workspaceEmpty: true,
    })).toBe('initialize');
  });
});
