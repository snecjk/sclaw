import { describe, expect, it } from 'vitest';

import { parseManagedCliAuthSpec } from '../../shared/connectors/parse-auth-spec';
import { resolveManagedCliAuthMode } from '../../shared/connectors/resolve-auth-mode';
import {
  hostnameFromServerUrl,
  substituteAuthArgv,
} from '../../shared/connectors/substitute-auth-argv';
import { QPATH_AUTH_PATTERNS } from '../../shared/connectors/auth-pattern-presets';

describe('resolveManagedCliAuthMode', () => {
  it('uses open_url when ui=open_url with loginUrlPattern', () => {
    expect(
      resolveManagedCliAuthMode({
        binary: 'qpath',
        auth: parseManagedCliAuthSpec({
          auth: {
            type: 'cli_login',
            ui: 'open_url',
            openIn: 'embedded',
            login: ['qpath', 'login'],
            loginUrlPattern: QPATH_AUTH_PATTERNS.loginUrlPattern,
          },
        }),
      }),
    ).toEqual({ mode: 'open_url' });
  });

  it('treats ui=embedded as open_url alias when pattern present', () => {
    expect(
      resolveManagedCliAuthMode({
        binary: 'custom-cli',
        auth: parseManagedCliAuthSpec({
          auth: {
            type: 'cli_login',
            ui: 'embedded',
            login: ['custom-cli', 'login'],
            loginUrlPattern: 'https://example\\.com/auth\\S+',
          },
        }),
      }),
    ).toEqual({ mode: 'open_url' });
  });

  it('rejects open_url without loginUrlPattern', () => {
    expect(
      resolveManagedCliAuthMode({
        binary: 'qpath',
        auth: parseManagedCliAuthSpec({
          auth: {
            type: 'cli_login',
            ui: 'open_url',
            login: ['qpath', 'login'],
          },
        }),
      }),
    ).toEqual({ mode: 'open_url' }); // qpath presets fill loginUrlPattern
  });

  it('enriches incomplete qpath open_url catalog to open_url', () => {
    expect(
      resolveManagedCliAuthMode({
        binary: 'qpath',
        auth: parseManagedCliAuthSpec({
          auth: {
            type: 'cli_login',
            ui: 'embedded',
            login: ['qpath', 'login'],
            status: ['qpath', 'status'],
          },
        }),
      }),
    ).toEqual({ mode: 'open_url' });
  });

  it('marks unknown open_url without pattern as unsupported', () => {
    expect(
      resolveManagedCliAuthMode({
        binary: 'acme',
        auth: parseManagedCliAuthSpec({
          auth: {
            type: 'cli_login',
            ui: 'open_url',
            login: ['acme', 'login'],
          },
        }),
      }),
    ).toEqual({ mode: 'unsupported', binary: 'acme' });
  });

  it('uses login_argv for new binaries with auth.login', () => {
    expect(
      resolveManagedCliAuthMode({
        binary: 'acme',
        auth: parseManagedCliAuthSpec({
          auth: {
            type: 'cli_login',
            ui: 'none',
            login: ['acme', 'auth', 'login'],
            status: ['acme', 'auth', 'status'],
          },
        }),
      }),
    ).toEqual({ mode: 'login_argv' });
  });

  it('uses login_argv when ui=none even for dws', () => {
    expect(
      resolveManagedCliAuthMode({
        binary: 'dws',
        auth: parseManagedCliAuthSpec({
          auth: {
            type: 'cli_login',
            ui: 'none',
            login: ['dws', 'auth', 'login'],
          },
        }),
      }),
    ).toEqual({ mode: 'login_argv' });
  });

  it('uses api_token for glab / explicit token auth', () => {
    expect(
      resolveManagedCliAuthMode({
        binary: 'glab',
        auth: null,
        rawAuthType: 'api_token',
      }),
    ).toEqual({ mode: 'api_token' });
  });

  it('falls back to legacy when dws catalog omits login argv', () => {
    expect(
      resolveManagedCliAuthMode({
        binary: 'dws',
        auth: parseManagedCliAuthSpec({ auth: { type: 'cli_login' } }),
      }),
    ).toEqual({ mode: 'legacy', binary: 'dws' });
  });

  it('uses open_url when qpath has login but no explicit pattern (preset enrich)', () => {
    expect(
      resolveManagedCliAuthMode({
        binary: 'qpath',
        auth: parseManagedCliAuthSpec({
          auth: {
            type: 'cli_login',
            login: ['qpath', 'login'],
          },
        }),
      }),
    ).toEqual({ mode: 'open_url' });
  });

  it('marks unknown binary without login as unsupported', () => {
    expect(
      resolveManagedCliAuthMode({
        binary: 'mystery',
        auth: parseManagedCliAuthSpec({ auth: { type: 'cli_login' } }),
      }),
    ).toEqual({ mode: 'unsupported', binary: 'mystery' });
  });
});

describe('substituteAuthArgv', () => {
  it('replaces token/hostname/serverUrl placeholders', () => {
    expect(
      substituteAuthArgv(
        ['glab', 'auth', 'login', '--hostname', '{{hostname}}', '--token', '{{token}}'],
        {
          token: 'pat-1',
          hostname: hostnameFromServerUrl('https://gitlab.example.com/api'),
          serverUrl: 'https://gitlab.example.com',
        },
      ),
    ).toEqual([
      'glab',
      'auth',
      'login',
      '--hostname',
      'gitlab.example.com',
      '--token',
      'pat-1',
    ]);
  });
});
