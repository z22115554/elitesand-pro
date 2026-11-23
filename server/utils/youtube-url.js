'use strict';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com', 'youtu.be']);

// 聊天室／訊息裡常直接在網址後面接標點（「https://youtu.be/xxxx。」「…v=xxxx）」），中間沒有空白：
// 舊版整串當網址，影片 ID 變成「xxxx。」而判定無效。網址本身不會以這些字元結尾，先剝掉。
const TRAILING_JUNK = /[\s\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\u2026\u2027\u00b7.,!?;:)\]}'"]+$/u;

function parseYouTubeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  // 先拿掉黏在網址後面的標點（。）！），再做參數形狀與空白／控制字元的安全檢查。
  value = value.trim().replace(TRAILING_JUNK, '');
  if (!value || value.startsWith('-') || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  let url;
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch (_) { return null; }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  let videoId = '';
  if (url.hostname.toLowerCase() === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] || '';
  else if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
  else {
    // /live/<id>：直播與歌枠存檔的分享連結（YouTube「分享」按鈕預設就給這種）。
    const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{6,18})/);
    videoId = match ? match[1] : '';
  }
  if (videoId && !/^[A-Za-z0-9_-]{6,18}$/.test(videoId)) videoId = '';
  return { url: url.toString(), videoId: videoId || null, playlistId: url.searchParams.get('list') || null };
}

/**
 * YouTube「合輯／Mix」（list=RD…）：點任何一首歌的自動播放推薦，網址列就會帶上
 * &list=RD…&start_radio=1。這不是誰整理的播放清單，而是無限延伸的電台；網址同時帶著
 * v= 時，使用者要的就是那一首歌。
 */
function isRadioMixId(value) { return /^RD[A-Za-z0-9_-]+$/.test(String(value || '')); }

/** 網址帶了 list= 但其實是「單曲 + 自動合輯」：有影片 ID、清單是 RD… 的 Mix。 */
function isSingleVideoInMix(value) {
  const parsed = typeof value === 'string' ? parseYouTubeUrl(value) : value;
  return !!(parsed?.videoId && parsed.playlistId && isRadioMixId(parsed.playlistId));
}

function isYouTubeUrl(value) { return !!parseYouTubeUrl(value)?.videoId; }
function isPlaylistUrl(value) { return !!parseYouTubeUrl(value)?.playlistId; }
function extractVideoId(value) { return parseYouTubeUrl(value)?.videoId || null; }

module.exports = { parseYouTubeUrl, isYouTubeUrl, isPlaylistUrl, extractVideoId, isRadioMixId, isSingleVideoInMix };
