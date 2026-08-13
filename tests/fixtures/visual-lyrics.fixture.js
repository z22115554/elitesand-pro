'use strict';

const visualLyrics = [
  {
    time: 0,
    text: '潮汐退去後，光仍在這裡',
    phonetic: 'cháo xī tuì qù hòu, guāng réng zài zhè lǐ',
    xieyin: '',
    words: [
      { text: '潮汐', start: 0, duration: 520 },
      { text: '退去', start: 560, duration: 480 },
      { text: '後，', start: 1080, duration: 300 },
      { text: '光仍', start: 1460, duration: 480 },
      { text: '在這裡', start: 1980, duration: 820 },
    ],
  },
  {
    time: 3200,
    text: '夜空にひとつ、声が響く',
    phonetic: 'yoru sora ni hitotsu, koe ga hibiku',
    xieyin: '',
    words: [
      { text: '夜空に', start: 0, duration: 620 },
      { text: 'ひとつ、', start: 680, duration: 560 },
      { text: '声が', start: 1300, duration: 420 },
      { text: '響く', start: 1780, duration: 760 },
    ],
  },
  {
    time: 6400,
    text: '노래가 우리를 다시 잇는다',
    phonetic: 'noraega urireul dasi itneunda',
    xieyin: '',
    words: [
      { text: '노래가', start: 0, duration: 560 },
      { text: '우리를', start: 640, duration: 580 },
      { text: '다시', start: 1300, duration: 460 },
      { text: '잇는다', start: 1840, duration: 820 },
    ],
  },
];

const visualFrames = [
  { name: 'line-1', timeMs: 1800 },
  { name: 'line-2', timeMs: 4700 },
  { name: 'line-3', timeMs: 7900 },
];

module.exports = { visualLyrics, visualFrames };
