'use strict';

const TOO_SHORT_SECONDS = 60;
const TOO_LONG_SECONDS = 15 * 60;

const NON_MUSIC_CATEGORIES = new Set([
  'autos & vehicles', 'comedy', 'education', 'gaming', 'howto & style',
  'news & politics', 'science & technology', 'sports', 'travel & events',
]);

const NON_MUSIC_TITLE_PATTERNS = [
  /(?:^|[\s【[(（])(?:podcast|訪談|访谈|專訪|专访|記者會|记者会|新聞|新闻|政論|政论|教學|教学|開箱|开箱|gameplay|遊戲實況|游戏实况)(?:$|[\s】\])）:：｜|])/i,
];

function normalizedCategories(info) {
  const source = Array.isArray(info?.categories) ? info.categories : (info?.category ? [info.category] : []);
  return source.map((value) => String(value || '').trim()).filter(Boolean);
}

function assessYouTubeImport(info = {}) {
  const duration = Number(info.duration) || 0;
  const title = String(info.title || '').trim();
  const categories = normalizedCategories(info);
  const warningTypes = [];
  const warnings = [];

  if (duration > 0 && duration < TOO_SHORT_SECONDS) {
    warningTypes.push('too-short');
    warnings.push(`影片只有 ${duration} 秒，可能不是完整歌曲`);
  }
  if (duration > TOO_LONG_SECONDS) {
    warningTypes.push('too-long');
    warnings.push(`影片超過 15 分鐘（${Math.ceil(duration / 60)} 分鐘），請確認不是節目或長篇內容`);
  }

  const categorySuggestsNonMusic = categories.some((category) => NON_MUSIC_CATEGORIES.has(category.toLowerCase()));
  const titleSuggestsNonMusic = NON_MUSIC_TITLE_PATTERNS.some((pattern) => pattern.test(title));
  if (categorySuggestsNonMusic || titleSuggestsNonMusic) {
    warningTypes.push('non-music');
    const categoryText = categorySuggestsNonMusic ? `（YouTube 分類：${categories.join('、')}）` : '';
    warnings.push(`這支影片可能不是音樂${categoryText}`);
  }

  return {
    warning: warningTypes.length > 0,
    warningTypes,
    warnings,
    duration,
    title,
    author: String(info.channel || info.uploader || '').trim(),
    channelId: String(info.channelId || info.channel_id || info.uploader_id || '').trim(),
    thumbnail: /^https:\/\//i.test(String(info.thumbnail || '')) ? String(info.thumbnail) : '',
    categories,
  };
}

module.exports = { TOO_SHORT_SECONDS, TOO_LONG_SECONDS, assessYouTubeImport };
