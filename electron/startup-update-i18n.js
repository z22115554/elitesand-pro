'use strict';

const CATALOGS = Object.freeze({
  'zh-TW': Object.freeze({
    title: 'Elitesand Pro 更新',
    optionalMessage: '有可用更新：v{version}',
    optionalDetail: '更新只會在重新啟動程式時處理，不會中斷正在進行的直播。',
    updateNow: '現在更新',
    defer: '延後',
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
    optionalDetail: 'Updates are handled only when the app is restarted and never interrupt a live session.',
    updateNow: 'Update now',
    defer: 'Later',
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
    optionalDetail: '更新は再起動時にのみ処理され、配信中のセッションを中断しません。',
    updateNow: '今すぐ更新',
    defer: '後で',
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
    optionalDetail: '업데이트는 앱을 다시 시작할 때만 처리되며 진행 중인 라이브를 중단하지 않습니다.',
    updateNow: '지금 업데이트',
    defer: '나중에',
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
    optionalDetail: '更新只会在重新启动程序时处理，不会中断正在进行的直播。',
    updateNow: '立即更新',
    defer: '稍后',
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
