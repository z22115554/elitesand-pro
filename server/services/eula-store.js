'use strict';

/**
 * EULA 首次同意紀錄
 *
 * - 條款唯一來源是專案根目錄的 EULA.txt（打包時 app 根目錄也有一份，
 *   projectRoot 在開發與 portable 佈局下都指到正確位置）
 * - 同意紀錄存 dataDir/eula-acceptance.json：{ version, acceptedAt }，
 *   伺服器為真實來源，面板不可用 localStorage 記這件事
 * - EULA.txt 的「Version:」行變更時視為尚未同意，面板會重新顯示條款
 * - 讀不到 EULA.txt 時回報 required=false：缺檔不應把整個面板鎖死
 */

const fs = require('fs');
const path = require('path');
const { projectRoot, dataDir } = require('../utils/app-paths');
const { createLogger } = require('../utils/logger');

const log = createLogger('EulaStore');

const EULA_FILE = path.join(projectRoot, 'EULA.txt');
const ACCEPTANCE_FILE = path.join(dataDir, 'eula-acceptance.json');

let _cache = null; // { text, version, mtimeMs }

function loadEula() {
  try {
    const stat = fs.statSync(EULA_FILE);
    if (_cache && _cache.mtimeMs === stat.mtimeMs) return _cache;
    const text = fs.readFileSync(EULA_FILE, 'utf8');
    const match = text.match(/^Version:\s*(\S+)/m);
    _cache = { text, version: match ? match[1] : null, mtimeMs: stat.mtimeMs };
    return _cache;
  } catch (err) {
    log.warn(`讀取 EULA.txt 失敗（同意閘門停用）：${err.message}`);
    return null;
  }
}

function readAcceptance() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCEPTANCE_FILE, 'utf8'));
    return parsed && typeof parsed.version === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function getStatus() {
  const eula = loadEula();
  const acceptance = readAcceptance();
  if (!eula || !eula.version) {
    return { required: false, version: null, acceptedVersion: acceptance ? acceptance.version : null };
  }
  return {
    required: !acceptance || acceptance.version !== eula.version,
    version: eula.version,
    acceptedVersion: acceptance ? acceptance.version : null,
  };
}

function getText() {
  const eula = loadEula();
  return eula ? eula.text : null;
}

function accept(version) {
  const eula = loadEula();
  if (!eula || !eula.version) {
    const err = new Error('目前無法讀取授權條款，請確認 EULA.txt 是否存在');
    err.status = 500;
    throw err;
  }
  if (version !== eula.version) {
    const err = new Error('條款版本不符，請重新整理頁面後再同意');
    err.status = 409;
    throw err;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    ACCEPTANCE_FILE,
    JSON.stringify({ version: eula.version, acceptedAt: new Date().toISOString() }, null, 2)
  );
  return getStatus();
}

module.exports = { getStatus, getText, accept, ACCEPTANCE_FILE };
