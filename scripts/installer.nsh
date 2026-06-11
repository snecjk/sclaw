; StoClaw Custom NSIS Installer/Uninstaller Script
;
; Install: system requirements check, enables long paths, clears stale auth data.
; Uninstall: optionally deletes user data.

; ── Windows install requirements (fresh install only) ───────────────────────
; Thresholds + SSO host: shared/windows-install-requirements.json
; Regenerate: zx scripts/generate-windows-installer-env.mjs
!include "installer-env.generated.nsh"

!include WinVer.nsh
!include LogicLib.nsh
!include x64.nsh

; ── Compression Settings ─────────────────────────────────────────────────────
; Disable solid compression for faster installation.
; Solid compression (default) treats all files as one block - faster to compress
; but much slower to extract, especially for apps with many small files.
; Using zlib (non-solid) allows individual file extraction and parallel I/O,
; reducing install time by 20-30% at the cost of ~5-10% larger installer size.
;
; Note: SetCompressor must appear before any section/function code.
; electron-builder's default is LZMA with /SOLID, which we override here.
SetCompressor zlib

!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

!macro customInit
  ; Auto-updates already passed requirements on first install — do not re-block.
  ${if} ${isUpdated}
    Goto _stoclaw_init_done
  ${endIf}

  ; Windows 10 / 11 only (Electron 40 baseline).
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP \
      "系统配置不满足 StoClaw 安装要求。$\r$\n$\r$\n需要 Windows 10 或更高版本。" \
      /SD IDOK
    Quit
  ${EndIf}

  ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  IntCmpU $R0 ${STOCLAW_MIN_WIN10_BUILD} _stoclaw_build_ok _stoclaw_build_fail _stoclaw_build_ok
  _stoclaw_build_fail:
    MessageBox MB_OK|MB_ICONSTOP \
      "系统配置不满足 StoClaw 安装要求。$\r$\n$\r$\n需要 Windows 10 版本 1809 或更高。" \
      /SD IDOK
    Quit
  _stoclaw_build_ok:

  ; 64-bit Windows (x64 or ARM64 installers).
  ${IfNot} ${RunningX64}
    ${IfNot} ${IsNativeARM64}
      MessageBox MB_OK|MB_ICONSTOP \
        "系统配置不满足 StoClaw 安装要求。$\r$\n$\r$\n需要 64 位 Windows 系统。" \
        /SD IDOK
      Quit
    ${EndIf}
  ${EndIf}

  ; Physical RAM >= 16 GB (total installed memory, not free).
  System::Alloc 64
  Pop $R0
  System::Call '*$R0(i 64)'
  System::Call 'kernel32::GlobalMemoryStatusEx(i r0)'
  System::Call '*$R0(i, i, l.r1, l, l, l, l, l, l)'
  System::Free $R0
  System::Int64Op $1 / 1073741824
  Pop $R2
  IntCmpU $R2 ${STOCLAW_MIN_RAM_GB} _stoclaw_ram_ok _stoclaw_ram_fail _stoclaw_ram_ok
  _stoclaw_ram_fail:
    MessageBox MB_OK|MB_ICONSTOP \
      "系统配置不满足 StoClaw 安装要求。$\r$\n$\r$\n需要至少 ${STOCLAW_MIN_RAM_GB} GB 物理内存（系统及其他应用也会占用内存）。" \
      /SD IDOK
    Quit
  _stoclaw_ram_ok:

  ; Total disk capacity on the install drive >= 256 GB.
  StrCpy $R5 $INSTDIR 3
  StrLen $R6 $R5
  IntCmp $R6 3 _stoclaw_disk_probe _stoclaw_disk_fallback _stoclaw_disk_fallback
  _stoclaw_disk_fallback:
    StrCpy $R5 "$WINDIR" 3
  _stoclaw_disk_probe:
  System::Call 'kernel32::GetDiskFreeSpaceEx(w "$R5", l, *l.r1, l)'
  System::Int64Op $1 / 1073741824
  Pop $R2
  IntCmpU $R2 ${STOCLAW_MIN_DISK_GB} _stoclaw_disk_ok _stoclaw_disk_fail _stoclaw_disk_ok
  _stoclaw_disk_fail:
    MessageBox MB_OK|MB_ICONSTOP \
      "系统配置不满足 StoClaw 安装要求。$\r$\n$\r$\n安装目标磁盘总容量需要至少 ${STOCLAW_MIN_DISK_GB} GB。$\r$\n当前磁盘：$R5" \
      /SD IDOK
    Quit
  _stoclaw_disk_ok:

  ; Available free space on the install drive.
  System::Call 'kernel32::GetDiskFreeSpaceEx(w "$R5", *l.r1, l, l)'
  System::Int64Op $1 / 1073741824
  Pop $R2
  IntCmpU $R2 ${STOCLAW_MIN_FREE_DISK_GB} _stoclaw_free_ok _stoclaw_free_fail _stoclaw_free_ok
  _stoclaw_free_fail:
    MessageBox MB_OK|MB_ICONSTOP \
      "系统配置不满足 StoClaw 安装要求。$\r$\n$\r$\n安装目标磁盘可用空间需要至少 ${STOCLAW_MIN_FREE_DISK_GB} GB。$\r$\n当前磁盘：$R5" \
      /SD IDOK
    Quit
  _stoclaw_free_ok:

  ; Physical CPU cores (Win32_Processor.NumberOfCores sum).
  nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$c=(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum; if ($$c -lt ${STOCLAW_MIN_CPU_CORES}) { exit 1 } else { exit 0 }"`
  Pop $R0
  Pop $R1
  IntCmp $R0 0 _stoclaw_cpu_ok
    MessageBox MB_OK|MB_ICONSTOP \
      "系统配置不满足 StoClaw 安装要求。$\r$\n$\r$\n需要至少 ${STOCLAW_MIN_CPU_CORES} 个物理 CPU 核心。" \
      /SD IDOK
    Quit
  _stoclaw_cpu_ok:

  ; SSO reachability (hard) — host from sso-service.ts via BUILD_ENV.
  nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Test-NetConnection '${STOCLAW_SSO_HOST}' -Port 443 -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 1 } else { exit 0 }"`
  Pop $R0
  Pop $R1
  IntCmp $R0 0 _stoclaw_sso_ok
    MessageBox MB_OK|MB_ICONSTOP \
      "系统配置不满足 StoClaw 安装要求。$\r$\n$\r$\n无法连接 SSO 登录服务（${STOCLAW_SSO_HOST}:443）。$\r$\n请检查网络或代理后重试。" \
      /SD IDOK
    Quit
  _stoclaw_sso_ok:

  ; DWS / GitHub Releases (soft warn only — does not block install).
  nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Test-NetConnection 'github.com' -Port 443 -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 1 } else { exit 0 }"`
  Pop $R0
  Pop $R1
  IntCmp $R0 0 _stoclaw_soft_ok
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "网络提示：当前无法连接 GitHub Releases（DWS CLI 下载源）。$\r$\n$\r$\n不影响 StoClaw 安装，但钉钉工作区相关功能可能受限。" \
      /SD IDOK
  _stoclaw_soft_ok:

  _stoclaw_init_done:
!macroend

!macro customCheckAppRunning

  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0

  ${if} $R0 == 0
    ${if} ${isUpdated}
      # allow app to exit without explicit kill
      Sleep 1000
      Goto doStopProcess
    ${endIf}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK doStopProcess
    Quit

    doStopProcess:
    DetailPrint `Closing running "${PRODUCT_NAME}"...`

    # Step 1: Try graceful shutdown first (sends WM_CLOSE, allows before-quit/Gateway cleanup).
    # StoClaw's before-quit handler may take up to 5s to stop the Gateway process.
    !ifdef NSIS_CHAR_SIZE
      nsExec::ExecToStack `taskkill /IM "$APP_EXECUTABLE_FILENAME" /T`
    !else
      nsExec::ExecToStack `taskkill /IM "${APP_EXECUTABLE_FILENAME}" /T`
    !endif
    Pop $R0
    DetailPrint `Graceful shutdown exit code: $R0`
    Sleep 6000

    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 != 0
      Goto not_running
    ${endIf}

    # Step 2: Force kill the entire process tree.
    DetailPrint `Force-closing "${PRODUCT_NAME}"...`
    ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    !ifdef NSIS_CHAR_SIZE
      nsExec::ExecToStack `taskkill /F /IM "$APP_EXECUTABLE_FILENAME" /T`
    !else
      nsExec::ExecToStack `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T`
    !endif
    Pop $R0
    DetailPrint `Force kill exit code: $R0`
    Sleep 3000

    # Retry counter (up to 10 attempts with longer waits)
    StrCpy $R1 0

    loop:
      IntOp $R1 $R1 + 1

      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        # Process still running — try again
        DetailPrint `Retry closing "${PRODUCT_NAME}" (attempt $R1)...`
        ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        !ifdef NSIS_CHAR_SIZE
          nsExec::ExecToStack `taskkill /F /IM "$APP_EXECUTABLE_FILENAME" /T`
        !else
          nsExec::ExecToStack `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T`
        !endif
        Pop $R0
        DetailPrint `Force kill exit code (attempt $R1): $R0`

        Sleep 5000

        ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 != 0
          Goto not_running
        ${endIf}
      ${else}
        Goto not_running
      ${endIf}

      # After 10 attempts, ask user to close manually
      ${if} $R1 > 9
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY loop
        Quit
      ${else}
        Goto loop
      ${endIf}
    not_running:
      ${nsProcess::Unload}
  ${endIf}
!macroend

!macro customInstall
  ; Enable Windows long path support (Windows 10 1607+ / Windows 11).
  ; pnpm virtual store paths can exceed the default MAX_PATH limit of 260 chars.
  ; Writing to HKLM requires admin privileges; on per-user installs without
  ; elevation this call silently fails — no crash, just no key written.
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1

  ; Clear authentication data from any previous installation.
  ; This ensures users must re-authenticate after reinstalling rather than
  ; silently reusing a stale/expired token from the old install.
  ; Only auth-related files are removed — settings, providers, channels, etc. are preserved.
  Delete "$APPDATA\stoclaw\sso-auth.json"
  RMDir /r "$APPDATA\stoclaw\Local Storage"
  RMDir /r "$APPDATA\stoclaw\Session Storage"

  _ci_done:
!macroend

!macro customUnInstall
  ; Ask user if they want to completely remove all user data
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to completely remove all StoClaw user data?$\r$\n$\r$\nThis will delete:$\r$\n  • .openclaw folder (configuration & skills)$\r$\n  • AppData\Local\stoclaw (local app data)$\r$\n  • AppData\Roaming\stoclaw (roaming app data)$\r$\n$\r$\nSelect 'No' to keep your data for future reinstallation." \
    /SD IDNO IDYES _cu_removeData IDNO _cu_skipRemove

  _cu_removeData:
    ; Kill any lingering StoClaw processes to release file locks on electron-store
    ; JSON files (settings.json, stoclaw-providers.json, window-state.json, etc.)
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${endIf}
    ${nsProcess::Unload}

    ; Wait for processes to fully exit and release file handles
    Sleep 2000

    ; --- Always remove current user's data first ---
    RMDir /r "$PROFILE\.openclaw"
    RMDir /r "$LOCALAPPDATA\stoclaw"
    RMDir /r "$APPDATA\stoclaw"

    ; --- Retry: if directories still exist (locked files), wait and try again ---
    ; Check .openclaw
    IfFileExists "$PROFILE\.openclaw\*.*" 0 _cu_openclawDone
      Sleep 3000
      RMDir /r "$PROFILE\.openclaw"
      IfFileExists "$PROFILE\.openclaw\*.*" 0 _cu_openclawDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$PROFILE\.openclaw"'
        Pop $0
        Pop $1
    _cu_openclawDone:

    ; Check AppData\Local\stoclaw
    IfFileExists "$LOCALAPPDATA\stoclaw\*.*" 0 _cu_localDone
      Sleep 3000
      RMDir /r "$LOCALAPPDATA\stoclaw"
      IfFileExists "$LOCALAPPDATA\stoclaw\*.*" 0 _cu_localDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$LOCALAPPDATA\stoclaw"'
        Pop $0
        Pop $1
    _cu_localDone:

    ; Check AppData\Roaming\stoclaw
    IfFileExists "$APPDATA\stoclaw\*.*" 0 _cu_roamingDone
      Sleep 3000
      RMDir /r "$APPDATA\stoclaw"
      IfFileExists "$APPDATA\stoclaw\*.*" 0 _cu_roamingDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$APPDATA\stoclaw"'
        Pop $0
        Pop $1
    _cu_roamingDone:

    ; --- Final check: warn user if any directories could not be removed ---
    StrCpy $R3 ""
    IfFileExists "$PROFILE\.openclaw\*.*" 0 +2
      StrCpy $R3 "$R3$\r$\n  • $PROFILE\.openclaw"
    IfFileExists "$LOCALAPPDATA\stoclaw\*.*" 0 +2
      StrCpy $R3 "$R3$\r$\n  • $LOCALAPPDATA\stoclaw"
    IfFileExists "$APPDATA\stoclaw\*.*" 0 +2
      StrCpy $R3 "$R3$\r$\n  • $APPDATA\stoclaw"
    StrCmp $R3 "" _cu_cleanupOk
      MessageBox MB_OK|MB_ICONEXCLAMATION \
        "Some data directories could not be removed (files may be in use):$\r$\n$R3$\r$\n$\r$\nPlease delete them manually after restarting your computer."
    _cu_cleanupOk:

    ; --- For per-machine (all users) installs, enumerate all user profiles ---
    StrCpy $R0 0

  _cu_enumLoop:
    EnumRegKey $R1 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList" $R0
    StrCmp $R1 "" _cu_enumDone

    ReadRegStr $R2 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$R1" "ProfileImagePath"
    StrCmp $R2 "" _cu_enumNext

    ExpandEnvStrings $R2 $R2
    StrCmp $R2 $PROFILE _cu_enumNext

    RMDir /r "$R2\.openclaw"
    RMDir /r "$R2\AppData\Local\stoclaw"
    RMDir /r "$R2\AppData\Roaming\stoclaw"

  _cu_enumNext:
    IntOp $R0 $R0 + 1
    Goto _cu_enumLoop

  _cu_enumDone:
  _cu_skipRemove:
!macroend

