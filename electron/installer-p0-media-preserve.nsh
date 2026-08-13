; P0 compatibility wrapper for the v0.9.9.7 media-loss regression.
; The old release could store downloaded media *inside* the application folder.
; Before electron-builder is allowed to replace that folder, copy the media to
; a sibling directory on the same parent volume and record the recovery path.
; Source media is NEVER deleted by this hook.

!include "${PROJECT_DIR}\electron\installer.nsh"
!include "FileFunc.nsh"

LangString EsMediaPreserveFailed 1033 "Setup stopped to protect your downloaded songs. Elitesand Pro could not create and verify a safe copy of media stored inside the old installation folder. Close Elitesand Pro and run the installer again. No source media was deleted by this check."
LangString EsMediaPreserveFailed 1028 "為了保護已下載歌曲，安裝已停止。Elitesand Pro 無法建立並驗證舊安裝目錄內媒體檔案的安全副本。請先關閉 Elitesand Pro，再重新執行安裝程式。本次檢查沒有刪除任何來源媒體檔案。"
LangString EsMediaPreserveFailed 1041 "ダウンロード済みの曲を保護するため、インストールを中止しました。旧インストール先のメディアを安全にコピーして検証できませんでした。Elitesand Pro を終了してから、インストーラーをもう一度実行してください。元のメディアは削除されていません。"
LangString EsMediaPreserveFailed 1042 "다운로드한 노래를 보호하기 위해 설치를 중단했습니다. 이전 설치 폴더의 미디어를 안전하게 복사하고 검증하지 못했습니다. Elitesand Pro를 종료한 뒤 설치 프로그램을 다시 실행해 주세요. 원본 미디어는 삭제되지 않았습니다."
LangString EsMediaPreserveFailed 2052 "为保护已下载歌曲，安装已停止。Elitesand Pro 无法建立并验证旧安装目录中媒体文件的安全副本。请先关闭 Elitesand Pro，再重新运行安装程序。本次检查没有删除任何源媒体文件。"

!ifndef BUILD_UNINSTALLER
  Function EsPreserveVulnerableMedia
    ReadINIStr $0 "$APPDATA\Elitesand Pro\media-storage.ini" "media" "path"
    ${If} $0 == ""
      Return
    ${EndIf}

    ; Only rescue the historical broken default:
    ;   <install root>\Elitesand Pro Media
    ; A user-selected custom location is never touched.
    IfFileExists "$0\.elitesand-pro-media-root" 0 EsPreserveDone
    ${GetFileName} "$0" $1
    StrCmp $1 "Elitesand Pro Media" 0 EsPreserveDone
    ${GetParent} "$0" $2
    IfFileExists "$2\Elitesand Pro.exe" 0 EsPreserveDone

    ; Put large media beside the install directory, not in AppData and not
    ; inside the replaceable application root. Example:
    ;   D:\Apps\Elitesand Pro
    ;   D:\Apps\Elitesand Pro Media
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

    ; COPY only. If setup is cancelled or later fails, the old application still
    ; has every original file. robocopy exit codes 0-7 are non-fatal; 8+ fail.
    nsExec::ExecToStack '"$SYSDIR\robocopy.exe" "$0" "$3" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /NFL /NDL /NJH /NJS /NP'
    IfErrors EsPreserveFailed
    Pop $4
    Pop $5
    StrCmp $4 "error" EsPreserveFailed
    StrCmp $4 "timeout" EsPreserveFailed
    IntCmp $4 8 EsPreserveFailed EsVerifyCopy EsPreserveFailed

  EsVerifyCopy:
    ; A second list-only robocopy must report no remaining differences. This is
    ; deliberately fail-closed: installation does not continue unless the copy
    ; is verified while the original files still exist.
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

; installer.nsh owns the normal setup behavior. Extend only customInit so the
; protective copy happens before any old application directory can be replaced.
!macroundef customInit
!macro customInit
  !insertmacro setInstallModePerUser
  !ifndef BUILD_UNINSTALLER
    Call EsPreserveVulnerableMedia
    StrCpy $EsCreateDesktopShortcut ${BST_CHECKED}
    StrCpy $EsCreateStartMenuShortcut ${BST_CHECKED}
  !endif
!macroend
