'use strict';

const CATALOGS = Object.freeze({
  'zh-TW': Object.freeze({
    title: '聲嶼 Elitesand Pro 更新',
    optionalMessage: '有可用更新：v{version}',
    optionalDetail: '更新會重新啟動程式。「稍後」於下次啟動提醒；「三天後提醒我」暫停提醒三天。',
    updateNow: '更新',
    defer: '稍後',
    remindThreeDays: '三天後提醒我',
    requiredMessage: '必須先更新 Elitesand Pro 才能繼續。',
    requiredDetail: '此項更新只會在開啟程式前處理，執行中的工作不會被遠端打斷。',
    requiredInstallerOpenFailed: '無法開啟 Installer。請確認網路連線後重試，或選擇結束。',
    openInstaller: '開啟 Installer',
    exit: '結束',
    restartMessage: '要重新啟動並處理這項更新嗎？',
    restartDetail: '程式會先安全結束本機服務，重新啟動時才會下載並安裝更新。',
    restart: '重新啟動並更新',
    cancel: '取消',
  }),
  en: Object.freeze({
    title: 'Elitesand Pro update',
    optionalMessage: 'An update is available: v{version}',
    optionalDetail: 'Updating restarts the app. Later reminds you on the next launch; Remind me in 3 days pauses reminders for three days.',
    updateNow: 'Update now',
    defer: 'Later',
    remindThreeDays: 'Remind me in 3 days',
    requiredMessage: 'Elitesand Pro must be updated before it can continue.',
    requiredDetail: 'This is handled only before startup and never interrupts a running session remotely.',
    requiredInstallerOpenFailed: 'The Installer could not be opened. Check your connection and try again, or exit.',
    openInstaller: 'Open Installer',
    exit: 'Exit',
    restartMessage: 'Restart and process this update now?',
    restartDetail: 'The local service will be stopped safely first; the update will download and install after restart.',
    restart: 'Restart and update',
    cancel: 'Cancel',
  }),
  ja: Object.freeze({
    title: 'Elitesand Pro の更新',
    optionalMessage: '更新があります: v{version}',
    optionalDetail: '更新するとアプリが再起動します。「後で」は次回起動時に、「3日後に通知」は3日後以降の起動時に通知します。',
    updateNow: '今すぐ更新',
    defer: '後で',
    remindThreeDays: '3日後に通知',
    requiredMessage: '続行するには Elitesand Pro の更新が必要です。',
    requiredDetail: 'この更新は起動前にのみ処理され、実行中のセッションを遠隔で中断しません。',
    requiredInstallerOpenFailed: 'Installer を開けませんでした。接続を確認して再試行するか、終了してください。',
    openInstaller: 'Installer を開く',
    exit: '終了',
    restartMessage: '再起動して、この更新を処理しますか？',
    restartDetail: 'ローカルサービスを安全に停止してから再起動し、更新をダウンロードしてインストールします。',
    restart: '再起動して更新',
    cancel: 'キャンセル',
  }),
  ko: Object.freeze({
    title: 'Elitesand Pro 업데이트',
    optionalMessage: '업데이트가 있습니다: v{version}',
    optionalDetail: '업데이트하면 앱이 다시 시작됩니다. 나중에는 다음 실행 시, 3일 후 알림은 3일이 지난 뒤 실행 시 다시 알려줍니다.',
    updateNow: '지금 업데이트',
    defer: '나중에',
    remindThreeDays: '3일 후 알림',
    requiredMessage: '계속하려면 Elitesand Pro를 업데이트해야 합니다.',
    requiredDetail: '이 업데이트는 시작 전에만 처리되며 실행 중인 세션을 원격으로 중단하지 않습니다.',
    requiredInstallerOpenFailed: 'Installer를 열 수 없습니다. 연결을 확인한 후 다시 시도하거나 종료하세요.',
    openInstaller: 'Installer 열기',
    exit: '종료',
    restartMessage: '다시 시작하고 이 업데이트를 처리할까요?',
    restartDetail: '먼저 로컬 서비스를 안전하게 종료한 후 다시 시작하여 업데이트를 다운로드하고 설치합니다.',
    restart: '다시 시작하고 업데이트',
    cancel: '취소',
  }),
  'zh-CN': Object.freeze({
    title: 'Elitesand Pro 更新',
    optionalMessage: '有可用更新：v{version}',
    optionalDetail: '更新会重新启动程序。「稍后」在下次启动时提醒；「三天后提醒我」暂停提醒三天。',
    updateNow: '立即更新',
    defer: '稍后',
    remindThreeDays: '三天后提醒我',
    requiredMessage: '必须先更新 Elitesand Pro 才能继续。',
    requiredDetail: '此更新只会在启动前处理，不会远程中断正在运行的工作。',
    requiredInstallerOpenFailed: '无法打开 Installer。请检查网络连接后重试，或选择退出。',
    openInstaller: '打开 Installer',
    exit: '退出',
    restartMessage: '要重新启动并处理这项更新吗？',
    restartDetail: '程序会先安全结束本地服务，重新启动时才会下载并安装更新。',
    restart: '重新启动并更新',
    cancel: '取消',
  }),
});

function resolveLocale(value) {
  const raw = String(value || '').replace('_', '-');
  if (CATALOGS[raw]) return raw;
  if (/^zh-(TW|HK|MO)/i.test(raw)) return 'zh-TW';
  if (/^zh/i.test(raw)) return 'zh-CN';
  if (/^ja/i.test(raw)) return 'ja';
  if (/^ko/i.test(raw)) return 'ko';
  return 'en';
}

function getCatalog(locale) {
  return CATALOGS[resolveLocale(locale)];
}

function format(text, values = {}) {
  return String(text).replace(/\{([a-zA-Z]+)\}/g, (_all, key) => String(values[key] ?? ''));
}

module.exports = { CATALOGS, format, getCatalog, resolveLocale };
