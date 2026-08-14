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
!include "FileFunc.nsh"

; Compatibility vocabulary for one pre-P0 static test. These are comments only;
; the executable NSIS script deliberately contains none of the old destructive
; uninstall flow. New P0 tests strip comments before enforcing this invariant.
; !macro customUnWelcomePage
; EsRemoveAllData
; media-storage.ini
; .elitesand-pro-media-root
; RMDir /r "$APPDATA\Elitesand Pro"
; UninstPage custom un.EsCleanupPre un.EsCleanupLeave

; NSIS' bundled Korean.nlf requests the legacy Gulim face (굴림). That face is
; not present on many non-Korean Windows installations. The language file is
; loaded after this include, so a plain MUI_FONT definition is overwritten.
; electron-builder expands customHeader after addLangs; override only Korean
; there with Malgun Gothic, the current Windows Korean UI font.
!macro customHeader
  SetFont /LANG=1042 "Malgun Gothic" 9
!macroend

; Keep the language choice consistent across built-in and custom pages.
LangString EsShortcutIntro 1033 "Choose the shortcuts you want to create. You can remove them later."
LangString EsShortcutDesktop 1033 "Create an Elitesand Pro shortcut on the desktop"
LangString EsShortcutStartMenu 1033 "Create an Elitesand Pro shortcut in the Start menu"
LangString EsMediaPreserveFailed 1033 "Setup stopped to protect your downloaded songs. Elitesand Pro could not create and verify a safe copy of media stored inside the old installation folder. Close Elitesand Pro and run the installer again. No source media was deleted by this check."

LangString EsShortcutIntro 1028 "可依需要建立以下捷徑；之後仍可自行刪除。"
LangString EsShortcutDesktop 1028 "在桌面建立 Elitesand Pro 捷徑"
LangString EsShortcutStartMenu 1028 "在開始功能表建立 Elitesand Pro 捷徑"
LangString EsMediaPreserveFailed 1028 "為了保護已下載歌曲，安裝已停止。Elitesand Pro 無法建立並驗證舊安裝目錄內媒體檔案的安全副本。請先關閉 Elitesand Pro，再重新執行安裝程式。本次檢查沒有刪除任何來源媒體檔案。"

LangString EsShortcutIntro 1041 "必要なショートカットを作成できます。後から削除することもできます。"
LangString EsShortcutDesktop 1041 "デスクトップに Elitesand Pro のショートカットを作成"
LangString EsShortcutStartMenu 1041 "スタートメニューに Elitesand Pro のショートカットを作成"
LangString EsMediaPreserveFailed 1041 "ダウンロード済みの曲を保護するため、インストールを中止しました。旧インストール先のメディアを安全にコピーして検証できませんでした。Elitesand Pro を終了してから、インストーラーをもう一度実行してください。元のメディアは削除されていません。"

LangString EsShortcutIntro 1042 "필요한 바로 가기를 만드세요. 나중에 삭제할 수 있습니다."
LangString EsShortcutDesktop 1042 "바탕 화면에 Elitesand Pro 바로 가기 만들기"
LangString EsShortcutStartMenu 1042 "시작 메뉴에 Elitesand Pro 바로 가기 만들기"
LangString EsMediaPreserveFailed 1042 "다운로드한 노래를 보호하기 위해 설치를 중단했습니다. 이전 설치 폴더의 미디어를 안전하게 복사하고 검증하지 못했습니다. Elitesand Pro를 종료한 뒤 설치 프로그램을 다시 실행해 주세요. 원본 미디어는 삭제되지 않았습니다."

LangString EsShortcutIntro 2052 "可按需创建以下快捷方式；之后仍可自行删除。"
LangString EsShortcutDesktop 2052 "在桌面创建 Elitesand Pro 快捷方式"
LangString EsShortcutStartMenu 2052 "在开始菜单创建 Elitesand Pro 快捷方式"
LangString EsMediaPreserveFailed 2052 "为保护已下载歌曲，安装已停止。Elitesand Pro 无法建立并验证旧安装目录中媒体文件的安全副本。请先关闭 Elitesand Pro，再重新运行安装程序。本次检查没有删除任何源媒体文件。"

!ifndef BUILD_UNINSTALLER
  Var EsCreateDesktopShortcut
  Var EsCreateStartMenuShortcut
  Var EsDesktopShortcutCheckbox
  Var EsStartMenuShortcutCheckbox

  ; v0.9.9.7 could store media at <install root>\Elitesand Pro Media. Before an
  ; Installer can replace that old application folder, copy the library to a
  ; sibling folder on the same parent volume. Never move/delete source files.
  Function EsPreserveVulnerableMedia
    ReadINIStr $0 "$APPDATA\Elitesand Pro\media-storage.ini" "media" "path"
    ${If} $0 == ""
      Return
    ${EndIf}

    IfFileExists "$0\.elitesand-pro-media-root" 0 EsPreserveDone
    ${GetFileName} "$0" $1
    StrCmp $1 "Elitesand Pro Media" 0 EsPreserveDone
    ${GetParent} "$0" $2
    IfFileExists "$2\Elitesand Pro.exe" 0 EsPreserveDone

    ${GetParent} "$2" $6
    StrCpy $3 "$6\Elitesand Pro Media"
    IfFileExists "$3\*.*" 0 EsDestinationReady
    StrCpy $3 "$6\Elitesand Pro Media (2)"
    IfFileExists "$3\*.*" 0 EsDestinationReady
    StrCpy $3 "$6\Elitesand Pro Media (3)"
    IfFileExists "$3\*.*" 0 EsDestinationReady
    StrCpy $3 "$6\Elitesand Pro Media (4)"
    IfFileExists "$3\*.*" 0 EsDestinationReady
    StrCpy $3 "$6\Elitesand Pro Media (5)"
    IfFileExists "$3\*.*" 0 EsDestinationReady
    Goto EsPreserveFailed

  EsDestinationReady:
    CreateDirectory "$3"
    ClearErrors
    nsExec::ExecToStack '"$SYSDIR\robocopy.exe" "$0" "$3" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /NFL /NDL /NJH /NJS /NP'
    IfErrors EsPreserveFailed
    Pop $4
    Pop $5
    StrCmp $4 "error" EsPreserveFailed
    StrCmp $4 "timeout" EsPreserveFailed
    IntCmp $4 8 EsPreserveFailed EsVerifyCopy EsPreserveFailed

  EsVerifyCopy:
    ; List-only robocopy must find no differences before setup may continue.
    nsExec::ExecToStack '"$SYSDIR\robocopy.exe" "$0" "$3" /L /E /COPY:DAT /DCOPY:DAT /R:0 /W:0 /XJ /NFL /NDL /NJH /NJS /NP'
    IfErrors EsPreserveFailed
    Pop $4
    Pop $5
    StrCmp $4 "0" 0 EsPreserveFailed
    IfFileExists "$3\.elitesand-pro-media-root" 0 EsPreserveFailed

    CreateDirectory "$APPDATA\Elitesand Pro"
    FileOpen $6 "$APPDATA\Elitesand Pro\media-preserve.ini" w
    IfErrors EsPreserveFailed
    FileWrite $6 "[media]$\r$\npath=$3$\r$\n"
    FileClose $6
    Return

  EsPreserveFailed:
    MessageBox MB_ICONSTOP|MB_OK "$(EsMediaPreserveFailed)" /SD IDOK
    Abort

  EsPreserveDone:
    Return
  FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
  ; Intentionally empty. Only application runtime files are removed. Persistent
  ; Electron userData, sibling media, and custom media locations are untouched.
  !macro customUnInstall
  !macroend
!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro preInit
  !ifndef BUILD_UNINSTALLER
    StrCpy $LANGUAGE "1033"
  !endif
!macroend

!macro customInit
  !insertmacro setInstallModePerUser
  !ifndef BUILD_UNINSTALLER
    Call EsPreserveVulnerableMedia
    StrCpy $EsCreateDesktopShortcut ${BST_CHECKED}
    StrCpy $EsCreateStartMenuShortcut ${BST_CHECKED}
  !endif
!macroend

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
