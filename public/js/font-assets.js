/*
 * 受控本機字型載入器。
 *
 * Windows 的「為目前使用者安裝」字型可能被字型掃描器列出，卻沒有被 Chromium/CEF
 * 註冊成可用的 CSS family。這個小模組改以同源 FontFace 載入經 API 驗證的字型檔；
 * API 只接受 opaque ID 且限 loopback，所以不會把使用者的字型目錄變成 LAN 資源。
 */
(function initElitesandFontAssets() {
  'use strict';

  const ASSET_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;
  const loading = new Map();

  function isAssetId(value) {
    return typeof value === 'string' && ASSET_ID_RE.test(value);
  }

  async function requestAsset(assetId) {
    const response = await fetch(`/api/fonts/assets/${encodeURIComponent(assetId)}`, { credentials: 'same-origin' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.success || !Array.isArray(data.faces) || !data.faces.length) {
      throw new Error(data?.error || '字型資源無法載入');
    }
    return data;
  }

  async function load(assetId) {
    if (!isAssetId(assetId)) throw new Error('無效的字型資源');
    if (loading.has(assetId)) return loading.get(assetId);
    const task = (async () => {
      const asset = await requestAsset(assetId);
      if (!isAssetId(asset.id) || typeof asset.family !== 'string' || !/^ElitesandLocalFont-[A-Za-z0-9_-]{16,32}$/.test(asset.family)) {
        throw new Error('字型資源回應格式無效');
      }
      const loadedFaces = await Promise.all(asset.faces.map(async (face) => {
        if (!isAssetId(face?.id) || typeof face.url !== 'string' || !/^\/api\/fonts\/assets\/[A-Za-z0-9_-]{16,32}\/[A-Za-z0-9_-]{16,32}$/.test(face.url)) {
          throw new Error('字型 face 回應格式無效');
        }
        const source = `url("${face.url}") format("${face.format === 'opentype' ? 'opentype' : face.format === 'truetype' ? 'truetype' : 'collection'}")`;
        const font = new FontFace(asset.family, source, {
          weight: String(Math.min(1000, Math.max(1, Number(face.weight) || 400))),
          style: face.style === 'italic' ? 'italic' : 'normal',
          display: 'block',
        });
        await font.load();
        document.fonts.add(font);
        return font;
      }));
      return { id: asset.id, family: asset.family, faces: loadedFaces };
    })();
    loading.set(assetId, task);
    try {
      return await task;
    } catch (err) {
      loading.delete(assetId);
      throw err;
    }
  }

  window.ElitesandFontAssets = { isAssetId, load };
})();
