; StoClaw Custom NSIS Installer/Uninstaller Script
;
; Install: enables long paths, clears stale auth data.
; Uninstall: optionally deletes user data.

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

    # Electron apps spawn multiple processes (main, renderer, GPU, utility).
    # nsProcess::KillProcess may only terminate one instance.
    # Use taskkill /F /IM /T to force-close the entire process tree.
    ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    !ifdef NSIS_CHAR_SIZE
      nsExec::ExecToStack `taskkill /F /IM "$APP_EXECUTABLE_FILENAME" /T`
    !else
      nsExec::ExecToStack `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T`
    !endif
    Pop $R0

    # Wait longer for the entire process tree to terminate
    Sleep 2000

    # Retry counter (up to 5 attempts)
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

        ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        ${If} $R0 == 0
          DetailPrint `Waiting for "${PRODUCT_NAME}" to close...`
          Sleep 3000
        ${else}
          Goto not_running
        ${endIf}
      ${else}
        Goto not_running
      ${endIf}

      # After 5 attempts, ask user to close manually
      ${if} $R1 > 4
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

