'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('ESP-002: option-shaped, credential-bearing and whitespace URLs are rejected', () => {
  const { parseYouTubeUrl } = require('../server/utils/youtube-url');
  for (const value of ['--https://youtu.be/AAAAAAAAAAA', 'https://user:pass@youtu.be/AAAAAAAAAAA', 'https://youtu.be/AAAAAAAAAAA --exec=bad']) {
    assert.equal(parseYouTubeUrl(value), null);
  }
  assert.equal(parseYouTubeUrl('https://youtu.be/AAAAAAAAAAA').videoId, 'AAAAAAAAAAA');
});

test('ESP-028: duplicate confirmation leaves no new orphan and replacement reuses the completed download', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-audit-import-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = `
    const fs=require('fs'), path=require('path');
    const audio=require('./server/services/audio-processor');
    const {LyricsEngine:lyrics}=require('./server/services/lyrics-engine');
    const registry=require('./server/services/import-temp-registry');
    const media=process.env.ELITESAND_DOWNLOADS_DIR; fs.mkdirSync(media,{recursive:true});
    lyrics.search=async()=>null; lyrics.resolveAppleMusicMetadata=async()=>null;
    lyrics.resolveOriginalArtist=async()=>null; audio.measureLoudnessQueued=async()=>-12;
    let downloads=0;
    audio.downloadWithMetadata=url=>{
      downloads++; const id=audio.extractVideoId(url), job=registry.begin(id);
      const filePath=path.join(media,id+'.mp3'); fs.writeFileSync(filePath,Buffer.alloc(4096,1));
      const info={id,title:'周杰倫 - 稻香',duration:223,track:'稻香',artist:'周杰倫',artists:['周杰倫'],channel:'x',uploader:'x',description:''};
      return {metadata:Promise.resolve(info),completed:Promise.resolve({filePath,outputDir:media,downloadMs:1}),completeTempImport:()=>registry.finish(job)};
    };
    (async()=>{
      await audio.processYouTube('https://youtu.be/AAAAAAAAAAA',{requestId:'first'});
      const before=fs.readdirSync(media);
      const duplicate=await audio.processYouTube('https://youtu.be/BBBBBBBBBBB',{requestId:'second'});
      const after=fs.readdirSync(media);
      const replaced=await audio.processYouTube('https://youtu.be/BBBBBBBBBBB',{requestId:'replace',forceReplace:true});
      console.log('RESULT:'+JSON.stringify({before,after,duplicate:duplicate.duplicate,downloads,replaced:fs.existsSync(path.join(media,replaced.filename))}));
    })().catch(e=>{console.error(e);process.exitCode=1});
  `;
  const output = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, ELITESAND_DATA_DIR: path.join(root, 'data'), ELITESAND_DOWNLOADS_DIR: path.join(root, 'media'), ELITESAND_LOGS_DIR: path.join(root, 'logs') } });
  const value = JSON.parse(output.split('RESULT:')[1].split('\n')[0]);
  assert.equal(value.duplicate, true);
  assert.deepEqual(value.after, value.before);
  assert.equal(value.downloads, 2);
  assert.equal(value.replaced, true);
});

test('影片不可用／逾時不可提早結束下載備援；啟動清理不可刪登錄過的 videoId.mp3', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'audio-processor.js'), 'utf8');
  const abort = src.match(/if \(\[([^\]]*)\]\.includes\(classified\.code\)\)/);
  assert.ok(abort, 'abort list');
  assert.ok(!/VIDEO_UNAVAILABLE|IMPORT_TIMEOUT/.test(abort[1]), 'video-unavailable/timeout must still try the next strategy');
  const { ORPHAN_TEMP_EXTENSIONS } = require('../server/services/import-temp-registry');
  assert.equal(ORPHAN_TEMP_EXTENSIONS.has('.mp3'), false);
});
