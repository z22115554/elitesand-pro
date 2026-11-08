'use strict';

// 整個桌面版用哪張顯示卡。Spout 是在顯示卡上直接共享畫面，送出端（聲嶼）和接收端
// （Shoost、OBS、VTube Studio）在不同顯示卡上時，接收端收得到來源卻是空白畫面。
// 使用者照名稱指定；沒指定時用顯示記憶體最大的那張（通常是獨顯）。只在啟動時套用。
//
// 存的是顯示卡的身分（廠商、型號、子系統、同型號第幾張），不存 LUID：LUID 每次開機都會變。

const fs = require('fs');
const path = require('path');

const FILE = 'gpu-preference.json';
const MODES = Object.freeze(['auto', 'adapter', 'system']);

function normalize(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const mode = MODES.includes(raw.mode) ? raw.mode : 'auto';
  if (mode !== 'adapter') return { mode };
  const a = raw.adapter && typeof raw.adapter === 'object' ? raw.adapter : {};
  const int = (v) => (Number.isInteger(v) && v >= 0 && v <= 0xffffffff ? v : null);
  const adapter = { vendorId: int(a.vendorId), deviceId: int(a.deviceId), subSysId: int(a.subSysId) ?? 0,
    ordinal: int(a.ordinal) ?? 0, name: typeof a.name === 'string' ? a.name.slice(0, 128) : '' };
  return adapter.vendorId === null || adapter.deviceId === null ? { mode: 'auto' } : { mode, adapter };
}

function load(userDataPath, fsImpl = fs) {
  try {
    return normalize(JSON.parse(fsImpl.readFileSync(path.join(path.resolve(userDataPath), FILE), 'utf8')));
  } catch (_) {
    return { mode: 'auto' };
  }
}

function save(userDataPath, value, fsImpl = fs) {
  const normalized = normalize(value);
  const file = path.join(path.resolve(userDataPath), FILE);
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fsImpl.writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  fsImpl.renameSync(temp, file);
  return normalized;
}

/** 同型號的第幾張：兩張一模一樣的卡只能靠列舉順序分。 */
function withOrdinals(adapters) {
  const seen = new Map();
  return (adapters || []).map((adapter) => {
    const id = `${adapter.vendorId}-${adapter.deviceId}-${adapter.subSysId}`;
    const ordinal = seen.get(id) || 0;
    seen.set(id, ordinal + 1);
    return { ...adapter, ordinal, key: `${id}-${ordinal}` };
  });
}

function recommended(adapters) {
  return adapters.reduce((best, adapter) => (!best || adapter.dedicatedMemoryMb > best.dedicatedMemoryMb ? adapter : best), null);
}

/** 依設定挑出這次啟動要用的顯示卡；'system' 回傳 null，交給 Windows。 */
function choose(adapters, saved) {
  const list = withOrdinals(adapters);
  if (saved.mode === 'system' || !list.length) return null;
  if (saved.mode === 'adapter') {
    const a = saved.adapter;
    const hit = list.find((x) => x.vendorId === a.vendorId && x.deviceId === a.deviceId && x.subSysId === a.subSysId && x.ordinal === a.ordinal)
      || list.find((x) => x.vendorId === a.vendorId && x.deviceId === a.deviceId);
    if (hit) return hit;
  }
  return recommended(list);
}

/** Chromium 的 --use-adapter-luid 要十進位的「高位,低位」；原生送出端用十六進位的 luid:高位:低位。 */
function luidSwitchValue(luid) {
  const [high, low] = String(luid || '').split(':').map((part) => Number.parseInt(part, 16));
  return Number.isFinite(high) && Number.isFinite(low) ? `${high},${low}` : null;
}

function nativePreference(luid) {
  return /^[0-9a-f]{1,8}:[0-9a-f]{1,8}$/i.test(String(luid || '')) ? `luid:${luid}` : '';
}

/**
 * 啟動時算出 Chromium 開關與原生送出端的設定。開發用的 ELITESAND_SPOUT_GPU_PREFERENCE 優先；
 * 讀不到顯示卡清單（沒有 Spout 元件）時，自動模式退回「高效能」。
 */
function plan({ env = {}, saved = { mode: 'auto' }, adapters = null } = {}) {
  const forced = env.ELITESAND_SPOUT_GPU_PREFERENCE;
  if (forced === 'low-power' || forced === 'high-performance') {
    return { switch: forced === 'low-power' ? ['force_low_power_gpu'] : ['force_high_performance_gpu'], native: forced, key: '', name: '' };
  }
  if (saved.mode === 'system') return { switch: null, native: '', key: 'system', name: '' };
  const picked = Array.isArray(adapters) ? choose(adapters, saved) : null;
  const value = picked && luidSwitchValue(picked.luid);
  if (picked && value) return { switch: ['use-adapter-luid', value], native: nativePreference(picked.luid), key: picked.key, name: picked.name };
  return { switch: ['force_high_performance_gpu'], native: 'high-performance', key: '', name: '' };
}

/**
 * 列出顯示卡。安裝版只載入雜湊跟安裝檔清單一致的原生模組（跟啟動時的工具完整性檢查同一份清單）。
 * 任何失敗都回傳 null，不擋啟動。
 */
function listAdapters({ isPackaged, projectRoot, resourcesPath, manifest, addonPath = '' }, fsImpl = fs) {
  try {
    let file;
    if (addonPath) file = path.resolve(addonPath);
    else if (isPackaged) {
      file = path.join(resourcesPath, 'tools', 'spout', 'elitesand_spout_output.node');
      const expected = manifest && manifest.files && manifest.files['tools/spout/elitesand_spout_output.node'];
      const actual = require('crypto').createHash('sha256').update(fsImpl.readFileSync(file)).digest('hex');
      if (!expected || actual !== String(expected).toLowerCase()) return null;
    } else file = path.join(projectRoot, '.local', 'spout-output-build', 'elitesand_spout_output.node');
    const addon = require(file);
    return typeof addon.listAdapters === 'function' ? addon.listAdapters() : null;
  } catch (_) {
    return null;
  }
}

module.exports = { FILE, listAdapters, MODES, normalize, load, save, withOrdinals, recommended, choose, luidSwitchValue, nativePreference, plan };
