import { describe, expect, it } from 'vitest';

import {
  buildWindowsInstallScriptCommand,
  detectWindowsInstallScriptKind,
  mergeWindowsPathValues,
} from '../../electron/connectors/installers/shell-script-installer';

describe('Windows shell-script installer', () => {
  it('runs .ps1 installers with Windows PowerShell', () => {
    const kind = detectWindowsInstallScriptKind(
      'https://d.officecli.ai/install.ps1',
      '$repo = "iOfficeAI/OfficeCLI"',
    );
    const invocation = buildWindowsInstallScriptCommand(
      kind,
      String.raw`C:\Temp\install.ps1`,
    );

    expect(kind).toBe('powershell');
    expect(invocation.command).toBe('powershell.exe');
    expect(invocation.args).toContain('-File');
    expect(invocation.args.at(-1)).toBe(String.raw`C:\Temp\install.ps1`);
  });

  it('keeps .cmd installers on cmd.exe', () => {
    const kind = detectWindowsInstallScriptKind(
      'https://operation-pmai.sto.cn/api/qpath-cli/prod/install.cmd',
      '@echo off\r\necho installing',
    );

    expect(kind).toBe('cmd');
    expect(buildWindowsInstallScriptCommand(kind, String.raw`C:\Temp\install.cmd`))
      .toEqual({
        command: 'cmd.exe',
        args: ['/d', '/c', String.raw`C:\Temp\install.cmd`],
      });
  });

  it('recognizes extensionless PowerShell content', () => {
    expect(detectWindowsInstallScriptKind(
      'https://example.com/install',
      'param([string]$Version)\nWrite-Host $Version',
    )).toBe('powershell');
  });

  it('merges a newly persisted user PATH without duplicate entries', () => {
    expect(mergeWindowsPathValues(
      String.raw`C:\Users\tester\AppData\Local\OfficeCLI;C:\Windows`,
      String.raw`C:\Windows;C:\Windows\System32`,
      'C:\\tools;C:\\WINDOWS\\',
    )).toBe([
      String.raw`C:\Users\tester\AppData\Local\OfficeCLI`,
      String.raw`C:\Windows`,
      String.raw`C:\Windows\System32`,
      String.raw`C:\tools`,
    ].join(';'));
  });
});
