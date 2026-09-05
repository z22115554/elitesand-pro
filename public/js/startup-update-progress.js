(function () {
  'use strict';

  // Rendered in the cold-start update progress window (electron/shell.js
  // openStartupUpdateProgressWindow). Served from the local Express server the
  // shell already started — a file:// / loadFile page renders blank under the
  // packaged app's hardened fuses, so this follows the same http://127.0.0.1
  // pattern the main panel and WebGPU worker windows use. The Electron main
  // process feeds it server getProgress() snapshots via the isolated preload.

  var params = new URLSearchParams(location.search);
  var locale = params.get('locale') || 'zh-TW';
  var version = params.get('version') || '';

  var CATALOG = {
    'zh-TW': {
      updating: '更新至 v{v}',
      downloading: '正在下載更新',
      verifying: '正在驗證更新',
      staging: '正在準備安裝',
      restarting: '即將重新啟動',
      failed: '更新失敗',
      reassure: '程式會自動下載並安裝，完成後重新啟動。請勿關閉電腦。',
      failedReassure: '這次更新沒有完成，程式仍會以目前版本啟動。',
      mib: '{a} / {b} MB',
    },
    'en': {
      updating: 'Updating to v{v}',
      downloading: 'Downloading update',
      verifying: 'Verifying update',
      staging: 'Preparing to install',
      restarting: 'Restarting shortly',
      failed: 'Update failed',
      reassure: 'The update downloads and installs automatically, then the app restarts. Do not shut down your computer.',
      failedReassure: 'This update did not finish; the app will still start on the current version.',
      mib: '{a} / {b} MB',
    },
    'ja': {
      updating: 'v{v} に更新中',
      downloading: '更新をダウンロード中',
      verifying: '更新を検証中',
      staging: 'インストールを準備中',
      restarting: 'まもなく再起動します',
      failed: '更新に失敗しました',
      reassure: '更新は自動でダウンロード・インストールされ、その後アプリが再起動します。PC の電源を切らないでください。',
      failedReassure: '今回の更新は完了しませんでした。アプリは現在のバージョンで起動します。',
      mib: '{a} / {b} MB',
    },
    'ko': {
      updating: 'v{v}(으)로 업데이트 중',
      downloading: '업데이트 다운로드 중',
      verifying: '업데이트 확인 중',
      staging: '설치 준비 중',
      restarting: '곧 다시 시작합니다',
      failed: '업데이트 실패',
      reassure: '업데이트는 자동으로 다운로드·설치되며 이후 앱이 다시 시작됩니다. 컴퓨터를 끄지 마세요.',
      failedReassure: '이번 업데이트는 완료되지 않았습니다. 앱은 현재 버전으로 시작됩니다.',
      mib: '{a} / {b} MB',
    },
    'zh-CN': {
      updating: '更新至 v{v}',
      downloading: '正在下载更新',
      verifying: '正在验证更新',
      staging: '正在准备安装',
      restarting: '即将重新启动',
      failed: '更新失败',
      reassure: '程序会自动下载并安装，完成后重新启动。请勿关闭电脑。',
      failedReassure: '本次更新未完成，程序仍会以当前版本启动。',
      mib: '{a} / {b} MB',
    },
  };
  var t = CATALOG[locale] || CATALOG['zh-TW'];

  var el = {
    wrap: document.getElementById('wrap'),
    stage: document.getElementById('stage'),
    bar: document.getElementById('bar'),
    fill: document.getElementById('fill'),
    detail: document.getElementById('detail'),
    pct: document.getElementById('pct'),
    reassure: document.getElementById('reassure'),
  };

  el.stage.textContent = version ? t.updating.replace('{v}', version) : t.downloading;
  el.reassure.textContent = t.reassure;

  function phaseLabel(phase) {
    switch (phase) {
      case 'checking':
      case 'downloading-hash':
      case 'downloading-zip':
      case 'downloading-artifact':
        return t.downloading;
      case 'verifying-hash':
      case 'inspecting-zip':
      case 'verifying-runtime':
        return t.verifying;
      case 'staging':
        return t.staging;
      case 'prepared':
      case 'ready':
        return t.restarting;
      case 'failed':
        return t.failed;
      default:
        return version ? t.updating.replace('{v}', version) : t.downloading;
    }
  }

  function render(p) {
    if (!p || typeof p !== 'object') return;
    var phase = String(p.phase || '');
    el.stage.textContent = phaseLabel(phase);

    if (phase === 'failed') {
      el.wrap.classList.add('failed');
      el.bar.classList.remove('indeterminate');
      el.fill.style.width = '100%';
      el.pct.textContent = '';
      el.detail.textContent = '';
      el.reassure.textContent = t.failedReassure;
      return;
    }

    var hasPercent = typeof p.percent === 'number' && isFinite(p.percent);
    if (hasPercent && phase.indexOf('downloading') === 0) {
      var pct = Math.max(0, Math.min(100, Math.round(p.percent)));
      el.bar.classList.remove('indeterminate');
      el.fill.style.width = pct + '%';
      el.pct.textContent = pct + '%';
      if (typeof p.loadedBytes === 'number' && typeof p.totalBytes === 'number' && p.totalBytes > 0) {
        var a = (p.loadedBytes / 1048576).toFixed(1);
        var b = (p.totalBytes / 1048576).toFixed(1);
        el.detail.textContent = t.mib.replace('{a}', a).replace('{b}', b);
      }
    } else if (phase === 'prepared' || phase === 'ready') {
      el.bar.classList.remove('indeterminate');
      el.fill.style.width = '100%';
      el.pct.textContent = '100%';
      el.detail.textContent = '';
    } else {
      // verifying / staging / unknown — no byte progress to show
      el.bar.classList.add('indeterminate');
      el.pct.textContent = '';
      el.detail.textContent = '';
    }
  }

  if (window.startupUpdateProgress && typeof window.startupUpdateProgress.onProgress === 'function') {
    window.startupUpdateProgress.onProgress(render);
  }
})();
