'use strict';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com', 'youtu.be']);

function parseYouTubeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch (_) { return null; }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
  let videoId = '';
  if (url.hostname.toLowerCase() === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] || '';
  else if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
  else {
    const match = url.pathname.match(/^\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{6,18})/);
    videoId = match ? match[1] : '';
  }
  if (videoId && !/^[A-Za-z0-9_-]{6,18}$/.test(videoId)) videoId = '';
  return { url: url.toString(), videoId: videoId || null, playlistId: url.searchParams.get('list') || null };
}

function isYouTubeUrl(value) { return !!parseYouTubeUrl(value)?.videoId; }
function isPlaylistUrl(value) { return !!parseYouTubeUrl(value)?.playlistId; }
function extractVideoId(value) { return parseYouTubeUrl(value)?.videoId || null; }

module.exports = { parseYouTubeUrl, isYouTubeUrl, isPlaylistUrl, extractVideoId };
