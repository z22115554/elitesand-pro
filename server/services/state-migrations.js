/**
 * state.json schema 遷移。
 *
 * v0 代表歷史上沒有 schemaVersion 的格式。每一步只負責 vN -> vN+1，
 * 讓跨多版升級可以逐步執行，也讓每一版都能用 fixture 獨立驗證。
 */

const crypto = require('crypto');

const CURRENT_STATE_SCHEMA_VERSION = 3;

// v2 gives the four custom lyric templates clean, project-owned IDs. Keep this
// map in the migration only: every runtime, CSS, file, Socket and saved-state
// identifier after migration uses the new ID exclusively.
const TEMPLATE_ID_RENAMES = Object.freeze({
  luminous: 'pulse',
  partita: 'facet',
  tilt: 'drift',
  mindscape: 'aura',
});

function renameTemplateId(value) {
  return typeof value === 'string' ? (TEMPLATE_ID_RENAMES[value] || value) : value;
}

function migrateTemplateSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = { ...value };
  next.template = renameTemplateId(next.template);

  if (next.lyricTemplateSettings && typeof next.lyricTemplateSettings === 'object'
    && !Array.isArray(next.lyricTemplateSettings)) {
    const settings = {};
    for (const [id, snapshot] of Object.entries(next.lyricTemplateSettings)) {
      const renamedId = renameTemplateId(id);
      settings[renamedId] = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? { ...snapshot, template: renamedId }
        : snapshot;
    }
    next.lyricTemplateSettings = settings;
  }
  return next;
}

function migrateLyricSettings(value) {
  const next = migrateTemplateSnapshot(value);
  if (!next || typeof next !== 'object' || Array.isArray(next)) return next;
  if (Array.isArray(next.lyricPresets)) {
    next.lyricPresets = next.lyricPresets.map((preset) => (
      preset && typeof preset === 'object' && !Array.isArray(preset)
        ? { ...preset, settings: migrateTemplateSnapshot(preset.settings) }
        : preset
    ));
  }
  return next;
}

class StateSchemaError extends Error {
  constructor(message, code = 'INVALID_STATE_SCHEMA') {
    super(message);
    this.name = 'StateSchemaError';
    this.code = code;
  }
}

class UnsupportedStateSchemaError extends StateSchemaError {
  constructor(version) {
    super(
      `state.json schemaVersion ${version} 高於目前支援的 ${CURRENT_STATE_SCHEMA_VERSION}`,
      'STATE_SCHEMA_TOO_NEW',
    );
    this.name = 'UnsupportedStateSchemaError';
    this.version = version;
  }
}

function schemaVersionOf(state) {
  if (!Object.prototype.hasOwnProperty.call(state, 'schemaVersion')) return 0;
  const version = state.schemaVersion;
  if (!Number.isInteger(version) || version < 0) {
    throw new StateSchemaError('state.json schemaVersion 必須是非負整數');
  }
  return version;
}

const MIGRATIONS = new Map([
  [0, (state) => {
    const next = { ...state, schemaVersion: 1 };
    // 歷史 monet（海報捲軸）模板已移除；集中在資料遷移層處理，不再散落於 app-state。
    if (state.lyricSettings && typeof state.lyricSettings === 'object' && !Array.isArray(state.lyricSettings)) {
      next.lyricSettings = { ...state.lyricSettings };
      if (next.lyricSettings.template === 'monet') next.lyricSettings.template = 'classic';
    }
    return next;
  }],
  [1, (state) => ({
    ...state,
    schemaVersion: 2,
    lyricSettings: migrateLyricSettings(state.lyricSettings),
  })],
  // v3：播放清單每一列補上專屬 entryId（跟歌曲 id 分開），讓同一首歌重複加入清單時
  // 「目前播放到哪一列」不會靠歌曲 id 誤判成永遠是第一個相符的那一列。
  [2, (state) => ({
    ...state,
    schemaVersion: 3,
    playlist: Array.isArray(state.playlist)
      ? state.playlist.map((track) => (
        track && typeof track === 'object' && !track.entryId
          ? { ...track, entryId: crypto.randomUUID() }
          : track
      ))
      : state.playlist,
  })],
]);

// 一次性設定修正（不升 schemaVersion）：升 schemaVersion 會讓退回舊版的程式因為
// STATE_SCHEMA_TOO_NEW 讀不了 state.json，所以這類「改預設值」的修正改用 state.oneTimeFixes
// 記錄做過沒有。舊版存檔會丟掉這個欄位，退版再升回來時會重做一次，這是可接受的代價。
//
// jizuraSidesDefault（2026-09-26）：文字PV 預設版位從偏右改成兩側。舊存檔幾乎都把預設的
// 'right' 寫進了 lyricSettings 本身、每個模板的快照與預設組合，全部換成 'sides'。
const ONE_TIME_FIXES = Object.freeze({
  jizuraSidesDefault(state) {
    let changed = 0;
    (function walk(value) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (value.jizuraPlacement === 'right') { value.jizuraPlacement = 'sides'; changed++; }
      Object.values(value).forEach(walk);
    })(state.lyricSettings);
    return changed;
  },
});

/**
 * 對已讀入、已過 schema 遷移的狀態套用還沒做過的一次性修正（直接改傳入的物件）。
 * 回傳這次實際做了哪些修正，呼叫端據此決定要不要立刻存檔。
 */
function applyOneTimeFixes(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return [];
  const done = state.oneTimeFixes && typeof state.oneTimeFixes === 'object' && !Array.isArray(state.oneTimeFixes)
    ? state.oneTimeFixes : {};
  const applied = [];
  for (const [name, fix] of Object.entries(ONE_TIME_FIXES)) {
    if (done[name] === true) continue;
    fix(state);
    done[name] = true;
    applied.push(name);
  }
  state.oneTimeFixes = done;
  return applied;
}

function migrateState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new StateSchemaError('state.json 內容不是有效的狀態物件');
  }

  const fromVersion = schemaVersionOf(input);
  if (fromVersion > CURRENT_STATE_SCHEMA_VERSION) {
    throw new UnsupportedStateSchemaError(fromVersion);
  }

  let state = input;
  let version = fromVersion;
  while (version < CURRENT_STATE_SCHEMA_VERSION) {
    const migration = MIGRATIONS.get(version);
    if (!migration) throw new StateSchemaError(`缺少 state.json v${version} 到 v${version + 1} 的遷移`);
    state = migration(state);
    const nextVersion = schemaVersionOf(state);
    if (nextVersion !== version + 1) {
      throw new StateSchemaError(`state.json v${version} 遷移沒有產生 v${version + 1}`);
    }
    version = nextVersion;
  }

  return {
    state,
    fromVersion,
    toVersion: version,
    migrated: fromVersion !== version,
  };
}

module.exports = {
  CURRENT_STATE_SCHEMA_VERSION,
  StateSchemaError,
  UnsupportedStateSchemaError,
  schemaVersionOf,
  migrateState,
  applyOneTimeFixes,
  ONE_TIME_FIX_NAMES: Object.keys(ONE_TIME_FIXES),
};
