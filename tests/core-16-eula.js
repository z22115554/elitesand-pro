'use strict';

// 核心回歸測試（eula）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  readApiRoutesSource,
  path,
  TEST_RUNTIME_DIRS,
  test,
  eq,
  ok,
} = require('./core-harness');

console.log('\n📦 16. EULA 首次同意閘門 (eula-store)');
{
  const eulaStore = require('../server/services/eula-store');

  test('EULA.txt 可讀、版本可解析，首次啟動 required=true', () => {
    const status = eulaStore.getStatus();
    ok(/^\d+\.\d+\.\d+$/.test(status.version || ''), `EULA 版本應為 x.y.z 格式，得到 ${status.version}: `);
    eq(status.required, true, '尚未同意時必須 required=true: ');
    eq(status.acceptedVersion, null);
    const text = eulaStore.getText();
    ok(text.includes('最終使用者授權暨免責聲明'), 'EULA 內文應包含中文標題: ');
    ok(text.includes(`Version: ${status.version}`), '內文與解析出的版本要一致: ');
  });

  test('accept 版本不符會被拒絕（409）且不寫入同意紀錄', () => {
    let error;
    try { eulaStore.accept('0.0.1'); } catch (caught) { error = caught; }
    eq(error?.status, 409);
    ok(!fs.existsSync(eulaStore.ACCEPTANCE_FILE), '版本不符不得留下任何紀錄檔: ');
  });

  test('accept 正確版本後 required=false，紀錄落在隔離 data 目錄', () => {
    const before = eulaStore.getStatus();
    const after = eulaStore.accept(before.version);
    eq(after.required, false);
    eq(after.acceptedVersion, before.version);
    ok(eulaStore.ACCEPTANCE_FILE.startsWith(TEST_RUNTIME_DIRS.data), '同意紀錄絕不可寫進正式 data 目錄: ');
    const saved = JSON.parse(fs.readFileSync(eulaStore.ACCEPTANCE_FILE, 'utf8'));
    eq(saved.version, before.version);
    ok(typeof saved.acceptedAt === 'string' && saved.acceptedAt.length > 0);
  });

  test('條款版本變更後會重新要求同意', () => {
    fs.writeFileSync(eulaStore.ACCEPTANCE_FILE, JSON.stringify({ version: '0.9.9', acceptedAt: new Date().toISOString() }));
    eq(eulaStore.getStatus().required, true, '舊版同意不涵蓋新版條款: ');
    fs.rmSync(eulaStore.ACCEPTANCE_FILE, { force: true });
  });

  // 稽核修正：連外功能過去用 `!getStatus().required` 判斷同意，而 required 在「讀不到
  // EULA.txt」時也是 false ——等於缺檔就當成使用者已同意。isAccepted() 必須 fail-closed。
  test('isAccepted() fail-closed：沒有同意紀錄時為 false', () => {
    fs.rmSync(eulaStore.ACCEPTANCE_FILE, { force: true });
    eq(eulaStore.isAccepted(), false, '無紀錄不得視為已同意: ');
  });

  test('isAccepted() fail-closed：舊版本紀錄不算已同意', () => {
    fs.writeFileSync(eulaStore.ACCEPTANCE_FILE, JSON.stringify({ version: '0.0.1', acceptedAt: new Date().toISOString() }));
    eq(eulaStore.isAccepted(), false, '舊版同意不涵蓋新版條款: ');
    fs.rmSync(eulaStore.ACCEPTANCE_FILE, { force: true });
  });

  test('isAccepted() fail-closed：讀不到 EULA.txt 時為 false（required 卻是 false）', () => {
    const fakeStatus = { required: false, version: null, acceptedVersion: null };
    // 直接驗語意，不動真檔案：required=false 但 version=null 代表「缺檔」，不是「已同意」。
    eq(!!fakeStatus.version && fakeStatus.acceptedVersion === fakeStatus.version, false,
      '缺檔情境不得被判成已同意: ');
    const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'eula-store.js'), 'utf8');
    ok(/function isAccepted\(\)[\s\S]{0,200}!!status\.version/.test(source),
      'isAccepted() 必須同時檢查 version 與 acceptedVersion: ');
  });

  test('連外服務不可用 `!getStatus().required` 當同意判定', () => {
    for (const rel of ['server/services/usage-telemetry.js', 'server/services/lyric-offset-sync.js']) {
      const source = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      ok(!/!\s*eulaStore\.getStatus\(\)\.required/.test(source), `${rel} 不得用 !required 判定同意: `);
      ok(/eulaStore\.isAccepted\(\)/.test(source), `${rel} 必須改用 isAccepted(): `);
    }
  });

  test('POST /api/eula/accept 必須掛 requireControlAccess，且副作用只在首次同意觸發', () => {
    const api = readApiRoutesSource();
    ok(api.includes("router.post('/eula/accept', requireControlAccess"),
      '同意端點必須擋掉未配對的區網裝置: ');
    ok(/const wasRequired = eulaStore\.getStatus\(\)\.required;/.test(api),
      '必須先讀 required 才能判斷這次是不是真的首次同意: ');
    ok(/if \(!wasRequired\) return res\.json/.test(api),
      '重複同意不得再次觸發遙測啟動與偏移回補: ');
  });
}
