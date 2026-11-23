'use strict';

const fs = require('node:fs');

// Inspect actual local media headers/frames, never editable playlist duration.
async function inspectWebgpuAudio(inputPath) {
  try {
    const budget = await import('../../public/js/webgpu-audio-utils.mjs');
    const stat = await fs.promises.lstat(inputPath);
    if (!stat.isFile() || stat.size <= 0) return { ok: false, code: 'invalid_audio' };
    budget.assertEncodedAudioBytes(stat.size);
    const { parseFile } = await import('music-metadata');
    const metadata = await parseFile(inputPath, { duration: true, skipCovers: true });
    const { duration, numberOfChannels } = metadata.format;
    budget.assertAudioSeconds(duration);
    if (!Number.isInteger(numberOfChannels) || numberOfChannels < 1 || numberOfChannels > 2) {
      return { ok: false, code: 'input_too_large' };
    }
    return { ok: true, audioSeconds: duration };
  } catch (error) {
    return { ok: false, code: error.code === 'input_too_large' ? error.code : 'invalid_audio' };
  }
}

module.exports = { inspectWebgpuAudio };
