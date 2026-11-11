'use strict';

// 核心回歸測試（packaging-templates）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  path,
  os,
  test,
  testAsync,
  eq,
  ok,
} = require('./core-harness');
const AdmZip = require('adm-zip');

// ─── 首次啟動順序：EULA 同意閘門必須壓在所有歡迎類 UI 之上，且先於新手導覽 ───
test('EULA 閘門的層級必須高過新手導覽，導覽也要等同意完成才啟動', () => {
  // 實際踩過（1.0.0 出貨前）：閘門 z-index 12000、新手導覽 20000～20006，首次啟動時
  // 導覽整個蓋在條款上，連「開始互動導覽」按鈕都按得下去——使用者可以完全沒看到條款
  // 就開始用（命中測試確認過 elementFromPoint 落在導覽上）。
  const gateSource = fs.readFileSync(path.join(__dirname, '../public/js/eula-gate.js'), 'utf8');
  const tourCss = fs.readFileSync(path.join(__dirname, '../public/css/onboarding-tour.css'), 'utf8');
  const tourSource = fs.readFileSync(path.join(__dirname, '../public/js/onboarding-tour.js'), 'utf8');

  const gateZ = Number(/\.eula-gate \{[\s\S]*?z-index:\s*(\d+)/.exec(gateSource)?.[1]);
  ok(Number.isFinite(gateZ), '找不到 .eula-gate 的 z-index：');
  const tourZs = [...tourCss.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
  ok(tourZs.length > 0, '找不到新手導覽的 z-index（選擇器改名了？）：');
  const tourMax = Math.max(...tourZs);
  ok(gateZ > tourMax, `EULA 閘門必須壓過新手導覽（閘門 ${gateZ}、導覽最高 ${tourMax}）：`);

  // 光靠 z-index 不夠：導覽是全螢幕層，先出場即使被蓋住也會擋住條款的捲動與點擊，
  // 所以順序也要保證——導覽必須等 window.EulaGate 的訊號。
  ok(/window\.EulaGate\s*=/.test(gateSource), 'eula-gate.js 必須同步掛上 window.EulaGate 供後續腳本等待：');
  ok(tourSource.includes('root.EulaGate'), '新手導覽必須等 EULA 閘門解除才啟動：');
  ok(/whenCleared\.then\(init, init\)/.test(tourSource),
    '等待必須 resolve/reject 都啟動，閘門查詢失敗時導覽不可永遠不出現：');

  // 三條「不擋面板」的出口與同意成功都要解除訊號，否則導覽會被永久卡住
  const clearCalls = (gateSource.match(/gateApi\.clear\(\)/g) || []).length;
  ok(clearCalls >= 4, `閘門的每個放行出口都要解除訊號（目前 ${clearCalls} 處，需含 accept 成功）：`);

  // 載入順序：eula-gate.js 必須排在 onboarding-tour.js 前面，window.EulaGate 才讀得到
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  ok(indexHtml.indexOf('/js/eula-gate.js') < indexHtml.indexOf('/js/onboarding-tour.js'),
    'eula-gate.js 必須比 onboarding-tour.js 早載入：');
});

// ─── 對外檔案：README 連到的檔案都必須納入公開倉同步檢查 ───
test('README 連到的本機檔案，都必須在對外同步檢查的清單裡', () => {
  // 2026-09-08 發 1.0.0 時踩到兩次「兩個 repo 的對外檔案默默漂開」：公開倉 README
  // 完全沒有 1.0.0 的內容、公開倉 EULA 還停在 1.3.0（程式強制同意的是 1.8.0）。
  // 真正的比對要連網，放在 tools/check-public-files.js（PACKAGING §6 的發版前 gate）；
  // 這條是它防不到的那半：有人新增對外檔案並從 README 連過去，卻忘了加進清單。
  const { FILES } = require('../tools/check-public-files');
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

  // 取出所有 markdown 連結目標，不用正則（樣板/heredoc 對反斜線不友善，實際踩過）
  const targets = new Set();
  let cursor = 0;
  for (;;) {
    const open = readme.indexOf('](', cursor);
    if (open < 0) break;
    const close = readme.indexOf(')', open);
    if (close < 0) break;
    targets.add(readme.slice(open + 2, close).trim());
    cursor = close + 1;
  }
  ok(targets.size > 0, 'README 應該有連結可供檢查（解析壞了？）：');

  // 只看「連到 repo 內某個檔案」的相對連結：錨點、外部網址、上層相對路徑都不算
  const localFiles = [...targets].filter((t) => (
    t && !t.startsWith('#') && !t.includes('://') && !t.startsWith('../')
      && fs.existsSync(path.join(__dirname, '..', t))
  ));
  ok(localFiles.length > 0, '應至少有一個指向 repo 內檔案的連結：');

  const missing = localFiles.filter((f) => !FILES.includes(f));
  eq(missing.length, 0,
    `這些檔案 README 連得到、使用者會點，但不在對外同步清單裡（公開倉會漂掉）：${missing.join('、')}`);
  ok(FILES.includes('README.md'), 'README.md 自己也必須在同步清單裡：');
});

test('announcement.json 由私有倉同步到公開倉，不可再由兩邊各自維護', () => {
  const publishSource = fs.readFileSync(path.join(__dirname, '../tools/publish-oss.js'), 'utf8');
  const allowBlock = publishSource.slice(
    publishSource.indexOf('const ALLOW_FILES = ['),
    publishSource.indexOf('];', publishSource.indexOf('const ALLOW_FILES = [')) + 2,
  );
  const preserveBlock = publishSource.slice(
    publishSource.indexOf('const PRESERVE_IN_TARGET = ['),
    publishSource.indexOf('];', publishSource.indexOf('const PRESERVE_IN_TARGET = [')) + 2,
  );
  ok(allowBlock.includes("'announcement.json'"), '公告必須列入公開同步白名單：');
  ok(!preserveBlock.includes("'announcement.json'"), '公告不可再保留公開倉自己的版本：');
});

// ─── 打包契約：server 端 require 的 public/js 同構模組不可被 bundler 刪掉 ───
test('server 端 require 的 public/js 檔案，必須全部在打包白名單裡', () => {
  // 實際踩過（1.0.0 出貨前）：新增的 server/utils/obs-locale.js 去 require
  // public/js/i18n.js，開發環境一切正常、npm test 全綠，但打包時面板的 <script>
  // 會被合併進各頁 bundle、原始檔隨即刪除，只有這份白名單裡的檔案會留下——
  // 裝起來的版本一啟動就 Cannot find module，整個 server 起不來。
  // 那次是 build-portable 的 smoke 才攔到（跑一輪好幾分鐘），這裡用秒級的掃描守住。
  const { SERVER_REQUIRED_PUBLIC_JS } = require('../tools/build-production-bundles');
  const serverRoot = path.join(__dirname, '..', 'server');
  const walkJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walkJs(full);
    return e.isFile() && e.name.endsWith('.js') ? [full] : [];
  });
  // 只看實際程式碼：註解裡本來就會提到這些 require（例如 obs-locale.js 的檔頭就在
  // 說明「為什麼不 require 面板的翻譯表」），掃到註解會變成假警報。
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const required = new Map();
  walkJs(serverRoot).forEach((file) => {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/require\(\s*['"](?:\.\.\/)+public\/js\/([\w./-]+)['"]\s*\)/g)) {
      const name = m[1].endsWith('.js') ? m[1] : `${m[1]}.js`;
      if (!required.has(name)) required.set(name, path.relative(path.join(__dirname, '..'), file));
    }
  });
  ok(required.size > 0, '掃描必須真的找得到同構模組（掃不到＝正規表示式壞了）：');
  const missing = [...required].filter(([name]) => !SERVER_REQUIRED_PUBLIC_JS.includes(name));
  eq(missing.length, 0,
    `這些 public/js 檔案 server 端會 require()，但不在 SERVER_REQUIRED_PUBLIC_JS，打包後會被刪掉：`
    + missing.map(([name, from]) => `
    ${name}（被 ${from} require）`).join(''));
  // 反向：白名單裡列了但其實沒人 require 的，留著只會讓安裝目錄多一份可讀原始碼
  const stale = SERVER_REQUIRED_PUBLIC_JS.filter((name) => !required.has(name));
  eq(stale.length, 0, `白名單有多餘項目（server 端已經沒有 require 了）：${stale.join('、')}`);
});

// ─── 閉源化批次 B-2：SoundTouch LGPL 不得混進專有 production bundle ───
{
  const soundtouchGuard = require('../tools/build-production-bundles');
  const guardTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-soundtouch-guard-'));

  test('SoundTouch 守衛：乾淨的 bundle 內容不會被誤判', () => {
    const cleanFile = path.join(guardTmpDir, 'clean.bundle.js');
    fs.writeFileSync(cleanFile, 'function playTrack(a,b){return a+b}\nconst x=1;');
    const hits = soundtouchGuard.scanForSoundTouchFingerprint([cleanFile]);
    eq(hits.length, 0, '乾淨檔案不應命中任何 SoundTouch 特徵字串：');
  });

  test('SoundTouch 守衛：負向案例——故意混入 LGPL 特徵字串必須被抓到', () => {
    const contaminatedFile = path.join(guardTmpDir, 'contaminated.bundle.js');
    // 刻意塞進 SoundTouch 演算法核心才有的識別字串，模擬「不小心把 vendor/soundtouch*.js
    // 也讀進 bundle」的意外情況——這個測試必須失敗（也就是守衛必須抓到它），
    // 才能證明守衛不是形式主義的空氣測試。
    fs.writeFileSync(
      contaminatedFile,
      'class FifoSampleBuffer{putSamples(a,b,c){this.sourcePosition=b}}'
    );
    const hits = soundtouchGuard.scanForSoundTouchFingerprint([contaminatedFile]);
    ok(hits.length > 0, '混入 SoundTouch 特徵字串的檔案必須被守衛偵測到：');
    ok(hits.some((h) => h.file === contaminatedFile), '偵測結果必須指出確切的受污染檔案：');
  });

  test('SoundTouch 守衛：特徵字串清單涵蓋 soundtouch-worklet.js 實際使用的識別字', () => {
    const worklet = fs.readFileSync(
      path.join(__dirname, '../public/vendor/soundtouch-worklet.js'),
      'utf8'
    );
    for (const fingerprint of soundtouchGuard.SOUNDTOUCH_FINGERPRINTS) {
      ok(worklet.includes(fingerprint), `特徵字串「${fingerprint}」必須真的出現在 soundtouch-worklet.js，守衛才有意義：`);
    }
  });

  fs.rmSync(guardTmpDir, { recursive: true, force: true });
}

// ─── 閉源化批次 C-1：模板加密遞送 ───
{
  const templateDelivery = require('../server/services/template-delivery');

  test('模板遞送：開發模式（無 template-store）直接讀原始碼', () => {
    ok(!templateDelivery.isPacked(), '測試環境不應存在 server/template-store/：');
    const source = templateDelivery.getTemplateSource('aura');
    ok(typeof source === 'string' && source.length > 0, 'aura 模板應能讀到原始碼：');
    ok(source.includes("id: 'aura'") || source.includes('id:"aura"') || source.includes("id:'aura'"), '讀到的內容應該是 aura 模板本身：');
  });

  test('模板遞送：不在白名單的 id 回傳 null（server/index.js 據此回 404）', () => {
    eq(templateDelivery.getTemplateSource('not-a-real-template'), null, '未知 id 不應回傳任何內容：');
    eq(templateDelivery.getTemplateSource('../../etc/passwd'), null, '路徑穿越字串不在白名單內，必須被拒絕：');
  });

  test('模板遞送：六個模板 id 都在白名單內', () => {
    for (const id of ['pulse', 'facet', 'drift', 'aura', 'ktv', 'columnflow']) {
      ok(templateDelivery.TEMPLATE_IDS.has(id), `${id} 應在 TEMPLATE_IDS 白名單：`);
    }
    eq(templateDelivery.TEMPLATE_IDS.size, 6, '白名單應剛好六個（classic 是免費內建，不走這條）：');
  });

  test('模板遞送：指紋函式對相同內容回傳相同雜湊，用於 OBS 快取指紋', () => {
    const fp1 = templateDelivery.getTemplateFingerprint('ktv');
    const fp2 = templateDelivery.getTemplateFingerprint('ktv');
    eq(fp1, fp2, '同一份內容的指紋必須穩定：');
    ok(typeof fp1 === 'string' && fp1.length === 16, '指紋應為 16 字元十六進位字串：');
  });

  test('模板遞送：開發模式絕不快取——存檔改動立刻反映（曾經真的卡住過的 bug）', () => {
    // 開發模式讀的是開發者正在編輯的原始檔案，不像 production 的加密 blob 在整個
    // server 行程生命週期內都不會變。這裡曾經因為兩種模式共用同一份 sourceCache，
    // 導致 dev server 一起來、模板第一次被請求後，不管檔案怎麼改都讀到舊內容——
    // 「改完存檔、Ctrl+F5 就看得到」這句話當時其實是假的。
    const filePath = path.join(__dirname, '../public/js/lyric-template-pulse.js');
    const original = fs.readFileSync(filePath, 'utf8');
    try {
      const first = templateDelivery.getTemplateSource('pulse');
      eq(first, original, '第一次讀取應該等於目前檔案內容：');

      const marker = `\n// __cache_invalidation_probe_${Date.now()}__\n`;
      fs.writeFileSync(filePath, original + marker);
      const second = templateDelivery.getTemplateSource('pulse');
      ok(second.includes(marker), '開發模式下，檔案存檔後下一次讀取必須立刻反映新內容，不可回傳快取的舊版本：');
    } finally {
      fs.writeFileSync(filePath, original);
    }
  });
}

// ─── 閉源化批次 C-1：加密封裝往返正確性（build-production-bundles.js 的 packTemplates）───
{
  const { packTemplates, TEMPLATE_IDS: PACK_TEMPLATE_IDS } = require('../tools/build-production-bundles');
  const esbuild = require('esbuild');

  test('模板封裝：加密後解密內容與原始碼 minify 結果逐位元組一致', () => {
    const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-template-pack-'));
    try {
      const publicJsDir = path.join(stageDir, 'public', 'js');
      const serverServicesDir = path.join(stageDir, 'server', 'services');
      fs.mkdirSync(publicJsDir, { recursive: true });
      fs.mkdirSync(serverServicesDir, { recursive: true });

      const originals = {};
      for (const id of PACK_TEMPLATE_IDS) {
        const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', `lyric-template-${id}.js`), 'utf8');
        originals[id] = src;
        fs.writeFileSync(path.join(publicJsDir, `lyric-template-${id}.js`), src);
      }

      packTemplates(stageDir);

      ok(!fs.existsSync(path.join(publicJsDir, 'lyric-template-aura.js')), '封裝後原始檔必須刪除：');
      const keyModule = require(path.join(serverServicesDir, 'template-key.generated.js'));
      const key = Buffer.from(keyModule.key, 'hex');
      eq(key.length, 32, 'AES-256-GCM 金鑰長度必須是 32 bytes：');

      const crypto = require('crypto');
      for (const id of PACK_TEMPLATE_IDS) {
        const blob = fs.readFileSync(path.join(stageDir, 'server', 'template-store', `${id}.eltpl`));
        const iv = blob.subarray(0, 12);
        const authTag = blob.subarray(12, 28);
        const ciphertext = blob.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        const expected = esbuild.transformSync(originals[id], { loader: 'js', minify: true, legalComments: 'none' }).code;
        eq(decrypted, expected, `${id} 解密內容應與原始碼 minify 後逐位元組一致：`);
      }
    } finally {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  });

  test('模板封裝：竄改密文的任一位元組必須讓解密失敗（GCM 完整性驗證生效）', () => {
    const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-template-pack-tamper-'));
    try {
      const publicJsDir = path.join(stageDir, 'public', 'js');
      fs.mkdirSync(publicJsDir, { recursive: true });
      fs.mkdirSync(path.join(stageDir, 'server', 'services'), { recursive: true });
      for (const id of PACK_TEMPLATE_IDS) {
        const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', `lyric-template-${id}.js`), 'utf8');
        fs.writeFileSync(path.join(publicJsDir, `lyric-template-${id}.js`), src);
      }
      packTemplates(stageDir);

      const crypto = require('crypto');
      const keyModule = require(path.join(stageDir, 'server', 'services', 'template-key.generated.js'));
      const key = Buffer.from(keyModule.key, 'hex');
      const blobPath = path.join(stageDir, 'server', 'template-store', 'pulse.eltpl');
      const blob = fs.readFileSync(blobPath);
      blob[blob.length - 1] ^= 0xff; // 竄改密文最後一個 byte

      const iv = blob.subarray(0, 12);
      const authTag = blob.subarray(12, 28);
      const ciphertext = blob.subarray(28);
      let threw = false;
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      } catch (_) {
        threw = true;
      }
      ok(threw, '竄改過的密文必須讓 GCM 驗證失敗，而不是悄悄解出錯誤內容：');
    } finally {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  });
}

// ─── 閉源化批次 C-2：付費模板簽章驗證與安裝閘門 ───
{
  const crypto = require('crypto');
  const pkgVerify = require('../server/services/template-package-verify');
  const pkgInstall = require('../server/services/template-package-install');
  const { BUILTIN_TEMPLATE_IDS } = require('../server/services/template-ids');

  // 每個測試用自己的一次性測試金鑰簽章，絕不依賴 .local/ 裡的真正私鑰
  // （那份檔案只存在開發者本機，clone 下來的環境不會有，測試不能依賴它存在）。
  function makeTestKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
    return { publicKeyHex, privateKey };
  }

  function buildSignedPackage(dir, { privateKey, templateId = 'test-premium', version = '1.0.0', code = 'console.log("premium template")', minEngineVersion, maxEngineVersion }) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'template.js'), code);
    const assetHash = crypto.createHash('sha256').update(code).digest('hex');
    const manifest = {
      schemaVersion: 1,
      templateId,
      version,
      displayName: { 'zh-TW': '測試付費模板', en: 'Test Premium Template' },
      assets: [{ path: 'template.js', sha256: assetHash }],
    };
    if (minEngineVersion) manifest.minEngineVersion = minEngineVersion;
    if (maxEngineVersion) manifest.maxEngineVersion = maxEngineVersion;
    const message = Buffer.from(pkgVerify.canonicalize(manifest), 'utf8');
    manifest.signature = crypto.sign(null, message, privateKey).toString('hex');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  test('模板包驗證：合法簽章＋正確雜湊通過驗證', () => {
    const { publicKeyHex, privateKey } = makeTestKeypair();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-valid-'));
    try {
      buildSignedPackage(dir, { privateKey });
      const result = pkgVerify.verifyTemplatePackageDir(dir, { publicKeyHex });
      ok(result.ok, `合法模板包應該通過驗證：${result.reason || ''}`);
      eq(result.manifest.templateId, 'test-premium', 'manifest 應正確解析：');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板包驗證：竄改 manifest 任一欄位會讓簽章失效', () => {
    const { publicKeyHex, privateKey } = makeTestKeypair();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-tamper-manifest-'));
    try {
      buildSignedPackage(dir, { privateKey, version: '1.0.0' });
      const manifestPath = path.join(dir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.version = '9.9.9'; // 竄改一個欄位，簽章沒有跟著改
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      const result = pkgVerify.verifyTemplatePackageDir(dir, { publicKeyHex });
      ok(!result.ok, '竄改過 manifest 但簽章沒變的包必須驗證失敗：');
      ok(/簽章/.test(result.reason), '失敗原因應該指出是簽章問題：' + result.reason);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板包驗證：竄改資產內容（但沒改 manifest 雜湊）會被雜湊比對抓到', () => {
    const { publicKeyHex, privateKey } = makeTestKeypair();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-tamper-asset-'));
    try {
      buildSignedPackage(dir, { privateKey });
      fs.writeFileSync(path.join(dir, 'template.js'), 'console.log("evil injected code")');
      const result = pkgVerify.verifyTemplatePackageDir(dir, { publicKeyHex });
      ok(!result.ok, '資產內容被換掉但雜湊沒對應更新，必須驗證失敗：');
      ok(/雜湊/.test(result.reason), '失敗原因應該指出是雜湊問題：' + result.reason);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板包驗證：用不對的公鑰驗證會失敗（不是官方簽發）', () => {
    const { privateKey } = makeTestKeypair();
    const { publicKeyHex: wrongPublicKeyHex } = makeTestKeypair(); // 另一把跟簽章不成對的公鑰
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-wrong-key-'));
    try {
      buildSignedPackage(dir, { privateKey });
      const result = pkgVerify.verifyTemplatePackageDir(dir, { publicKeyHex: wrongPublicKeyHex });
      ok(!result.ok, '用不成對的公鑰驗證必須失敗：');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板包驗證：不相容的引擎版本會被拒絕', () => {
    const { publicKeyHex, privateKey } = makeTestKeypair();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-engine-range-'));
    try {
      buildSignedPackage(dir, { privateKey, minEngineVersion: '99.0.0' });
      const result = pkgVerify.verifyTemplatePackageDir(dir, { publicKeyHex, engineVersion: '0.9.9.1' });
      ok(!result.ok, '需要 99.0.0 以上但目前引擎是 0.9.9.1，必須拒絕：');
      ok(/引擎版本/.test(result.reason), '失敗原因應該指出引擎版本不相容：' + result.reason);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板包驗證：路徑穿越的 asset path 必須被拒絕', () => {
    const { publicKeyHex, privateKey } = makeTestKeypair();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-path-traversal-'));
    try {
      const code = 'console.log(1)';
      fs.writeFileSync(path.join(dir, 'template.js'), code);
      const manifest = {
        schemaVersion: 1,
        templateId: 'evil-template',
        version: '1.0.0',
        assets: [{ path: '../../../etc/passwd', sha256: crypto.createHash('sha256').update(code).digest('hex') }],
      };
      const message = Buffer.from(pkgVerify.canonicalize(manifest), 'utf8');
      manifest.signature = crypto.sign(null, message, privateKey).toString('hex');
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
      const result = pkgVerify.verifyTemplatePackageDir(dir, { publicKeyHex });
      ok(!result.ok, '含路徑分隔符的 asset path 必須在格式檢查就被拒絕：');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板安裝：templateId 跟內建模板衝突必須被拒絕（就算簽章驗證已經通過）', () => {
    ok(BUILTIN_TEMPLATE_IDS.has('aura'), '前提：aura 應該在內建清單裡：');
    // 用 installVerifiedTemplate 跳過簽章驗證階段，直接測「已驗證通過的 manifest」
    // 還會不會被 ID 衝突擋下——這是安裝流程自己的防線，不該依賴簽章驗證失敗才擋住。
    const fakeManifest = {
      schemaVersion: 1,
      templateId: 'aura',
      version: '1.0.0',
      assets: [{ path: 'template.js', sha256: 'a'.repeat(64) }],
    };
    const result = pkgInstall.installVerifiedTemplate(fakeManifest, { 'template.js': Buffer.from('x') });
    ok(!result.ok, '即使 manifest 已通過驗證，templateId 撞到內建模板也必須被安裝流程拒絕：');
    ok(!pkgInstall.isInstalled('aura'), '不應該把假冒 aura 的模板寫進已安裝清單：');
  });

  test('模板安裝：production 安裝路徑（template-package-install.js）絕不傳測試金鑰參數', () => {
    // 白箱檢查：production 可達的程式碼路徑一旦意外傳了 publicKeyHex，
    // 就等於讓任何人用自己簽的假金鑰包冒充官方模板——這條防線必須用原始碼掃描鎖死。
    const installSource = fs.readFileSync(path.join(__dirname, '../server/services/template-package-install.js'), 'utf8');
    ok(!/publicKeyHex/.test(installSource), 'template-package-install.js 不得出現 publicKeyHex（絕不可覆蓋成測試金鑰）：');
  });

  test('模板安裝：完整流程——驗證失敗的包（用假金鑰）不會被裝進本機儲存', () => {
    const { privateKey } = makeTestKeypair(); // 跟 template-public-key.js 內建的真公鑰不成對
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pkg-install-reject-'));
    try {
      buildSignedPackage(dir, { privateKey, templateId: 'fake-premium-template' });
      const result = pkgInstall.installTemplatePackage(dir);
      ok(!result.ok, '用非官方金鑰簽的包，走真正的安裝流程（用真公鑰驗證）必須被拒絕：');
      ok(!pkgInstall.isInstalled('fake-premium-template'), '驗證失敗的模板不應該被寫進已安裝清單：');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('模板安裝／移除：isInstalled 與 removeInstalledTemplate 的基本狀態轉移', () => {
    // 不需要真正簽章通過就能測狀態機本身：直接確認初始狀態，以及移除不存在項目的行為。
    ok(!pkgInstall.isInstalled('never-installed-xyz'), '從未安裝的 id 應回傳 false：');
    eq(pkgInstall.removeInstalledTemplate('never-installed-xyz'), false, '移除不存在的項目應回傳 false，不拋錯：');
  });

  test('模板簽章私鑰絕不可出現在任何會被打包的原始碼裡（server/、public/）', () => {
    // 私鑰只該存在 .local/template-signing/（gitignore 排除、不進任何 build）。
    // 這裡掃 server/ 與 public/ 的所有 .js/.json，防的是「手滑把私鑰複製進某個
    // 會被 minify 進 production bundle 的檔案」這種事故。
    const dirsToScan = ['server', 'public'];
    const offenders = [];
    function scanDir(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
        } else if (/\.(js|json)$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf8');
          if (content.includes('BEGIN PRIVATE KEY') || content.includes('BEGIN EC PRIVATE KEY') || content.includes('BEGIN RSA PRIVATE KEY')) {
            offenders.push(full);
          }
        }
      }
    }
    scanDir(path.join(__dirname, '..', 'server'));
    scanDir(path.join(__dirname, '..', 'public'));
    eq(offenders.length, 0, `不得含私鑰字樣的檔案卻找到: ${offenders.join(', ')}`);
  });
}

// ─── 閉源化批次 D-1：FFmpeg 按需下載 ───
{
  const AdmZip = require('adm-zip');
  const ffmpegProvider = require('../server/services/ffmpeg-provider');
  const loadConfig = require('../server/utils/load-config');

  test('FFmpeg 供應：能在合成的 zip 內找到 bin/ffmpeg.exe 與 bin/ffprobe.exe（gyan.dev 慣例結構）', () => {
    const zip = new AdmZip();
    zip.addFile('ffmpeg-9.0-essentials_build/bin/ffmpeg.exe', Buffer.from('fake ffmpeg binary'));
    zip.addFile('ffmpeg-9.0-essentials_build/bin/ffprobe.exe', Buffer.from('fake ffprobe binary'));
    zip.addFile('ffmpeg-9.0-essentials_build/bin/ffplay.exe', Buffer.from('fake ffplay binary'));
    zip.addFile('ffmpeg-9.0-essentials_build/doc/ffmpeg.html', Buffer.from('docs'));
    zip.addFile('ffmpeg-9.0-essentials_build/LICENSE.txt', Buffer.from('license'));
    const { ffmpegEntry, ffprobeEntry } = ffmpegProvider.findFfmpegEntries(zip.getEntries());
    ok(ffmpegEntry, '應該找到 bin/ffmpeg.exe：');
    ok(ffprobeEntry, '應該找到 bin/ffprobe.exe：');
    eq(ffmpegEntry.getData().toString(), 'fake ffmpeg binary', '取出的內容應該是正確的那個 entry：');
  });

  test('FFmpeg 供應：版本資料夾名稱改變也找得到（不寫死版本號）', () => {
    const zip = new AdmZip();
    zip.addFile('ffmpeg-2099-git-deadbeef-essentials_build/bin/ffmpeg.exe', Buffer.from('x'));
    zip.addFile('ffmpeg-2099-git-deadbeef-essentials_build/bin/ffprobe.exe', Buffer.from('x'));
    const { ffmpegEntry, ffprobeEntry } = ffmpegProvider.findFfmpegEntries(zip.getEntries());
    ok(ffmpegEntry && ffprobeEntry, '不同版本號的資料夾名稱不該影響尋找：');
  });

  test('FFmpeg 供應：不會誤判非 bin/ 目錄下同名檔案', () => {
    const zip = new AdmZip();
    zip.addFile('ffmpeg-9.0-essentials_build/doc/ffmpeg.exe', Buffer.from('wrong location'));
    zip.addFile('ffmpeg-9.0-essentials_build/presets/ffprobe.exe', Buffer.from('wrong location'));
    const { ffmpegEntry, ffprobeEntry } = ffmpegProvider.findFfmpegEntries(zip.getEntries());
    ok(!ffmpegEntry, '不在 bin/ 底下的同名檔案不該被當成正牌 ffmpeg.exe：');
    ok(!ffprobeEntry, '不在 bin/ 底下的同名檔案不該被當成正牌 ffprobe.exe：');
  });

  test('FFmpeg 供應：缺少其中一個執行檔時視為找不到（extract 那邊會整體拒絕）', () => {
    const zip = new AdmZip();
    zip.addFile('pkg/bin/ffmpeg.exe', Buffer.from('x'));
    const { ffmpegEntry, ffprobeEntry } = ffmpegProvider.findFfmpegEntries(zip.getEntries());
    ok(ffmpegEntry, '前提：ffmpeg.exe 應該找得到：');
    ok(!ffprobeEntry, 'ffprobe.exe 沒放進去就應該找不到，不能只有一半就當作可用：');
  });

  test('FFmpeg 供應：resolveFfmpegPaths 優先採用 config.js 指定的路徑', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-ffmpeg-config-'));
    const fakeFfmpeg = path.join(tmpDir, 'ffmpeg.exe');
    fs.writeFileSync(fakeFfmpeg, 'fake');
    const original = loadConfig.ffmpegPath;
    try {
      loadConfig.ffmpegPath = fakeFfmpeg;
      const resolved = ffmpegProvider.resolveFfmpegPaths();
      eq(resolved.source, 'config', 'config.js 指定路徑應該是最高優先：');
      eq(resolved.ffmpeg, fakeFfmpeg, '應該回傳 config 指定的確切路徑：');
    } finally {
      loadConfig.ffmpegPath = original;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('FFmpeg 供應：config.js 指定的路徑若檔案不存在，不該被誤採用（fall through 到下一優先序）', () => {
    const original = loadConfig.ffmpegPath;
    try {
      loadConfig.ffmpegPath = 'C:/this/path/definitely/does/not/exist/ffmpeg.exe';
      const resolved = ffmpegProvider.resolveFfmpegPaths();
      ok(!resolved || resolved.source !== 'config', '不存在的路徑不該被當成有效設定：');
    } finally {
      loadConfig.ffmpegPath = original;
    }
  });

  test('FFmpeg 供應：commandExistsOnPath 對已知存在／不存在的指令行為正確', () => {
    ok(ffmpegProvider.commandExistsOnPath('node'), 'node 本身一定在 PATH 上（測試就是這樣跑起來的）：');
    ok(!ffmpegProvider.commandExistsOnPath('this-command-definitely-does-not-exist-xyz123'), '不存在的指令應回傳 false：');
  });

  test('FFmpeg 供應：withFfmpegOnPath 把我們這份 ffmpeg 的目錄補進 PATH（沿用原本的鍵，不新增重複鍵）', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-ffmpeg-path-'));
    const fakeFfmpeg = path.join(tmpDir, 'ffmpeg.exe');
    fs.writeFileSync(fakeFfmpeg, 'fake');
    const original = loadConfig.ffmpegPath;
    try {
      loadConfig.ffmpegPath = fakeFfmpeg;
      const env = ffmpegProvider.withFfmpegOnPath({ Path: 'C:/existing-tools', PYTHONUTF8: '1' });
      const pathKeys = Object.keys(env).filter((k) => k.toUpperCase() === 'PATH');
      eq(pathKeys.length, 1, 'Windows env 名稱大小寫不敏感，不可同時出現 Path 與 PATH：');
      eq(pathKeys[0], 'Path', '要沿用呼叫端原本的鍵名：');
      ok(env.Path.startsWith(tmpDir), 'ffmpeg 目錄要排在最前面，優先於系統上的其他 ffmpeg：');
      ok(env.Path.includes('C:/existing-tools'), '原本的 PATH 內容不可被蓋掉：');
      eq(env.PYTHONUTF8, '1', '其他環境變數要原樣保留（鐵則 #3 的 UTF-8 設定就在裡面）：');

      const twice = ffmpegProvider.withFfmpegOnPath(env);
      eq(twice.Path, env.Path, '重複呼叫不可一直往 PATH 前面疊同一個目錄：');
    } finally {
      loadConfig.ffmpegPath = original;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('AI 分離：spawn python 的 env 一律要經過 withFfmpegOnPath（audio-separator 只認 PATH 上的 ffmpeg）', () => {
    const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'ai-runtime-provider.js'), 'utf8');
    const separationSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'ai-separation.js'), 'utf8');
    ok(
      /env:\s*withFfmpegOnPath\(/.test(runtimeSource),
      'runtime provider 的 python 步驟（含 --download_model_only）少了這層就會 WinError 2：',
    );
    ok(
      /env:\s*supervisorEnv\(\)/.test(separationSource) && /function supervisorEnv\(\)[\s\S]{0,200}withFfmpegOnPath\(/.test(separationSource),
      'supervisor 的 env 必須在 start() 當下計算：ffmpeg 可能是同一次執行中途才下載的：',
    );
    ok(
      !/const SUPERVISOR_ENV\s*=/.test(separationSource),
      '不可回退成模組載入時算死的 env 常數：',
    );
  });

  test('WebGPU 模型：下載網址必須釘死上游 commit，不可跟著 main 走', () => {
    const webgpuRuntimeProvider = require('../server/services/webgpu-runtime-provider');
    ok(/^[0-9a-f]{40}$/.test(webgpuRuntimeProvider.MODEL_REVISION), 'MODEL_REVISION 要是完整的 40 位 commit SHA：');
    for (const file of webgpuRuntimeProvider.FILES) {
      ok(
        file.url.includes(`/resolve/${webgpuRuntimeProvider.MODEL_REVISION}/`),
        `${file.name} 的網址要指向釘死的 revision（2026-08-29 上游換 core 改檔名，main 上的舊檔直接 404）：`,
      );
      ok(!/\/resolve\/(main|master)\//.test(file.url), `${file.name} 不可用浮動分支：`);
      ok(/^[0-9a-f]{64}$/.test(file.sha256) && file.size > 0, `${file.name} 要有釘死的 SHA-256 與大小：`);
    }
    const workerSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'webgpu-separation-worker.mjs'), 'utf8');
    ok(
      /const FRAMES = 1101;/.test(workerSource),
      'worker 的 FRAMES 與模型 window 綁在一起（輸入張量 [1, 2050, 1101, 2]）：換上游模型必須連 worker 一起改，不能只換網址：',
    );
  });

  test('AI 分離：sidecar 腳本路徑優先吃 ELITESAND_AI_SCRIPT_DIR（打包版 python 讀不到 app.asar）', () => {
    const { resolveAiScriptDir } = require('../server/services/ai-separation');
    const original = process.env.ELITESAND_AI_SCRIPT_DIR;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-ai-scripts-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'supervisor.py'), '# fake');
      process.env.ELITESAND_AI_SCRIPT_DIR = tmpDir;
      eq(resolveAiScriptDir(), tmpDir, '打包版要用 shell 傳進來的 resources/tools/ai：');

      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-ai-empty-'));
      process.env.ELITESAND_AI_SCRIPT_DIR = emptyDir;
      ok(
        resolveAiScriptDir() !== emptyDir && fs.existsSync(path.join(resolveAiScriptDir(), 'supervisor.py')),
        '指到沒有 supervisor.py 的目錄時要退回專案自己的 ai/，不可回傳空目錄：',
      );
      fs.rmSync(emptyDir, { recursive: true, force: true });

      delete process.env.ELITESAND_AI_SCRIPT_DIR;
      eq(resolveAiScriptDir(), path.join(path.resolve(__dirname, '..'), 'ai'), '開發環境走 repo 的 ai/：');
    } finally {
      if (original === undefined) delete process.env.ELITESAND_AI_SCRIPT_DIR;
      else process.env.ELITESAND_AI_SCRIPT_DIR = original;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('打包：ai/ 必須以真實檔案進 installer，且不可只留在 app.asar 裡', () => {
    const portable = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-portable.ps1'), 'utf8');
    const installer = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-installer.ps1'), 'utf8');
    const verify = fs.readFileSync(path.join(__dirname, '..', 'tools', 'verify-electron-package.js'), 'utf8');
    const haqumeiBuild = fs.readFileSync(path.join(__dirname, '..', 'tools', 'prepare-haqumei-runtime.ps1'), 'utf8');
    const builderFiles = require('../package.json').build.files;

    ok(/\$DirsToCopy = @\("server", "public", "ai"\)/.test(portable), 'portable staging 要複製 ai/（2026-08-30 打包版就是漏了它）：');
    ok(/Copy-Item.*AiSidecarSource.*tools.ai/.test(installer), 'installer 要把 sidecar 複製到 resources/tools/ai：');
    ok(/tools.ai.supervisor\.py/.test(installer), 'installer 產物檢查要把 supervisor.py 列為必要檔案：');
    ok(builderFiles.includes('!ai/**'), 'ai/ 不可進 app.asar，避免出現 python 讀不到的假路徑：');
    ok(/resources\/tools\/ai\/\$\{script\}/.test(verify) || /tools', 'ai', script/.test(verify), '打包驗證要確認 sidecar 真的在 resources/tools/ai：');
    ok(/file\.endsWith\('\.py'\)/.test(verify), '打包驗證要擋住 .py 又被塞回 app.asar：');
    ok(/prepare-haqumei-runtime\.ps1/.test(portable), 'portable staging 必須建立隨附的 Haqumei runtime：');
    ok(/runtime\\g2p/.test(portable) && /ELITESAND_G2P_PYTHON/.test(portable), 'portable launcher 必須指向隨附的 Haqumei Python：');
    ok(/runtime\\g2p/.test(installer) && /tools\\g2p/.test(installer), 'installer 必須把 Haqumei runtime 搬到 resources/tools/g2p：');
    ok(/haqumei_sidecar\.py/.test(installer) && /haqumei_sidecar\.py/.test(verify), 'installer 驗證必須包含日文 G2P sidecar：');
    ok(/python311\.dll/.test(installer) && /haqumei\\haqumei\.pyd/.test(installer), 'installer 必須包含獨立 Python 與 Haqumei native wheel：');
    ok(/python311\.dll/.test(verify) && /haqumei\.pyd/.test(verify), '打包驗證必須檢查 Haqumei runtime 核心檔案：');
    ok(/HaqumeiSha256/.test(haqumeiBuild) && /PythonSha256/.test(haqumeiBuild), 'Haqumei 與 Python 來源必須固定 SHA-256：');
  });

  test('AI 分離：Python 引擎起不來時要收成明確失敗，不可謊稱「改用 CPU」', () => {
    const jobs = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'ai-separation-jobs.js'), 'utf8');
    const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ai-separation-client.js'), 'utf8');
    ok(/engineUp = false/.test(jobs), 'probe 丟例外要記成「引擎不可用」，不是單純沒有 CUDA：');
    ok(
      /if \(!engineUp\) \{[\s\S]{0,400}ENGINE_UNAVAILABLE/.test(jobs),
      'CPU 備援跟 GPU 是同一個 supervisor，引擎掛掉時必須直接失敗（否則永遠停在 0%）：',
    );
    ok(/probe\?\.error/.test(jobs), 'python 端回傳的 probe 錯誤字串不可再被吞掉：');
    ok(/ENGINE_UNAVAILABLE' \? 'aiJob\.engineUnavailable'/.test(client), '前端要把「引擎起不來」跟「這首失敗」分開顯示：');
  });

  test('AI 伴奏：WebGPU 備援模型缺席不可讓整個功能停擺（缺 FFmpeg 仍必須擋）', () => {
    const bundle = require('../server/services/ai-separation-bundle');
    const aiRuntime = require('../server/services/ai-runtime-provider');
    const webgpu = require('../server/services/webgpu-runtime-provider');
    const ffmpeg = require('../server/services/ffmpeg-provider');
    const original = {
      runtime: aiRuntime.isAvailable,
      model: aiRuntime.isModelAvailable,
      webgpu: webgpu.isAvailable,
      ffmpeg: ffmpeg.resolveFfmpegPaths,
    };
    try {
      aiRuntime.isAvailable = () => true;
      aiRuntime.isModelAvailable = () => true;
      ffmpeg.resolveFfmpegPaths = () => ({ source: 'test', ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe' });
      webgpu.isAvailable = () => false;
      eq(bundle.isAvailable(), true, 'Python 引擎＋主模型就緒就該能分離，WebGPU 只是備援的備援：');
      eq(bundle.getStatus().components.webgpu, false, '狀態仍要照實回報 WebGPU 沒就緒：');

      ffmpeg.resolveFfmpegPaths = () => null;
      eq(bundle.isAvailable(), false, '缺 FFmpeg 一定要擋：audio-separator 在 Separator() 建構子就會炸：');
    } finally {
      aiRuntime.isAvailable = original.runtime;
      aiRuntime.isModelAvailable = original.model;
      webgpu.isAvailable = original.webgpu;
      ffmpeg.resolveFfmpegPaths = original.ffmpeg;
    }
  });

  test('AI sidecar：讀不懂的 stdin 行不可靜默丟棄（呼叫端只會等到 15 秒逾時）', () => {
    const supervisorSource = fs.readFileSync(path.join(__dirname, '..', 'ai', 'supervisor.py'), 'utf8');
    const nodeSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'ai-separation.js'), 'utf8');
    ok(supervisorSource.includes('lstrip("' + String.fromCharCode(92) + 'ufeff")'), 'BOM 要先剝掉（PowerShell 的 -Encoding utf8 就會寫出來）：');
    ok(
      /except json\.JSONDecodeError as exc:[\s\S]{0,600}BAD_REQUEST/.test(supervisorSource),
      '解析失敗要回一個 BAD_REQUEST 並寫 stderr，不可 silent continue：',
    );
    ok(
      /isinstance\(request, dict\)/.test(supervisorSource),
      '合法 JSON 但不是物件時要擋下來——否則下一行 .get() 拋的例外在迴圈外，整個 supervisor 收攤：',
    );
    ok(
      /supervisor error without a matching request/.test(nodeSource),
      'Node 端收到沒有對應 pending request 的錯誤行也要留日誌：',
    );
  });

  test('FFmpeg 供應：available 必須要求 ffmpeg 與 ffprobe 都能真的執行，不可只看檔案存在', () => {
    const calls = [];
    const validation = ffmpegProvider.validateFfmpegPair(
      { ffmpeg: 'C:/fake/ffmpeg.exe', ffprobe: 'C:/fake/ffprobe.exe' },
      {
        spawnSyncImpl: (command, args) => {
          calls.push({ command, args });
          return { status: command.endsWith('ffmpeg.exe') ? 0 : 1, error: null };
        },
      },
    );
    eq(validation.ffmpegOk, true, 'ffmpeg 可執行時應通過自己的檢查：');
    eq(validation.ffprobeOk, false, 'ffprobe 壞掉時必須明確失敗：');
    eq(validation.ok, false, '只有一半能執行絕不能視為 FFmpeg 已就緒：');
    eq(calls.length, 2, '必須同時驗證 ffmpeg 與 ffprobe：');
    ok(calls.every((call) => call.args[0] === '-version'), '驗證只允許執行唯讀的 -version：');
  });

  test('FFmpeg 供應：下載快取只有 ffmpeg.exe、缺 ffprobe.exe 時不可當成 downloaded pair', () => {
    const originalConfigPath = loadConfig.ffmpegPath;
    const originalFfmpeg = fs.existsSync(ffmpegProvider.FFMPEG_EXE) ? fs.readFileSync(ffmpegProvider.FFMPEG_EXE) : null;
    const originalFfprobe = fs.existsSync(ffmpegProvider.FFPROBE_EXE) ? fs.readFileSync(ffmpegProvider.FFPROBE_EXE) : null;
    try {
      loadConfig.ffmpegPath = '';
      fs.mkdirSync(ffmpegProvider.BIN_DIR, { recursive: true });
      fs.writeFileSync(ffmpegProvider.FFMPEG_EXE, 'partial-install');
      fs.rmSync(ffmpegProvider.FFPROBE_EXE, { force: true });
      const resolved = ffmpegProvider.resolveFfmpegPaths();
      ok(!resolved || resolved.source !== 'downloaded', '半套下載不可被當成已安裝完成：');
    } finally {
      loadConfig.ffmpegPath = originalConfigPath;
      if (originalFfmpeg) fs.writeFileSync(ffmpegProvider.FFMPEG_EXE, originalFfmpeg);
      else fs.rmSync(ffmpegProvider.FFMPEG_EXE, { force: true });
      if (originalFfprobe) fs.writeFileSync(ffmpegProvider.FFPROBE_EXE, originalFfprobe);
      else fs.rmSync(ffmpegProvider.FFPROBE_EXE, { force: true });
    }
  });





  test('FFmpeg 供應：BtbN checksums.sha256 會精確挑出目標 Windows LGPL zip 的雜湊', () => {
    const source = ffmpegProvider.DOWNLOAD_SOURCES.find((item) => item.id === 'btbn');
    ok(source && source.checksumFile, 'BtbN 來源必須指定 checksum 檔名：');
    const wanted = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    const checksum = Buffer.from(`${other}  some-other-build.zip\n${wanted}  ${source.checksumFile}\n`, 'utf8');
    eq(ffmpegProvider.parseExpectedHash(source, checksum), wanted);
  });

  test('FFmpeg 供應：備援順序為 BtbN → gyan GitHub 鏡像 → gyan.dev 官網直連', () => {
    const ids = ffmpegProvider.DOWNLOAD_SOURCES.map((item) => item.id);
    eq(ids.join(','), 'btbn,gyan-github,gyan', '三個來源的優先序不可被打亂：');
    const mirror = ffmpegProvider.DOWNLOAD_SOURCES.find((item) => item.id === 'gyan-github');
    ok(mirror?.resolveApiUrl, 'GitHub 鏡像來源需要 Releases API 網址（沒有獨立雜湊檔可抓）：');
    ok(mirror?.assetNamePattern instanceof RegExp, 'GitHub 鏡像來源需要用來挑出正確 asset 的檔名規則：');
  });

  testAsync('FFmpeg 供應：主要來源失敗會自動切備援；GitHub 鏡像來源改打 Releases API 挑對 essentials zip', async () => {
    // 兩個情境共用 downloadFfmpeg 內部固定的暫存檔路徑與 downloadInFlight 鎖，
    // 測試框架的 testAsync 會讓所有非同步測試同時起跑，若拆成兩個獨立 testAsync
    // 會互相搶同一份暫存檔而讓另一邊誤判成功/污染結果，因此在同一個測試裡循序執行。
    const cleanup = [
      ffmpegProvider.FFMPEG_EXE,
      ffmpegProvider.FFPROBE_EXE,
      `${ffmpegProvider.FFMPEG_EXE}.previous`,
      `${ffmpegProvider.FFPROBE_EXE}.previous`,
      path.join(ffmpegProvider.BIN_DIR, 'ffmpeg.download.zip'),
      path.join(ffmpegProvider.BIN_DIR, 'ffmpeg.download.exe'),
      path.join(ffmpegProvider.BIN_DIR, 'ffprobe.download.exe'),
    ];

    ffmpegProvider._resetForTests();
    cleanup.forEach((file) => fs.rmSync(file, { force: true }));
    try {
      const zip = new AdmZip();
      zip.addFile('ffmpeg-test/bin/ffmpeg.exe', Buffer.from('fake-ffmpeg'));
      zip.addFile('ffmpeg-test/bin/ffprobe.exe', Buffer.from('fake-ffprobe'));
      const zipBuffer = zip.toBuffer();
      const zipHash = require('crypto').createHash('sha256').update(zipBuffer).digest('hex');
      const sources = [
        { id: 'primary-test', label: 'primary-test', url: 'https://primary.test/ffmpeg.zip', checksumUrl: 'https://primary.test/hash', checksumFile: null },
        { id: 'backup-test', label: 'backup-test', url: 'https://backup.test/ffmpeg.zip', checksumUrl: 'https://backup.test/hash', checksumFile: null },
      ];
      const stages = [];
      const result = await ffmpegProvider.downloadFfmpeg({
        platform: 'win32',
        sources,
        fetchBufferImpl: async () => Buffer.from(`${zipHash}\n`, 'utf8'),
        fetchFileImpl: async (url, filePath, options) => {
          if (url.includes('primary.test')) throw new Error('simulated source timeout');
          fs.writeFileSync(filePath, zipBuffer);
          options.onProgress?.({
            downloadedBytes: zipBuffer.length,
            totalBytes: zipBuffer.length,
            percent: 100,
            speedBytesPerSec: zipBuffer.length * 2,
          });
          return {
            downloadedBytes: zipBuffer.length,
            totalBytes: zipBuffer.length,
            sha256: zipHash,
          };
        },
        spawnSyncImpl: () => ({ status: 0, error: null }),
        onProgress: (status) => stages.push(status.stage),
      });
      eq(result.source, 'backup-test', '主要來源失敗後應由備援完成：');
      ok(stages.includes('source-fallback'), '進度流必須看得到切換備援來源：');
      ok(stages.includes('download'), '進度流必須包含真正下載階段：');
      const finalStatus = ffmpegProvider.getDownloadStatus();
      eq(finalStatus.active, false, '完成後進度狀態不可繼續宣稱下載中：');
      eq(finalStatus.stage, 'done', '完成後狀態必須停在 done：');
      eq(finalStatus.percent, 100, '完成後進度必須是 100%：');
    } finally {
      cleanup.forEach((file) => fs.rmSync(file, { force: true }));
      ffmpegProvider._resetForTests();
    }

    try {
      const zip = new AdmZip();
      zip.addFile('ffmpeg-9.9-essentials_build/bin/ffmpeg.exe', Buffer.from('fake-ffmpeg'));
      zip.addFile('ffmpeg-9.9-essentials_build/bin/ffprobe.exe', Buffer.from('fake-ffprobe'));
      const zipBuffer = zip.toBuffer();
      const zipHash = require('crypto').createHash('sha256').update(zipBuffer).digest('hex');
      const releaseJson = JSON.stringify({
        assets: [
          { name: 'ffmpeg-9.9-full_build.zip', browser_download_url: 'https://mirror.test/ffmpeg-9.9-full_build.zip', digest: `sha256:${'f'.repeat(64)}` },
          { name: 'ffmpeg-9.9-essentials_build.zip', browser_download_url: 'https://mirror.test/ffmpeg-9.9-essentials_build.zip', digest: `sha256:${zipHash}` },
        ],
      });
      const sources = [{
        id: 'mirror-test',
        label: 'mirror-test',
        resolveApiUrl: 'https://api.test/releases/latest',
        assetNamePattern: /^ffmpeg-.+-essentials_build\.zip$/i,
      }];
      let requestedUrl = null;
      const result = await ffmpegProvider.downloadFfmpeg({
        platform: 'win32',
        sources,
        fetchBufferImpl: async (url) => {
          eq(url, 'https://api.test/releases/latest', '應該打 Releases API，不是純文字雜湊檔：');
          return Buffer.from(releaseJson, 'utf8');
        },
        fetchFileImpl: async (url, filePath, options) => {
          requestedUrl = url;
          fs.writeFileSync(filePath, zipBuffer);
          options.onProgress?.({
            downloadedBytes: zipBuffer.length,
            totalBytes: zipBuffer.length,
            percent: 100,
            speedBytesPerSec: zipBuffer.length,
          });
          return { downloadedBytes: zipBuffer.length, totalBytes: zipBuffer.length, sha256: zipHash };
        },
        spawnSyncImpl: () => ({ status: 0, error: null }),
      });
      eq(result.source, 'mirror-test', '解析出的 asset 應該能成功完成安裝：');
      eq(requestedUrl, 'https://mirror.test/ffmpeg-9.9-essentials_build.zip', '要挑中 essentials zip，不能抓錯排在前面的 full_build：');
    } finally {
      cleanup.forEach((file) => fs.rmSync(file, { force: true }));
      ffmpegProvider._resetForTests();
    }
  });

  testAsync('FFmpeg 供應：非 Windows 平台呼叫 downloadFfmpeg 應該明確拒絕，而不是嘗試下載 .exe', async () => {
    if (process.platform === 'win32') return; // 這台是 Windows，跳過（行為只在非 Windows 平台觸發）
    try {
      await ffmpegProvider.downloadFfmpeg();
      throw new Error('非 Windows 平台不應該讓下載成功');
    } catch (err) {
      ok(/Windows/.test(err.message), '應該明確說明只支援 Windows：');
    }
  });
}
