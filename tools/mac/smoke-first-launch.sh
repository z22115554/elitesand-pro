#!/bin/bash
# CI：模擬「從網路下載的 DMG」，確認第一次開啟小工具的實際行為。
#   bash tools/mac/smoke-first-launch.sh <dmg> <report.txt>
# 1. 複製 DMG、加上跟瀏覽器下載一樣的 com.apple.quarantine 屬性後掛載；
# 2. 記錄掛載後 app 與小工具是否帶著隔離屬性、spctl（Gatekeeper）對它們的評估結果
#    （這是「雙擊會不會被擋」的依據；runner 上沒有人能真的去 Finder 雙擊）；
# 3. 像使用者拖進「應用程式」一樣把 app 連同屬性複製出來，對那份執行小工具
#    （不開對話框、不開 app），確認隔離屬性真的被移除。只有第 3 點失敗才算建置失敗。
set -u
DMG="$1"; REPORT="$2"
WORK=$(mktemp -d)
MNT="$WORK/mnt"; mkdir -p "$MNT" "$WORK/Applications"
cp "$DMG" "$WORK/download.dmg"
xattr -w com.apple.quarantine "0083;$(printf %x "$(date +%s)");Safari;$(uuidgen)" "$WORK/download.dmg"
hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$MNT" "$WORK/download.dmg" >/dev/null
HELPER=$(ls "$MNT"/*.command | head -1)
{
  echo "macOS $(sw_vers -productVersion) $(uname -m)"
  echo "DMG quarantine: $(xattr -p com.apple.quarantine "$WORK/download.dmg" 2>&1)"
  echo "mounted app quarantine: $(xattr -p com.apple.quarantine "$MNT/Elitesand Pro.app" 2>&1)"
  echo "mounted helper quarantine: $(xattr -p com.apple.quarantine "$HELPER" 2>&1)"
  echo "helper mode: $(stat -f %Sp "$HELPER")"
  echo "spctl app (execute): $(spctl --assess --type execute -vv "$MNT/Elitesand Pro.app" 2>&1 | tr '\n' ' ')"
  echo "spctl helper (open): $(spctl --assess --type open --context context:primary-signature -vv "$HELPER" 2>&1 | tr '\n' ' ')"
} > "$REPORT"
ditto "$MNT/Elitesand Pro.app" "$WORK/Applications/Elitesand Pro.app"
xattr -w com.apple.quarantine "0083;$(printf %x "$(date +%s)");Safari;$(uuidgen)" "$WORK/Applications/Elitesand Pro.app"
echo "copied app quarantine before helper: $(xattr -p com.apple.quarantine "$WORK/Applications/Elitesand Pro.app" 2>&1)" >> "$REPORT"
ELITESAND_APP_PATH="$WORK/Applications/Elitesand Pro.app" ELITESAND_NO_DIALOG=1 ELITESAND_NO_OPEN=1 bash "$HELPER" >> "$REPORT" 2>&1
STATUS=$?
if xattr -p com.apple.quarantine "$WORK/Applications/Elitesand Pro.app" >/dev/null 2>&1; then CLEARED=no; else CLEARED=yes; fi
LEFT=$(xattr -rl "$WORK/Applications/Elitesand Pro.app" 2>/dev/null | grep -c com.apple.quarantine || true)
echo "helper exit: $STATUS, app quarantine cleared: $CLEARED, quarantined files left inside: $LEFT" >> "$REPORT"
echo "spctl app after helper: $(spctl --assess --type execute -vv "$WORK/Applications/Elitesand Pro.app" 2>&1 | tr '\n' ' ')" >> "$REPORT"
# 沒有放進 /Applications 時要回報錯誤，不是假裝成功
ELITESAND_APP_PATH="$WORK/nowhere/Elitesand Pro.app" ELITESAND_NO_DIALOG=1 ELITESAND_NO_OPEN=1 bash "$HELPER" >/dev/null 2>&1
MISSING=$?
echo "helper exit when app is not in Applications: $MISSING" >> "$REPORT"
hdiutil detach "$MNT" -force >/dev/null
cat "$REPORT"
rm -rf "$WORK"
[ "$STATUS" = 0 ] && [ "$CLEARED" = yes ] && [ "$LEFT" = 0 ] && [ "$MISSING" = 1 ]
