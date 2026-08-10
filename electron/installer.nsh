; Elitesand Pro assisted NSIS installer hooks.
; package.json points nsis.license at the approved EULA.txt, so electron-builder
; renders its required agreement page before the destination and shortcut pages.

!include "LogicLib.nsh"
!include "nsDialogs.nsh"

; Keep the language choice consistent across built-in and custom pages.
; English is the fallback and the initial selection; users can choose any of
; the five languages before the installer wizard opens.
LangString EsCleanupIntro ${LANG_ENGLISH} "Uninstall Elitesand Pro. Songs, settings, and history are kept by default."
LangString EsCleanupDeleteAll ${LANG_ENGLISH} "Also delete all Elitesand Pro songs, settings, and history (cannot be undone)"
LangString EsShortcutIntro ${LANG_ENGLISH} "Choose the shortcuts you want to create. You can remove them later."
LangString EsShortcutDesktop ${LANG_ENGLISH} "Create an Elitesand Pro shortcut on the desktop"
LangString EsShortcutStartMenu ${LANG_ENGLISH} "Create an Elitesand Pro shortcut in the Start menu"

LangString EsCleanupIntro ${LANG_TRADCHINESE} "解除安裝 Elitesand Pro。預設會保留歌曲、設定與記錄。"
LangString EsCleanupDeleteAll ${LANG_TRADCHINESE} "同時刪除所有 Elitesand Pro 歌曲、設定與記錄（無法復原）"
LangString EsShortcutIntro ${LANG_TRADCHINESE} "可依需要建立以下捷徑；之後仍可自行刪除。"
LangString EsShortcutDesktop ${LANG_TRADCHINESE} "在桌面建立 Elitesand Pro 捷徑"
LangString EsShortcutStartMenu ${LANG_TRADCHINESE} "在開始功能表建立 Elitesand Pro 捷徑"

LangString EsCleanupIntro ${LANG_JAPANESE} "Elitesand Pro をアンインストールします。曲、設定、履歴は既定で保持されます。"
LangString EsCleanupDeleteAll ${LANG_JAPANESE} "Elitesand Pro の曲、設定、履歴をすべて削除する（元に戻せません）"
LangString EsShortcutIntro ${LANG_JAPANESE} "必要なショートカットを作成できます。後から削除することもできます。"
LangString EsShortcutDesktop ${LANG_JAPANESE} "デスクトップに Elitesand Pro のショートカットを作成"
LangString EsShortcutStartMenu ${LANG_JAPANESE} "スタートメニューに Elitesand Pro のショートカットを作成"

LangString EsCleanupIntro ${LANG_KOREAN} "Elitesand Pro를 제거합니다. 노래, 설정 및 기록은 기본적으로 유지됩니다."
LangString EsCleanupDeleteAll ${LANG_KOREAN} "Elitesand Pro의 모든 노래, 설정 및 기록도 삭제(되돌릴 수 없음)"
LangString EsShortcutIntro ${LANG_KOREAN} "필요한 바로 가기를 만드세요. 나중에 삭제할 수 있습니다."
LangString EsShortcutDesktop ${LANG_KOREAN} "바탕 화면에 Elitesand Pro 바로 가기 만들기"
LangString EsShortcutStartMenu ${LANG_KOREAN} "시작 메뉴에 Elitesand Pro 바로 가기 만들기"

LangString EsCleanupIntro ${LANG_SIMPCHINESE} "卸载 Elitesand Pro。默认会保留歌曲、设置与记录。"
LangString EsCleanupDeleteAll ${LANG_SIMPCHINESE} "同时删除所有 Elitesand Pro 歌曲、设置与记录（无法恢复）"
LangString EsShortcutIntro ${LANG_SIMPCHINESE} "可按需创建以下快捷方式；之后仍可自行删除。"
LangString EsShortcutDesktop ${LANG_SIMPCHINESE} "在桌面创建 Elitesand Pro 快捷方式"
LangString EsShortcutStartMenu ${LANG_SIMPCHINESE} "在开始菜单创建 Elitesand Pro 快捷方式"

; The uninstaller is generated from this file first. It has no shortcut page,
; so these installer-only values must not exist in that generated program.
!ifndef BUILD_UNINSTALLER
  Var EsCreateDesktopShortcut
  Var EsCreateStartMenuShortcut
  Var EsDesktopShortcutCheckbox
  Var EsStartMenuShortcutCheckbox
!endif

!ifdef BUILD_UNINSTALLER
  Var EsRemoveAllData
  Var EsRemoveAllDataCheckbox

  !macro customUnInit
    StrCpy $EsRemoveAllData ${BST_UNCHECKED}
  !macroend

  ; This replaces only the normal welcome page, so the user's cleanup choice
  ; is collected before the uninstall section runs.
  !macro customUnWelcomePage
    ; electron-builder expands this macro while compiling the uninstaller.
    ; NSIS therefore requires the explicit UninstPage form; PageEx custom is
    ; treated as an installer page and rejects even correctly prefixed un.*
    ; callbacks with "function names must start with un.".
    UninstPage custom un.EsCleanupPre un.EsCleanupLeave
  !macroend

  Function un.EsCleanupPre
    nsDialogs::Create 1018
    Pop $0

    ${NSD_CreateLabel} 0u 0u 300u 30u "$(EsCleanupIntro)"
    Pop $0

    ${NSD_CreateCheckbox} 0u 40u 300u 24u "$(EsCleanupDeleteAll)"
    Pop $EsRemoveAllDataCheckbox
    ${NSD_SetState} $EsRemoveAllDataCheckbox $EsRemoveAllData

    nsDialogs::Show
  FunctionEnd

  Function un.EsCleanupLeave
    ${NSD_GetState} $EsRemoveAllDataCheckbox $EsRemoveAllData
  FunctionEnd

  !macro customUnInstall
    ${If} $EsRemoveAllData == ${BST_CHECKED}
      ; The media path is written by the desktop host. Marker verification is
      ; mandatory: even after explicit consent, never recursively delete an
      ; arbitrary directory selected by the user.
      ReadINIStr $0 "$APPDATA\Elitesand Pro\media-storage.ini" "media" "path"
      ${If} $0 != ""
        IfFileExists "$0\.elitesand-pro-media-root" 0 +2
          RMDir /r "$0"
      ${EndIf}
      RMDir /r "$APPDATA\Elitesand Pro"
    ${EndIf}
  !macroend
!endif

; electron-builder normally offers a per-machine choice for assisted installs.
; Elitesand Pro is per-user only: never elevate, never use Program Files, and
; never move runtime data out of Electron userData.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Set the initial item in the language dialog to English even on non-English
; Windows installations. MUI_LANGDLL_DISPLAY runs after this pre-init hook.
!macro preInit
  !ifndef BUILD_UNINSTALLER
    StrCpy $LANGUAGE ${LANG_ENGLISH}
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
; honoured independently. Runtime data is outside the install directory; the
; uninstaller preserves it unless the explicit cleanup checkbox is selected.
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
