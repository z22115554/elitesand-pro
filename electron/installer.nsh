; Elitesand Pro assisted NSIS installer hooks.
; package.json points nsis.license at the approved EULA.txt, so electron-builder
; renders its required agreement page before the destination and shortcut pages.
;
; DATA-SAFETY CONTRACT:
; Installer, update, reinstall and uninstall flows must never delete songs,
; settings, history, credentials, user configuration, or any other persistent
; user data. Destructive cleanup belongs only to explicit in-app actions that
; target a specific item and can validate what is being removed.

!include "LogicLib.nsh"
!include "nsDialogs.nsh"

; NSIS' bundled Korean.nlf requests the legacy Gulim face (굴림). That face is
; not present on many non-Korean Windows installations. The language file is
; loaded after this include, so a plain MUI_FONT definition is overwritten.
; electron-builder expands customHeader after addLangs; override only Korean
; there with Malgun Gothic, the current Windows Korean UI font.
!macro customHeader
  SetFont /LANG=1042 "Malgun Gothic" 9
!macroend

; Keep the language choice consistent across built-in and custom pages.
; English is the fallback and the initial selection; users can choose any of
; the five languages before the installer wizard opens.
; Language IDs are raw Windows LCIDs because this file is included before the
; generated MUI_LANGUAGE block defines the named constants.
LangString EsShortcutIntro 1033 "Choose the shortcuts you want to create. You can remove them later."
LangString EsShortcutDesktop 1033 "Create an Elitesand Pro shortcut on the desktop"
LangString EsShortcutStartMenu 1033 "Create an Elitesand Pro shortcut in the Start menu"

LangString EsShortcutIntro 1028 "可依需要建立以下捷徑；之後仍可自行刪除。"
LangString EsShortcutDesktop 1028 "在桌面建立 Elitesand Pro 捷徑"
LangString EsShortcutStartMenu 1028 "在開始功能表建立 Elitesand Pro 捷徑"

LangString EsShortcutIntro 1041 "必要なショートカットを作成できます。後から削除することもできます。"
LangString EsShortcutDesktop 1041 "デスクトップに Elitesand Pro のショートカットを作成"
LangString EsShortcutStartMenu 1041 "スタートメニューに Elitesand Pro のショートカットを作成"

LangString EsShortcutIntro 1042 "필요한 바로 가기를 만드세요. 나중에 삭제할 수 있습니다."
LangString EsShortcutDesktop 1042 "바탕 화면에 Elitesand Pro 바로 가기 만들기"
LangString EsShortcutStartMenu 1042 "시작 메뉴에 Elitesand Pro 바로 가기 만들기"

LangString EsShortcutIntro 2052 "可按需创建以下快捷方式；之后仍可自行删除。"
LangString EsShortcutDesktop 2052 "在桌面创建 Elitesand Pro 快捷方式"
LangString EsShortcutStartMenu 2052 "在开始菜单创建 Elitesand Pro 快捷方式"

; The uninstaller is generated from this file first. It has no shortcut page,
; so these installer-only values must not exist in that generated program.
!ifndef BUILD_UNINSTALLER
  Var EsCreateDesktopShortcut
  Var EsCreateStartMenuShortcut
  Var EsDesktopShortcutCheckbox
  Var EsStartMenuShortcutCheckbox
!endif

!ifdef BUILD_UNINSTALLER
  ; Intentionally empty. The uninstaller removes application-owned runtime files
  ; from the installation directory only. It must never recursively delete
  ; Electron userData, the sibling media folder, or a user-selected media path.
  !macro customUnInstall
  !macroend
!endif

; electron-builder normally offers a per-machine choice for assisted installs.
; Elitesand Pro is per-user only: never elevate and never use Program Files.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Set the initial item in the language dialog to English even on non-English
; Windows installations. Use literal LCID 1033 because named language constants
; are not defined yet when electron-builder includes this file.
!macro preInit
  !ifndef BUILD_UNINSTALLER
    StrCpy $LANGUAGE "1033"
  !endif
!macroend

!macro customInit
  !insertmacro setInstallModePerUser
  !ifndef BUILD_UNINSTALLER
    StrCpy $EsCreateDesktopShortcut ${BST_CHECKED}
    StrCpy $EsCreateStartMenuShortcut ${BST_CHECKED}
  !endif
!macroend

; This page is placed after the built-in destination page. It must not be
; emitted while electron-builder makes its uninstaller.
!ifndef BUILD_UNINSTALLER
  !macro customPageAfterChangeDir
    PageEx custom
      PageCallbacks EsShortcutOptionsPre EsShortcutOptionsLeave
    PageExEnd
  !macroend

  Function EsShortcutOptionsPre
    nsDialogs::Create 1018
    Pop $0

    ${NSD_CreateLabel} 0u 0u 300u 24u "$(EsShortcutIntro)"
    Pop $0

    ${NSD_CreateCheckbox} 0u 34u 300u 12u "$(EsShortcutDesktop)"
    Pop $EsDesktopShortcutCheckbox
    ${NSD_SetState} $EsDesktopShortcutCheckbox $EsCreateDesktopShortcut

    ${NSD_CreateCheckbox} 0u 58u 300u 12u "$(EsShortcutStartMenu)"
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
; honoured independently. Persistent user data is outside the replaceable
; application directory and is never removed by the uninstaller.
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

  ; Hand the wizard's chosen language to the app for its very first launch.
  ${If} $LANGUAGE == 1033
    StrCpy $0 "en"
  ${ElseIf} $LANGUAGE == 1028
    StrCpy $0 "zh-TW"
  ${ElseIf} $LANGUAGE == 1041
    StrCpy $0 "ja"
  ${ElseIf} $LANGUAGE == 1042
    StrCpy $0 "ko"
  ${ElseIf} $LANGUAGE == 2052
    StrCpy $0 "zh-CN"
  ${Else}
    StrCpy $0 "zh-TW"
  ${EndIf}
  CreateDirectory "$APPDATA\Elitesand Pro"
  FileOpen $1 "$APPDATA\Elitesand Pro\installer-locale.txt" w
  FileWrite $1 "$0"
  FileClose $1
!macroend
