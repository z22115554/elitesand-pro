'use strict';

// 桌面版顯示卡選擇：照名稱指定、預設用顯示記憶體最大的那張、只在啟動時套用，
// Spout 送出端跟 Chromium 用同一張。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gpu = require('../electron/gpu-preference');

const RTX = { name: 'NVIDIA GeForce RTX 3060', vendorId: 4318, deviceId: 9476, subSysId: 1, dedicatedMemoryMb: 12113, luid: '0:11b46' };
const IGPU = { name: 'Intel(R) UHD Graphics 770', vendorId: 32902, deviceId: 18048, subSysId: 2, dedicatedMemoryMb: 128, luid: '0:14fab' };
const RTX_B = { ...RTX, luid: '0:2a000' };

test('settings default to automatic and survive bad files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-gpu-'));
  assert.deepEqual(gpu.load(dir), { mode: 'auto' });
  fs.writeFileSync(path.join(dir, gpu.FILE), 'not json');
  assert.deepEqual(gpu.load(dir), { mode: 'auto' });
  fs.writeFileSync(path.join(dir, gpu.FILE), '{"mode":"adapter","adapter":{"vendorId":"x"}}');
  assert.deepEqual(gpu.load(dir), { mode: 'auto' });
  gpu.save(dir, { mode: 'adapter', adapter: { vendorId: 32902, deviceId: 18048, subSysId: 2, ordinal: 0, name: 'Intel', luid: 'dropped' } });
  const saved = gpu.load(dir);
  assert.equal(saved.mode, 'adapter');
  assert.equal(saved.adapter.luid, undefined, 'LUIDs change every boot and are never stored');
  fs.rmSync(dir, { recursive: true });
});

test('automatic picks the card with the most video memory; a named card wins when present', () => {
  assert.equal(gpu.choose([IGPU, RTX], { mode: 'auto' }).name, RTX.name);
  const intel = gpu.choose([RTX, IGPU], { mode: 'adapter', adapter: { vendorId: 32902, deviceId: 18048, subSysId: 2, ordinal: 0 } });
  assert.equal(intel.luid, IGPU.luid);
  const missing = gpu.choose([RTX], { mode: 'adapter', adapter: { vendorId: 4098, deviceId: 1, subSysId: 0, ordinal: 0 } });
  assert.equal(missing.name, RTX.name, 'a removed card falls back to automatic');
  assert.equal(gpu.choose([RTX, IGPU], { mode: 'system' }), null);
});

test('two identical cards are told apart by their order', () => {
  const list = gpu.withOrdinals([RTX, RTX_B]);
  assert.notEqual(list[0].key, list[1].key);
  const second = gpu.choose([RTX, RTX_B], { mode: 'adapter', adapter: { vendorId: 4318, deviceId: 9476, subSysId: 1, ordinal: 1 } });
  assert.equal(second.luid, RTX_B.luid);
});

test('the plan gives Chromium and the Spout sender the same card', () => {
  const plan = gpu.plan({ saved: { mode: 'auto' }, adapters: [IGPU, RTX] });
  assert.deepEqual(plan.switch, ['use-adapter-luid', '0,72518']);
  assert.equal(plan.native, 'luid:0:11b46');
  assert.equal(plan.name, RTX.name);
  assert.deepEqual(gpu.plan({ saved: { mode: 'system' }, adapters: [RTX] }).switch, null);
  const noAddon = gpu.plan({ saved: { mode: 'auto' }, adapters: null });
  assert.deepEqual(noAddon.switch, ['force_high_performance_gpu']);
  assert.equal(noAddon.native, 'high-performance');
  const forced = gpu.plan({ env: { ELITESAND_SPOUT_GPU_PREFERENCE: 'low-power' }, saved: { mode: 'auto' }, adapters: [RTX, IGPU] });
  assert.deepEqual(forced.switch, ['force_low_power_gpu']);
});

test('an installed app only loads a native module whose hash matches the installer manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-gpu-res-'));
  fs.mkdirSync(path.join(dir, 'tools', 'spout'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tools', 'spout', 'elitesand_spout_output.node'), 'tampered');
  const manifest = { files: { 'tools/spout/elitesand_spout_output.node': '0'.repeat(64) } };
  assert.equal(gpu.listAdapters({ isPackaged: true, resourcesPath: dir, manifest }), null);
  assert.equal(gpu.listAdapters({ isPackaged: true, resourcesPath: dir, manifest: null }), null);
  fs.rmSync(dir, { recursive: true });
});

test('startup applies the plan before Electron is ready and the sender reads it', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const shell = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
  assert.ok(main.indexOf("require('./gpu-preference')") < main.indexOf('createElectronShell({'), 'switch must be appended before the shell starts');
  assert.match(main, /app\.commandLine\.appendSwitch\(\.\.\.plan\.switch\)/);
  assert.match(shell, /nativeAdapterPreference: nativeAdapterPreference\(\)/);
  assert.match(shell, /elitesand:spout-save-gpu[\s\S]{0,120}event\?\.sender !== window\.webContents/);
  assert.match(preload, /saveGpuPreference\(preference\)/);
});
