; Elitesand Pro assisted NSIS installer hooks.
; package.json points nsis.license at the approved EULA.txt, so electron-builder
; renders its required agreement page before the destination and shortcut pages.

!include "LogicLib.nsh"
!include "nsDialogs.nsh"

; The uninstaller is generated from this file first. It has no shortcut page,
; so these installer-only values must not exist in that generated program.
!ifndef BUILD_UNINSTALLER
  Var EsCreateDesktopShortcut
  Var EsCreateStartMenuShortcut
  Var EsDesktopShortcutCheckbox
  Var EsStartMenuShortcutCheckbox
!endif

; electron-builder normally offers a per-machine choice for assisted installs.
; Elitesand Pro is per-user only: never elevate, never use Program Files, and
; never move runtime data out of Electron userData.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  !insertmacro setInstallModePerUser
  !ifndef BUILD_UNINSTALLER
    StrCpy $EsCreateDesktopShortcut ${BST_CHECKED}
    StrCpy $EsCreateStartMenuShortcut ${BST_CHECKED}
  !endif
!macroend

; This page is placed after the built-in destination page. It must not be
; emitted while electron-builder makes its uninstaller, because that program
; has no install page flow and treats the unused callbacks as a build error.
!ifndef BUILD_UNINSTALLER
  ; The two choices are independent and survive navigating back and forward.
  !macro customPageAfterChangeDir
    PageEx custom
      PageCallbacks EsShortcutOptionsPre EsShortcutOptionsLeave
    PageExEnd
  !macroend

  Function EsShortcutOptionsPre
    nsDialogs::Create 1018
    Pop $0

    ${NSD_CreateLabel} 0u 0u 300u 24u "可依需要建立以下捷徑；之後仍可自行刪除。"
    Pop $0

    ${NSD_CreateCheckbox} 0u 34u 300u 12u "在桌面建立 Elitesand Pro 捷徑"
    Pop $EsDesktopShortcutCheckbox
    ${NSD_SetState} $EsDesktopShortcutCheckbox $EsCreateDesktopShortcut

    ${NSD_CreateCheckbox} 0u 58u 300u 12u "在開始功能表建立 Elitesand Pro 捷徑"
    Pop $EsStartMenuShortcutCheckbox
    ${NSD_SetState} $EsStartMenuShortcutCheckbox $EsCreateStartMenuShortcut

    nsDialogs::Show
  FunctionEnd

  Function EsShortcutOptionsLeave
    ${NSD_GetState} $EsDesktopShortcutCheckbox $EsCreateDesktopShortcut
    ${NSD_GetState} $EsStartMenuShortcutCheckbox $EsCreateStartMenuShortcut
  FunctionEnd
!endif

; Built-in shortcut creation is disabled in package.json so these choices are
; honoured independently. User data is not part of the install directory and is
; never referenced by this script or by the uninstaller.
!macro customInstall
  ${If} $EsCreateDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${EndIf}

  ${If} $EsCreateStartMenuShortcut == ${BST_CHECKED}
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${EndIf}
!macroend
