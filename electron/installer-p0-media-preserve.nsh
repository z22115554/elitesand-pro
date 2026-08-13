; P0 compatibility wrapper for the v0.9.9.7 media-loss regression.
; Keep the existing installer customizations intact, then extend customInit with
; a pre-uninstall COPY of the one historical media location that lived inside
; the application installation directory.

!include "${PROJECT_DIR}\electron\installer.nsh"
!include "FileFunc.nsh"

LangString EsMediaPreserveFailed 1033 "Setup stopped to protect your downloaded songs. Elitesand Pro could not safely back up media stored inside the old installation folder. Close Elitesand Pro and run the installer again. No source media was deleted by this check."
LangString EsMediaPreserveFailed 1028 "為了保護已下載歌曲，安裝已停止。Elitesand Pro 無法安全備份舊安裝目錄內的媒體檔案。請先關閉 Elitesand Pro，再重新執行安裝程式。本次檢查沒有刪除任何來源媒體檔案。"
LangString EsMediaPreserveFailed 1041 "ダウンロード済みの曲を保護するため、インストールを中止しました。旧インストール先に保存されたメディアを安全にバックアップできませんでした。Elitesand Pro を終了してから、インストーラーをもう一度実行してください。この確認処理では元のメディアを削除していません。"
LangString EsMediaPreserveFailed 1042 "다운로드한 노래를 보호하기 위해 설치를 중단했습니다. 이전 설치 폴더에 저장된 미디어를 안전하게 백업하지 못했습니다. Elitesand Pro를 종료한 뒤 설치 프로그램을 다시 실행해 주세요. 이 확인 과정에서는 원본 미디어를 삭제하지 않았습니다."
LangString EsMediaPreserveFailed 2052 "为保护已下载歌曲，安装已停止。Elitesand Pro 无法安全备份旧安装目录中的媒体文件。请先关闭 Elitesand Pro，再重新运行安装程序。本次检查没有删除任何源媒体文件。"

!ifndef BUILD_UNINSTALLER
  Function EsPreserveVulnerableMedia
    ReadINIStr $0 "$APPDATA\Elitesand Pro\media-storage.ini" "media" "path"
    ${If} $0 == ""
      Return
    ${EndIf}

    IfFileExists "$0\.elitesand-pro-media-root" 0 EsPreserveDone
    ${GetFileName} "$0" $1
    StrCmp $1 "Elitesand Pro Media" 0 EsPreserveDone
    ${GetParent} "$0" $2

    ; Only the v0.9.9.7 default is eligible. A user-selected custom folder that
    ; happens to have the same leaf name is left untouched.
    IfFileExists "$2\Elitesand Pro.exe" 0 EsPreserveDone

    StrCpy $3 "$APPDATA\Elitesand Pro\downloads"
    CreateDirectory "$3"
    ClearErrors

    ; COPY only. If setup is cancelled or later fails, the old app still has
    ; its original files. robocopy handles nested media folders and cross-volume
    ; paths. Exit codes 0-7 are success; 8+ indicate a copy failure.
    nsExec::ExecToStack '"$SYSDIR\robocopy.exe" "$0" "$3" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /NFL /NDL /NJH /NJS /NP'
    IfErrors EsPreserveFailed
    Pop $4
    Pop $5
    StrCmp $4 "error" EsPreserveFailed
    StrCmp $4 "timeout" EsPreserveFailed
    IntCmp $4 8 EsPreserveFailed EsPreserveOk EsPreserveFailed

  EsPreserveOk:
    IfFileExists "$3\.elitesand-pro-media-root" 0 EsPreserveFailed
    Return

  EsPreserveFailed:
    MessageBox MB_ICONSTOP|MB_OK "$(EsMediaPreserveFailed)" /SD IDOK
    Abort

  EsPreserveDone:
    Return
  FunctionEnd
!endif

; installer.nsh already defines customInit. Replace only that macro so all of
; its existing per-user and shortcut behavior stays identical while the P0
; backup runs before the install sections can replace the previous app.
!macroundef customInit
!macro customInit
  !insertmacro setInstallModePerUser
  !ifndef BUILD_UNINSTALLER
    Call EsPreserveVulnerableMedia
    StrCpy $EsCreateDesktopShortcut ${BST_CHECKED}
    StrCpy $EsCreateStartMenuShortcut ${BST_CHECKED}
  !endif
!macroend
