#!/bin/bash
# Elitesand Pro：第一次開啟的小工具 / First-launch helper
#
# 這是免費軟體，沒有付費給 Apple 做開發者簽章，所以 macOS 第一次會擋下它。
# 這個小工具只做一件事：把「/Applications/Elitesand Pro.app」這一個 app 的
# 「從網路下載」標記（com.apple.quarantine）拿掉，然後打開它。
# 不需要密碼、不用 sudo、不會動到其他任何檔案。
#
# Elitesand Pro is free software without a paid Apple developer signature, so macOS
# blocks it the first time. This helper only removes the "downloaded from the internet"
# flag from /Applications/Elitesand Pro.app and then opens it. No password, no sudo.

APP="${ELITESAND_APP_PATH:-/Applications/Elitesand Pro.app}"

say_dialog() {
  # $1 = 訊息, $2 = 圖示（note／caution／stop）
  if [ -n "$ELITESAND_NO_DIALOG" ]; then printf '%s\n' "$1"; return; fi
  /usr/bin/osascript - "$1" "$2" <<'OSA' >/dev/null 2>&1
on run argv
  set msg to item 1 of argv
  set kind to item 2 of argv
  if kind is "stop" then
    display dialog msg with title "Elitesand Pro" buttons {"OK"} default button "OK" with icon stop
  else if kind is "caution" then
    display dialog msg with title "Elitesand Pro" buttons {"OK"} default button "OK" with icon caution
  else
    display dialog msg with title "Elitesand Pro" buttons {"OK"} default button "OK" with icon note
  end if
end run
OSA
}

if [ ! -d "$APP" ]; then
  say_dialog "還沒找到 /Applications 裡的 Elitesand Pro。
請先把視窗裡的「Elitesand Pro」圖示拖到「Applications（應用程式）」資料夾，再雙擊這個小工具一次。

Elitesand Pro is not in /Applications yet. Drag the Elitesand Pro icon onto the Applications folder first, then run this helper again." caution
  exit 1
fi

ERRFILE=$(/usr/bin/mktemp -t elitesand-first-launch)
if ! /usr/bin/xattr -dr com.apple.quarantine "$APP" 2>"$ERRFILE"; then
  REASON=$(head -c 300 "$ERRFILE")
fi
rm -f "$ERRFILE"

if /usr/bin/xattr -p com.apple.quarantine "$APP" >/dev/null 2>&1; then
  say_dialog "沒辦法自動解除封鎖${REASON:+（$REASON）}。
請改用：打開「系統設定 → 隱私權與安全性」，往下捲到「安全性」，按 Elitesand Pro 旁邊的「仍要打開」，再輸入電腦密碼。

Could not unblock the app automatically. Instead, open System Settings → Privacy & Security, scroll to Security, click \"Open Anyway\" next to Elitesand Pro, and enter your password." stop
  exit 1
fi

if [ -z "$ELITESAND_NO_OPEN" ]; then
  /usr/bin/open "$APP" || {
    say_dialog "已解除封鎖，但沒能自動打開。請到「應用程式」資料夾雙擊 Elitesand Pro。

Unblocked, but it could not be opened automatically. Double-click Elitesand Pro in the Applications folder." caution
    exit 1
  }
fi
say_dialog "完成！Elitesand Pro 已解除封鎖並開啟。之後直接從「應用程式」或 Launchpad 開啟就好，不用再執行這個小工具。

Done! Elitesand Pro is unblocked and opening. From now on, just open it from Applications or Launchpad." note
exit 0
