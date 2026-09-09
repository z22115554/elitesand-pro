'use strict';

/**
 * safeExtractAll 的攻擊面測試。
 *
 * 這支測試不是可有可無的：tools/audit-release.js 對 GHSA-vwc7-r8mq-g2x9
 * （adm-zip 解壓跟隨目的地 symlink）的豁免，前提就是「本專案已經不用
 * extractAllTo，改用 safeExtractAll，而它擋得住那類攻擊」。這裡壞掉＝那個豁免
 * 失去正當性，audit 閘門就不該再放行。
 */

const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');

const { safeExtractAll } = require('../server/services/ai-runtime-provider');

function withTempDir(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-zip-'));
  const out = path.join(tmp, 'out');
  fs.mkdirSync(out);
  try {
    return fn({ tmp, out });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** adm-zip 的 addFile 會正規化名稱，所以直接改 entryName 才做得出惡意條目。 */
function zipWithEntryName(entryName, data = Buffer.from('payload')) {
  const zip = new AdmZip();
  zip.addFile('placeholder', data);
  zip.getEntries()[0].entryName = entryName;
  return zip;
}

test('safeExtractAll：正常檔案照常解出，含子目錄', () => {
  withTempDir(({ out }) => {
    const zip = new AdmZip();
    zip.addFile('a/b/c.txt', Buffer.from('hello'));
    zip.addFile('top.txt', Buffer.from('world'));
    safeExtractAll(zip, out);
    assert.strictEqual(fs.readFileSync(path.join(out, 'a', 'b', 'c.txt'), 'utf8'), 'hello');
    assert.strictEqual(fs.readFileSync(path.join(out, 'top.txt'), 'utf8'), 'world');
  });
});

test('safeExtractAll：擋下 .. 路徑逃逸，且真的沒寫出目標目錄', () => {
  withTempDir(({ tmp, out }) => {
    assert.throws(() => safeExtractAll(zipWithEntryName('../escaped.txt'), out), /逃出目標目錄/);
    assert.throws(() => safeExtractAll(zipWithEntryName('a/../../escaped.txt'), out), /逃出目標目錄/);
    assert.deepStrictEqual(fs.readdirSync(tmp), ['out'], '目標目錄外不可以出現任何檔案');
  });
});

test('safeExtractAll：擋下絕對路徑條目', () => {
  withTempDir(({ out }) => {
    const abs = process.platform === 'win32' ? 'C:/Windows/evil.txt' : '/tmp/evil.txt';
    assert.throws(() => safeExtractAll(zipWithEntryName(abs), out), /逃出目標目錄/);
  });
});

test('safeExtractAll：擋下 zip 內的 symlink 條目（S_IFLNK）', () => {
  withTempDir(({ out }) => {
    const zip = zipWithEntryName('link', Buffer.from('/etc/passwd'));
    zip.getEntries()[0].header.attr = (0xA1FF << 16) >>> 0; // 高 16 位 = S_IFLNK|0777
    assert.throws(() => safeExtractAll(zip, out), /符號連結/);
  });
});

test('safeExtractAll：目的地已存在 symlink 時先移除，不會順著它寫到別處', () => {
  withTempDir(({ tmp, out }) => {
    const outsideDir = path.join(tmp, 'outside');
    fs.mkdirSync(outsideDir);
    const victim = path.join(outsideDir, 'victim.txt');
    fs.writeFileSync(victim, 'original');

    // 這正是該 advisory 的手法：目的地先被放一個指向外部的 symlink
    try {
      fs.symlinkSync(victim, path.join(out, 'planted.txt'), 'file');
    } catch (_) {
      return; // Windows 未開開發者模式時無法建 symlink，此情境不適用
    }

    const zip = new AdmZip();
    zip.addFile('planted.txt', Buffer.from('overwritten'));
    safeExtractAll(zip, out);

    assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'original', '外部檔案不可以被覆寫');
    assert.strictEqual(fs.readFileSync(path.join(out, 'planted.txt'), 'utf8'), 'overwritten');
    assert.strictEqual(fs.lstatSync(path.join(out, 'planted.txt')).isSymbolicLink(), false);
  });
});

test('safeExtractAll：擋下含 NUL 的條目名稱', () => {
  withTempDir(({ out }) => {
    assert.throws(() => safeExtractAll(zipWithEntryName('a\u0000b.txt'), out), /非法的項目名稱/);
  });
});
